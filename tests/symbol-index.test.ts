import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildIndex } from '../scripts/lib/symbol-index.ts';
import { Navigator, parseIndex } from '../mods/symbol-navigator/src/index.ts';
import type { Files } from '../mods/symbol-navigator/src/index.ts';
import { realpathSync, statSync } from 'node:fs';

function project(files: Record<string, string>) {
  const root = mkdtempSync(resolve(tmpdir(), 'symbol-index-'));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), text);
  };
  put(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        types: [],
        noEmit: true,
      },
      include: ['src'],
    }),
  );
  Object.entries(files).forEach(([path, text]) => put(path, text));
  return {
    root,
    config: resolve(root, 'tsconfig.json'),
    put,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
test('compiler resolves imports, aliases, re-exports, shorthand uses and duplicate names deterministically', () => {
  const h = project({
    'base.json': '{"compilerOptions":{"paths":{"@app/*":["./src/*"]}}}',
    'src/math.ts': 'export function square(value: number) { return value * value; }\n',
    'src/barrel.ts': 'export { square as calculate } from "./math";\n',
    'src/app.ts':
      'import { calculate as run } from "@app/barrel";\nconst answer = run(3);\nconst obj = { answer };\nexport { obj };\n',
    'src/other.ts': 'export function square() { return 0; }\n',
    'dist/ignored.ts': 'export const ignored = true;',
  });
  try {
    const config = JSON.parse(readFileSync(h.config, 'utf8'));
    config.extends = './base.json';
    h.put('tsconfig.json', JSON.stringify(config));
    const index = buildIndex(h.config);
    assert.deepEqual(buildIndex(h.config), index);
    const squares = index.symbols.filter((symbol) => symbol.name === 'square');
    assert.equal(squares.length, 2);
    const math = squares.find((symbol) => symbol.definitions[0]?.path === 'src/math.ts')!;
    assert.ok(math.references.some((ref) => ref.path === 'src/app.ts' && ref.line === 2));
    assert.ok(math.references.some((ref) => ref.path === 'src/barrel.ts'));
    assert.equal(
      squares.find((symbol) => symbol.definitions[0]?.path === 'src/other.ts')!.references.length,
      0,
    );
    const answer = index.symbols.find((symbol) => symbol.name === 'answer')!;
    assert.ok(answer.references.some((ref) => ref.line === 3));
    assert.ok(index.inputs.some((input) => input.path === 'base.json' && input.kind === 'config'));
    assert.ok(!index.inputs.some((input) => input.path.includes('dist')));
    assert.ok(!JSON.stringify(index).includes(h.root));
    assert.ok(!JSON.stringify(index).includes('return value'));
    assert.equal(index.compilerVersion, '6.0.3');
  } finally {
    h.dispose();
  }
});
test('generator CLI and independent reader round-trip real files and detect later edits', async () => {
  const h = project({
    'src/math.ts': 'export const answer = 42;\n',
    'src/app.ts': 'import { answer } from "./math";\nexport const result = answer;\n',
  });
  const script = fileURLToPath(new URL('../scripts/index-symbols.ts', import.meta.url));
  try {
    const output = resolve(h.root, 'symbol-index.json');
    const generate = () =>
      spawnSync(process.execPath, [script, '--project', h.config, '--output', output], {
        encoding: 'utf8',
        timeout: 30_000,
      });
    const result = generate();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /hashed inputs/);
    const original = readFileSync(output, 'utf8');
    assert.equal(generate().status, 1);
    assert.equal(readFileSync(output, 'utf8'), original);
    const parsed = parseIndex(original);
    const files: Files = {
      cwd: async () => h.root,
      stat: async (path) => {
        const stat = statSync(path);
        return {
          kind: stat.isDirectory() ? 'dir' : 'file',
          realPath: realpathSync(path),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      },
      read: async (path) => readFileSync(path, 'utf8'),
    };
    const navigator = new Navigator();
    await navigator.load(files, 'symbol-index.json');
    await navigator.find(files, 'answer');
    const symbol = parsed.symbols.find((entry) => entry.name === 'answer')!;
    await navigator.show(files, symbol.id);
    await navigator.select(files, symbol.references.length);
    assert.match(await navigator.packet(files), /42/);
    h.put('src/app.ts', 'import { answer } from "./math";\nexport const result = answer + 1;\n');
    await assert.rejects(navigator.packet(files), /Changed input: src\/app.ts/);
  } finally {
    h.dispose();
  }
});
test('CLI never overwrites source inputs, existing files, or outward output links', () => {
  const h = project({ 'src/a.ts': 'export const a = 1;' });
  const script = fileURLToPath(new URL('../scripts/index-symbols.ts', import.meta.url));
  const outside = mkdtempSync(resolve(tmpdir(), 'symbol-output-'));
  try {
    h.put('keep.json', 'keep');
    symlinkSync(outside, resolve(h.root, 'linked'));
    for (const output of [
      h.config,
      resolve(h.root, 'keep.json'),
      resolve(h.root, 'linked/index.json'),
    ]) {
      const result = spawnSync(
        process.execPath,
        [script, '--project', h.config, '--output', output],
        { encoding: 'utf8', timeout: 30_000 },
      );
      assert.equal(result.status, 1, result.stdout);
    }
    assert.equal(readFileSync(resolve(h.root, 'keep.json'), 'utf8'), 'keep');
  } finally {
    h.dispose();
    rmSync(outside, { recursive: true, force: true });
  }
});
for (const [label, files] of [
  ['project references', { 'tsconfig.json': '{"files":[],"references":[{"path":"./child"}]}' }],
  ['semantic errors', { 'src/a.ts': 'export const a: number = "wrong";' }],
  [
    'unresolved imports',
    { 'src/a.ts': 'import { missing } from "./missing"; export { missing };' },
  ],
  [
    'hidden sources',
    { 'tsconfig.json': '{"files":[".hidden.ts"]}', '.hidden.ts': 'export const hidden = true;' },
  ],
  [
    'generated imports',
    {
      'src/a.ts': 'import { a } from "../dist/a"; export { a };',
      'dist/a.ts': 'export const a = 1;',
    },
  ],
  ['oversized source', { 'src/a.ts': 'export const a = "' + 'a'.repeat(262_144) + '";' }],
  ['reference limit', { 'src/a.ts': 'export const a = 1;\n' + 'a;\n'.repeat(201) }],
] as [string, Record<string, string>][])
  test(`refuses ${label} instead of writing a misleading partial index`, () => {
    const h = project({ 'src/a.ts': 'export const a = 1;', ...files });
    try {
      assert.throws(() => buildIndex(h.config));
    } finally {
      h.dispose();
    }
  });
test('outside application imports and source/config symlinks are rejected', () => {
  const outside = project({ 'src/a.ts': 'export const a = 1;' });
  const h = project({ 'src/use.ts': 'export const use = true;' });
  try {
    symlinkSync(resolve(outside.root, 'src/a.ts'), resolve(h.root, 'src/linked.ts'));
    assert.throws(() => buildIndex(h.config), /outside/);
    rmSync(resolve(h.root, 'src/linked.ts'));
    h.put('tsconfig.json', JSON.stringify({ extends: outside.config, include: ['src'] }));
    assert.throws(() => buildIndex(h.config));
  } finally {
    h.dispose();
    outside.dispose();
  }
});
