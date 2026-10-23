import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fingerprint,
  LIMITS,
  Navigator,
  parseIndex,
  pathOf,
} from '../mods/symbol-navigator/src/index.ts';
import type { Files, SymbolIndex } from '../mods/symbol-navigator/src/index.ts';

async function fixture() {
  const content = new Map([
    ['tsconfig.json', '{"include":["src"]}'],
    ['src/api.ts', 'export function greet() {\n  return "hello";\n}\n'],
    ['src/use.ts', 'import { greet } from "./api";\ngreet();\ngreet();\n'],
  ]);
  const data: SymbolIndex = {
    kind: 'gaddev.symbol-index',
    schemaVersion: 1,
    compilerVersion: '6.0.3',
    project: 'tsconfig.json',
    inputs: await Promise.all(
      [...content].map(async ([path, text]) => ({
        path,
        sha256: await fingerprint(text),
        kind: path.endsWith('.json') ? ('config' as const) : ('source' as const),
      })),
    ),
    symbols: [
      {
        id: 's1',
        name: 'greet',
        definitions: [{ path: 'src/api.ts', line: 1, column: 17, endLine: 3 }],
        references: [1, 2, 3].map((line) => ({
          path: 'src/use.ts',
          line,
          column: 1,
          endLine: line,
        })),
      },
    ],
  };
  content.set('symbol-index.json', JSON.stringify(data));
  let root = '/repo';
  const reads: string[] = [];
  const files: Files = {
    cwd: async () => root,
    stat: async (path) => {
      if (path === root) return { kind: 'dir', realPath: root, size: 0, mtimeMs: 0 };
      const value = content.get(path.slice(root.length + 1));
      if (value === undefined) throw new Error('Missing file');
      return {
        kind: 'file',
        realPath: path,
        size: new TextEncoder().encode(value).length,
        mtimeMs: 0,
      };
    },
    read: async (path) => {
      reads.push(path);
      return content.get(path.slice(root.length + 1)) ?? '';
    },
  };
  const navigator = new Navigator();
  return {
    data,
    content,
    files,
    reads,
    navigator,
    setRoot: (next: string) => {
      root = next;
    },
    load: async () => {
      content.set('symbol-index.json', JSON.stringify(data));
      await navigator.load(files, 'symbol-index.json');
    },
  };
}
test('index load reads only JSON; search, selection, and packet reverify inputs and include only selected references', async () => {
  const h = await fixture();
  await h.load();
  assert.deepEqual(h.reads, ['/repo/symbol-index.json']);
  assert.match(await h.navigator.find(h.files, 'GREET'), /s1 greet/);
  assert.match(await h.navigator.show(h.files, 's1'), /3 indexed/);
  assert.match(await h.navigator.select(h.files, 2), /\[selected\] 2/);
  const packet = await h.navigator.packet(h.files);
  assert.match(packet, /Definition src\/api.ts:1–3/);
  assert.match(packet, /identifier 2:1/);
  assert.match(packet, /sha256 [a-f0-9]{64}/);
  assert.equal((packet.match(/Selected reference/g) ?? []).length, 1);
  await h.navigator.select(h.files, 2);
  assert.ok(!(await h.navigator.packet(h.files)).includes('Selected reference'));
});
for (const kind of ['source', 'config', 'index', 'deleted', 'binary', 'workspace'] as const) {
  test(`${kind} changes clear all stale results before retrieval`, async () => {
    const h = await fixture();
    await h.load();
    await h.navigator.show(h.files, 's1');
    const count = h.reads.length;
    if (kind === 'source')
      h.content.set('src/use.ts', h.content.get('src/use.ts')!.replace('greet();', 'Greet();'));
    if (kind === 'config') h.content.set('tsconfig.json', '{"include":["lib"]}');
    if (kind === 'index')
      h.content.set('symbol-index.json', JSON.stringify({ ...h.data, compilerVersion: 'other' }));
    if (kind === 'deleted') h.content.delete('src/use.ts');
    if (kind === 'binary') h.content.set('src/use.ts', '\0');
    if (kind === 'workspace') h.setRoot('/other');
    await assert.rejects(h.navigator.packet(h.files), /Stale or unavailable/);
    assert.equal(h.navigator.snapshot.loaded, false);
    assert.equal(h.navigator.snapshot.active, undefined);
    if (kind === 'workspace') assert.equal(h.reads.length, count);
  });
}
test('malformed replacement is transactional; valid reload resets selected references', async () => {
  const h = await fixture();
  await h.load();
  await h.navigator.show(h.files, 's1');
  await h.navigator.select(h.files, 1);
  h.content.set('bad.json', '{');
  await assert.rejects(h.navigator.load(h.files, 'bad.json'), /Invalid/);
  assert.deepEqual(h.navigator.snapshot.selected, [1]);
  await h.load();
  assert.equal(h.navigator.snapshot.active, undefined);
  assert.deepEqual(h.navigator.snapshot.selected, []);
});
test('snapshot clones cannot change internal selection or provenance', async () => {
  const h = await fixture();
  await h.load();
  await h.navigator.find(h.files, 'greet');
  await h.navigator.show(h.files, 's1');
  const view = h.navigator.snapshot;
  view.results[0]!.name = 'changed';
  view.active!.definitions[0]!.path = 'other.ts';
  view.selected.push(1);
  assert.equal(h.navigator.snapshot.results[0]?.name, 'greet');
  assert.equal(h.navigator.snapshot.active?.definitions[0]?.path, 'src/api.ts');
  assert.deepEqual(h.navigator.snapshot.selected, []);
});
test('pagination exposes later matches and references with stable IDs and validated offsets', async () => {
  const h = await fixture();
  const symbol = h.data.symbols[0]!;
  h.data.symbols = Array.from({ length: 20 }, (_, i) => ({
    ...symbol,
    id: `s${i + 1}`,
    name: `greet${i}`,
  }));
  symbol.references = Array.from({ length: 20 }, (_, i) => ({
    path: 'src/use.ts',
    line: i + 1,
    column: 1,
    endLine: i + 1,
  }));
  h.data.symbols[0]!.references = symbol.references;
  await h.load();
  assert.match(await h.navigator.find(h.files, 'greet'), /20 symbol matches/);
  assert.equal(h.navigator.snapshot.results.length, 8);
  assert.match(await h.navigator.results(h.files, 16), /s20/);
  await assert.rejects(h.navigator.results(h.files, 20));
  await assert.rejects(h.navigator.results(h.files, -1));
  await h.navigator.show(h.files, 's1');
  assert.match(await h.navigator.references(h.files, 16), /20\. src\/use.ts:20/);
  for (let i = 1; i <= 8; i++) await h.navigator.select(h.files, i);
  await assert.rejects(h.navigator.select(h.files, 9), /at most eight/);
  await assert.rejects(h.navigator.select(h.files, 0));
  await assert.rejects(h.navigator.references(h.files, 1.5));
});
test('outward links, excluded inward links, oversize files, and read races fail closed', async () => {
  for (const mode of ['outward', 'hidden', 'oversize', 'race'] as const) {
    const h = await fixture();
    await h.load();
    const original = h.files.stat;
    let calls = 0;
    h.files.stat = async (path) => {
      const stat = await original(path);
      if (path === '/repo/src/use.ts') {
        calls++;
        if (mode === 'outward') return { ...stat, realPath: '/outside/use.ts' };
        if (mode === 'hidden') return { ...stat, realPath: '/repo/.private/use.ts' };
        if (mode === 'oversize') return { ...stat, size: LIMITS.fileBytes + 1 };
        if (mode === 'race') return { ...stat, mtimeMs: calls };
      }
      return stat;
    };
    await assert.rejects(h.navigator.find(h.files, 'greet'), /Stale or unavailable/);
    assert.equal(h.navigator.snapshot.loaded, false);
  }
});
test('long definitions are visibly excerpted; source fences and controls cannot escape the packet', async () => {
  const h = await fixture();
  const source = 'export const greet = `\n' + '````\u001b[31m\n'.repeat(70) + '`;';
  h.content.set('src/api.ts', source);
  h.data.inputs.find((input) => input.path === 'src/api.ts')!.sha256 = await fingerprint(source);
  h.data.symbols[0]!.definitions[0]!.endLine = 72;
  await h.load();
  await h.navigator.show(h.files, 's1');
  const packet = await h.navigator.packet(h.files);
  assert.match(packet, /Excerpt only; declaration continues to line 72/);
  assert.match(packet, /`````typescript/);
  assert.ok(!packet.includes('\u001b'));
  assert.ok(!packet.includes('61:'));
});
test('invalid locations and oversized packets never return partial source', async () => {
  const h = await fixture();
  h.data.symbols[0]!.definitions[0]!.endLine = 999;
  await h.load();
  await h.navigator.show(h.files, 's1');
  await assert.rejects(h.navigator.packet(h.files), /outside its source/);
  h.data.symbols[0]!.definitions[0]!.endLine = 3;
  h.content.set('src/api.ts', 'export const greet = "' + 'x'.repeat(17_000) + '";\n\n');
  h.data.inputs.find((input) => input.path === 'src/api.ts')!.sha256 = await fingerprint(
    h.content.get('src/api.ts')!,
  );
  await h.load();
  await h.navigator.show(h.files, 's1');
  await assert.rejects(h.navigator.packet(h.files), /No partial draft/);
});
test('strict schema rejects extra fields, invalid paths, positions, hashes, kinds and collection limits', async () => {
  const { data } = await fixture();
  const invalid: unknown[] = [
    null,
    [],
    { ...data, schemaVersion: 2 },
    { ...data, execute: 'shell' },
    { ...data, inputs: [...data.inputs, data.inputs[0]] },
    { ...data, project: 'missing.json' },
    { ...data, symbols: [...data.symbols, data.symbols[0]] },
    { ...data, symbols: [{ ...data.symbols[0], definitions: [] }] },
    {
      ...data,
      symbols: [
        {
          ...data.symbols[0],
          references: [{ path: 'untracked.ts', line: 1, column: 1, endLine: 1 }],
        },
      ],
    },
    { ...data, symbols: [{ ...data.symbols[0], id: '../bad' }] },
    { ...data, inputs: [{ ...data.inputs[0], sha256: 'bad' }] },
    { ...data, inputs: [{ ...data.inputs[0], kind: 'script' }] },
    {
      ...data,
      symbols: [
        {
          ...data.symbols[0],
          references: [{ path: 'src/use.ts', line: 0, column: 1, endLine: 1 }],
        },
      ],
    },
    {
      ...data,
      symbols: [
        { ...data.symbols[0], references: Array(201).fill(data.symbols[0]!.references[0]) },
      ],
    },
  ];
  for (const value of invalid) assert.throws(() => parseIndex(JSON.stringify(value)));
  assert.throws(() => parseIndex('é'.repeat(LIMITS.indexBytes)), /2 MiB/);
  assert.throws(() => parseIndex('{'), /Invalid/);
  assert.deepEqual(parseIndex(JSON.stringify(data)), data);
});
test('path boundary excludes hidden paths, secrets, dependency/generated files and traversal', () => {
  for (const path of [
    '../x.ts',
    '/x.ts',
    'src//x.ts',
    'src/./x.ts',
    'C:\\x.ts',
    'src/.env.ts',
    'secrets.ts',
    'node_modules/x.ts',
    'dist/x.ts',
    'src/\u001bx.ts',
  ])
    assert.throws(() => pathOf(path));
  assert.equal(pathOf('src/my file.ts'), 'src/my file.ts');
});
