import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Capsules,
  fingerprint,
  LIMITS,
  parseCapsule,
  serialize,
  validatePath,
} from '../mods/task-capsules/src/capsule.ts';
import type { Files } from '../mods/task-capsules/src/capsule.ts';
function fixture(
  initial: Record<string, string> = { 'src/auth.ts': 'export const enabled = true;\n' },
) {
  const content = new Map(Object.entries(initial));
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
  return {
    files,
    content,
    reads,
    setRoot: (value: string) => {
      root = value;
    },
  };
}
function data() {
  return {
    kind: 'gaddev.task-capsule',
    schemaVersion: 1,
    goal: 'Finish the authentication cleanup',
    decisions: ['Keep the existing API'],
    files: [] as { path: string; sha256: string }[],
    checks: ['Run the authentication tests'],
  };
}

test('strict versioned JSON round-trips without execution or automatic status claims', () => {
  const parsed = parseCapsule(JSON.stringify(data()));
  assert.deepEqual(parseCapsule(serialize(parsed)), parsed);
  assert.equal(parsed.checks[0], 'Run the authentication tests');
});
for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['unknown version', { ...data(), schemaVersion: 2 }],
  ['wrong kind', { ...data(), kind: 'other' }],
  ['extra fields', { ...data(), status: 'passed' }],
  ['missing fields', { kind: 'gaddev.task-capsule' }],
  ['non-string goal', { ...data(), goal: 1 }],
  ['blank goal', { ...data(), goal: '  ' }],
  ['non-array decisions', { ...data(), decisions: {} }],
  ['non-string check', { ...data(), checks: [true] }],
  [
    'file content field',
    { ...data(), files: [{ path: 'src/auth.ts', sha256: 'a'.repeat(64), content: 'unexpected' }] },
  ],
  ['bad fingerprint', { ...data(), files: [{ path: 'src/auth.ts', sha256: 'not-a-hash' }] }],
  [
    'duplicate path',
    {
      ...data(),
      files: [
        { path: 'src/auth.ts', sha256: 'a'.repeat(64) },
        { path: 'src/auth.ts', sha256: 'b'.repeat(64) },
      ],
    },
  ],
] as const)
  test(`rejects ${label}`, () => assert.throws(() => parseCapsule(JSON.stringify(value))));
test('rejects malformed JSON, oversized UTF-8 input, and terminal controls', () => {
  assert.throws(() => parseCapsule('{broken'), /Invalid/);
  assert.throws(() => parseCapsule('é'.repeat(LIMITS.jsonBytes)), /32 KiB/);
  assert.throws(
    () => parseCapsule(JSON.stringify({ ...data(), goal: '\u001b[31mhello' })),
    /Control/,
  );
});
for (const path of [
  '../x.ts',
  '/x.ts',
  'C:\\x.ts',
  '.env',
  'src/.secret/x.ts',
  'src//x.ts',
  'src/secret.json',
  'x\ny.ts',
]) {
  test(`rejects unsafe path ${JSON.stringify(path)}`, () =>
    assert.throws(() => validatePath(path)));
}
test('supports ordinary relative file references including spaces', () =>
  assert.equal(validatePath('src/my file.ts'), 'src/my file.ts'));
test('goal edits preserve authored decisions and unresolved checks; item edits and removal are explicit', () => {
  const c = new Capsules();
  c.goal('First goal');
  c.add('decision', 'Keep API');
  c.add('check', 'Run tests');
  c.goal('Second goal');
  assert.equal(c.current?.decisions[0], 'Keep API');
  assert.equal(c.current?.checks[0], 'Run tests');
  c.edit('decision', 1, 'Keep public API');
  assert.equal(c.current?.decisions[0], 'Keep public API');
  assert.throws(() => c.edit('check', 0, 'no'));
  assert.throws(() => c.remove('decision', 1.5));
  c.remove('decision', 1);
  assert.equal(c.current?.decisions.length, 0);
  assert.throws(() => c.goal(' '));
  assert.equal(c.current?.goal, 'Second goal');
});
test('text and list bounds reject changes without losing previous work', () => {
  const c = new Capsules();
  c.goal('Goal');
  for (let i = 0; i < 8; i++) {
    c.add('decision', `Decision ${i}`);
    c.add('check', `Check ${i}`);
  }
  assert.throws(() => c.add('decision', 'Too many'));
  assert.throws(() => c.add('check', 'Too many'));
  assert.throws(() => c.goal('x'.repeat(LIMITS.goal + 1)));
  assert.throws(() => c.edit('check', 1, 'x'.repeat(LIMITS.item + 1)));
  assert.equal(c.current?.checks[0], 'Check 0');
  assert.equal(c.current?.goal, 'Goal');
});
test('export/import into an empty session round-trips notes and hashes; import reads no referred files', async () => {
  const h = fixture();
  const first = new Capsules();
  first.goal('Clean up auth');
  first.add('decision', 'Keep API');
  first.add('check', 'Run tests');
  await first.file(h.files, 'src/auth.ts');
  const exported = (await first.inspect(h.files)).json;
  assert.ok(!exported.includes('/repo'));
  assert.ok(!exported.includes('export const enabled'));
  h.content.set('handoffs/auth.json', exported);
  const second = new Capsules();
  const count = h.reads.length;
  await second.importFile(h.files, 'handoffs/auth.json');
  assert.deepEqual(h.reads.slice(count), ['/repo/handoffs/auth.json']);
  assert.equal(second.review, undefined);
  assert.deepEqual(second.current, first.current);
  const review = await second.inspect(h.files);
  assert.equal(review.files[0]?.status, 'matching');
  assert.match(await second.draft(h.files), /unresolved and unverified/);
  assert.equal(second.current?.checks[0], 'Run tests');
});
test('same-size source changes block draft insertion and keep authored data until explicit refresh', async () => {
  const h = fixture();
  const c = new Capsules();
  c.goal('Goal');
  c.add('check', 'Run tests');
  await c.file(h.files, 'src/auth.ts');
  const old = c.current?.files[0]?.sha256;
  h.content.set('src/auth.ts', 'export const enabled = True;\n');
  assert.equal((await c.inspect(h.files)).files[0]?.status, 'changed');
  await assert.rejects(c.draft(h.files), /need review/);
  assert.equal(c.current?.goal, 'Goal');
  assert.equal(c.current?.files[0]?.sha256, old);
  await c.refresh(h.files, 1);
  assert.notEqual(c.current?.files[0]?.sha256, old);
  assert.equal(c.review, undefined);
  assert.match(await c.draft(h.files), /matching/);
  assert.equal(c.current?.checks.length, 1);
});
test('missing, binary, and outward-symlinked sources remain visible but unavailable', async () => {
  const h = fixture();
  const c = new Capsules();
  c.goal('Goal');
  await c.file(h.files, 'src/auth.ts');
  h.content.clear();
  assert.equal((await c.inspect(h.files)).files[0]?.status, 'unavailable');
  assert.equal(c.current?.files.length, 1);
  h.content.set('src/auth.ts', '\0');
  assert.equal((await c.inspect(h.files)).files[0]?.status, 'unavailable');
  const original = h.files.stat;
  const count = h.reads.length;
  h.files.stat = async (path) =>
    path === '/repo'
      ? original(path)
      : { kind: 'file', realPath: '/outside/auth.ts', size: 2, mtimeMs: 0 };
  assert.equal((await c.inspect(h.files)).files[0]?.status, 'unavailable');
  assert.equal(h.reads.length, count);
});
test('workspace changes block handoff without reading references in the other workspace', async () => {
  const h = fixture();
  const c = new Capsules();
  c.goal('Goal');
  await c.file(h.files, 'src/auth.ts');
  h.setRoot('/other');
  const count = h.reads.length;
  assert.equal((await c.inspect(h.files)).files[0]?.status, 'workspace-changed');
  await assert.rejects(c.draft(h.files), /need review/);
  assert.equal(h.reads.length, count);
  await assert.rejects(c.refresh(h.files, 1), /Working directory changed/);
  await assert.rejects(c.file(h.files, 'src/new.ts'), /Working directory changed/);
  assert.equal(h.reads.length, count);
  assert.equal(c.current?.goal, 'Goal');
});
test('malformed replacement imports retain previous authored content', async () => {
  const h = fixture({ 'bad.json': '{broken' });
  const c = new Capsules();
  c.goal('Keep this goal');
  await assert.rejects(c.importFile(h.files, 'bad.json'), /Invalid/);
  assert.equal(c.current?.goal, 'Keep this goal');
  await assert.rejects(c.importFile(h.files, 'bad.txt'), /JSON/);
  assert.equal(c.current?.goal, 'Keep this goal');
});
test('unsafe imported references fail before any referenced file is read', async () => {
  const h = fixture({
    'bad.json': JSON.stringify({
      ...data(),
      files: [{ path: '../secret', sha256: 'a'.repeat(64) }],
    }),
  });
  await assert.rejects(new Capsules().importFile(h.files, 'bad.json'));
  assert.deepEqual(h.reads, ['/repo/bad.json']);
});
test('file count, duplicate paths, index, and actual UTF-8 size bounds are enforced', async () => {
  const rows: Record<string, string> = {};
  for (let i = 0; i < 9; i++) rows[`src/${i}.ts`] = String(i);
  const h = fixture(rows);
  const c = new Capsules();
  c.goal('Goal');
  await c.file(h.files, 'src/0.ts');
  await assert.rejects(c.file(h.files, 'src/0.ts'), /already selected/);
  for (let i = 1; i < 8; i++) await c.file(h.files, `src/${i}.ts`);
  await assert.rejects(c.file(h.files, 'src/8.ts'), /eight/);
  await assert.rejects(c.refresh(h.files, 0), /index/);
  const big = fixture({ 'src/auth.ts': 'é'.repeat(LIMITS.sourceBytes) });
  const fresh = new Capsules();
  fresh.goal('Goal');
  await assert.rejects(fresh.file(big.files, 'src/auth.ts'), /size limit/);
  assert.equal(big.reads.length, 0);
});
test('oversized reads, file read races, and unresolvable roots cannot enter a capsule', async () => {
  const big = fixture({ 'src/auth.ts': 'x'.repeat(LIMITS.sourceBytes + 1) });
  const original = big.files.stat;
  big.files.stat = async (path) => ({ ...(await original(path)), size: 1 });
  const c = new Capsules();
  c.goal('Goal');
  await assert.rejects(c.file(big.files, 'src/auth.ts'), /oversized/);
  const race = fixture();
  const stat = race.files.stat;
  let calls = 0;
  race.files.stat = async (path) => ({ ...(await stat(path)), mtimeMs: calls++ });
  await assert.rejects(c.file(race.files, 'src/auth.ts'), /changed while/);
  const stable = fixture();
  await c.file(stable.files, 'src/auth.ts');
  stable.files.stat = async () => ({ kind: 'dir', size: 0, mtimeMs: 0 });
  assert.equal((await c.inspect(stable.files)).files[0]?.status, 'unavailable');
});
test('human editing invalidates prior review; removing stale refs permits a notes-only draft', async () => {
  const h = fixture();
  const c = new Capsules();
  c.goal('Goal');
  await c.file(h.files, 'src/auth.ts');
  await c.inspect(h.files);
  c.add('decision', 'Keep API');
  assert.equal(c.review, undefined);
  h.content.clear();
  await assert.rejects(c.draft(h.files));
  c.remove('file', 1);
  assert.match(await c.draft(h.files), /No file references/);
  c.clear();
  assert.equal(c.current, undefined);
  await assert.rejects(c.inspect(h.files), /Set a goal/);
});
test('handoff fences contain arbitrary authored backticks without opening a new instruction block', async () => {
  const c = new Capsules();
  c.goal('Review ```` example');
  const h = fixture({});
  const review = await c.inspect(h.files);
  assert.match(review.handoff, /`````json/);
  assert.ok(review.handoff.endsWith('`````'));
  assert.equal((await fingerprint('abc')).length, 64);
});
