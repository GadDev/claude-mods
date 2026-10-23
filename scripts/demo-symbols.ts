import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from './lib/symbol-index.ts';
import { Navigator, parseIndex } from '../mods/symbol-navigator/src/index.ts';
import type { Files } from '../mods/symbol-navigator/src/index.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = resolve(repository, 'examples/symbol-navigator');
const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === '--check';
// POSIX shell commands are printed for the reader, never executed.
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
let workspace: string | undefined;
try {
  if (args.length && !check) throw new Error('Usage: npm run symbols:demo [-- --check]');
  workspace = realpathSync(mkdtempSync(resolve(tmpdir(), 'claude-symbol-demo-')));
  mkdirSync(resolve(workspace, 'src'));
  for (const path of [
    'tsconfig.json',
    'src/pricing.ts',
    'src/legacy.ts',
    'src/index.ts',
    'src/checkout.ts',
  ])
    copyFileSync(resolve(template, path), resolve(workspace, path));
  const project = resolve(workspace, 'tsconfig.json');
  const index = buildIndex(project);
  const indexPath = resolve(workspace, 'symbol-index.json');
  const write = (path: string, value: unknown) => {
    const raw = JSON.stringify(value, null, 2) + '\n';
    parseIndex(raw);
    writeFileSync(path, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  };
  write(indexPath, index);
  const primary = index.symbols.find(
    (symbol) => symbol.name === 'quoteTotal' && symbol.definitions[0]?.path === 'src/pricing.ts',
  );
  assert.ok(primary, 'Demo must have the pricing definition.');
  if (check) {
    const root = workspace;
    const files: Files = {
      cwd: async () => root,
      stat: async (path) => {
        const stat = statSync(path);
        return {
          kind: stat.isDirectory() ? 'dir' : 'file',
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          realPath: realpathSync(path),
        };
      },
      read: async (path) => readFileSync(path, 'utf8'),
    };
    const navigator = new Navigator();
    await navigator.load(files, 'symbol-index.json');
    await navigator.find(files, 'quoteTotal');
    assert.equal(navigator.snapshot.matches, 2, 'Show both same-name definitions.');
    assert.ok(primary.references.length > 8, 'Demo must exercise reference pagination.');
    assert.ok(
      primary.references.some((ref) => ref.path === 'src/checkout.ts'),
      'Aliased checkout uses must resolve.',
    );
    assert.ok(
      !primary.references.some((ref) => ref.path === 'src/legacy.ts'),
      'Keep same-name symbols separate.',
    );
    await navigator.show(files, primary.id);
    await navigator.references(files, 8);
    const selected =
      primary.references.findIndex((ref) => ref.path === 'src/checkout.ts' && ref.line > 6) + 1;
    assert.ok(selected > 0);
    await navigator.select(files, selected);
    const packet = await navigator.packet(files);
    assert.match(packet, /Definition src\/pricing.ts/);
    assert.match(packet, /Selected reference src\/checkout.ts/);
    assert.ok(!packet.includes('Legacy quote:'));
    const pricing = resolve(root, 'src/pricing.ts');
    writeFileSync(
      pricing,
      readFileSync(pricing, 'utf8').replace('discount = 0', 'discount = 0.05'),
    );
    await assert.rejects(navigator.packet(files), /Stale or unavailable index/);
    assert.equal(navigator.snapshot.loaded, false);
    const rebuilt = buildIndex(project);
    write(resolve(root, 'symbol-index-rebuilt.json'), rebuilt);
    await navigator.load(files, 'symbol-index-rebuilt.json');
    const updated = rebuilt.symbols.find(
      (symbol) => symbol.name === 'quoteTotal' && symbol.definitions[0]?.path === 'src/pricing.ts',
    );
    assert.ok(updated);
    await navigator.show(files, updated.id);
    assert.match(await navigator.packet(files), /discount = 0.05/);
    console.log(
      'Demo check passed: duplicate names, aliases, reference paging, selected packet, stale refusal, and rebuild/reload. Temporary workspace removed.',
    );
  } else {
    console.log(
      [
        'Symbol Navigator demo ready — a fresh disposable copy, with a generated index.',
        `Workspace: ${workspace}`,
        `Index: ${indexPath}`,
        '',
        '1. Launch from this workspace (macOS/Linux shell):',
        `cd -- ${quote(workspace)}`,
        `claude --plugin-dir ${quote(resolve(repository, 'mods/symbol-navigator'))}`,
        '',
        '2. In Claude Code:',
        '/symbol-navigator load symbol-index.json',
        '/symbol-navigator find quoteTotal',
        `Choose ${primary.id} at src/pricing.ts; src/legacy.ts is a different symbol.`,
        '/symbol-navigator',
        '',
        'Use Next references, select a checkout call, then preview. Draft insertion is optional.',
        '3. Edit src/pricing.ts in this temporary workspace, then preview again: stale retrieval must fail.',
        '4. Rebuild from the repository terminal into a new filename:',
        `node ${quote(resolve(repository, 'scripts/index-symbols.ts'))} --project ${quote(project)} --output ${quote(resolve(workspace, 'symbol-index-rebuilt.json'))}`,
        'Then load symbol-index-rebuilt.json and choose the definition again.',
        `Walkthrough: ${resolve(template, 'README.md')}`,
        'The demo has not launched Claude or executed project code. Delete this printed temporary workspace when finished.',
      ].join('\n'),
    );
  }
} catch (error) {
  // Clean up incomplete workspaces; successful interactive demos remain for the user.
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : 'Demo setup failed.');
  process.exitCode = 1;
} finally {
  if (check && workspace) rmSync(workspace, { recursive: true, force: true });
}
