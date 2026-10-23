import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fingerprint, parseIndex } from '../mods/symbol-navigator/src/index.ts';

const script = fileURLToPath(new URL('../scripts/demo-symbols.ts', import.meta.url));
const pricing = fileURLToPath(
  new URL('../examples/symbol-navigator/src/pricing.ts', import.meta.url),
);
const run = (args: string[] = []) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 30_000 });

test('documented demo check exercises generation, retrieval, stale refusal and rebuild without editing the template', () => {
  const original = readFileSync(pricing, 'utf8');
  const result = run(['--check']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /duplicate names, aliases, reference paging, selected packet, stale refusal, and rebuild\/reload/,
  );
  assert.equal(readFileSync(pricing, 'utf8'), original);
});
test('interactive demo creates fresh isolated workspaces, complete indexes, and exact commands on repeat runs', async () => {
  const workspaces: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      const workspace = /^Workspace: (.+)$/m.exec(result.stdout)?.[1];
      assert.ok(workspace);
      workspaces.push(workspace);
      const index = parseIndex(readFileSync(resolve(workspace, 'symbol-index.json'), 'utf8'));
      assert.equal(index.symbols.filter((symbol) => symbol.name === 'quoteTotal').length, 2);
      for (const input of index.inputs)
        assert.equal(
          await fingerprint(readFileSync(resolve(workspace, input.path), 'utf8')),
          input.sha256,
        );
      assert.deepEqual(readdirSync(workspace).sort(), [
        'src',
        'symbol-index.json',
        'tsconfig.json',
      ]);
      assert.match(result.stdout, /claude --plugin-dir/);
      assert.match(result.stdout, /symbol-index-rebuilt.json/);
      const primary = index.symbols.find(
        (symbol) =>
          symbol.name === 'quoteTotal' && symbol.definitions[0]?.path === 'src/pricing.ts',
      );
      assert.ok(result.stdout.includes(`Choose ${primary?.id} at src/pricing.ts`));
    }
    assert.notEqual(workspaces[0], workspaces[1]);
  } finally {
    workspaces.forEach((path) => rmSync(path, { recursive: true, force: true }));
  }
});
