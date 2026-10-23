import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyze,
  Board,
  LIMITS,
  overlap,
  page,
  parsePlan,
  serialize,
  validateScope,
} from '../mods/agent-budget-board/src/board.ts';
import type { Plan, Worker } from '../mods/agent-budget-board/src/board.ts';
const worker = (id: string, scopes: string[], access: 'read' | 'write' = 'read'): Worker => ({
  id,
  role: id,
  task: `Inspect ${id}`,
  model: 'inherit',
  access,
  scopes,
});
function plan(workers = [worker('api', ['src/api/']), worker('docs', ['docs/'])]): Plan {
  return {
    kind: 'gaddev.agent-plan',
    schemaVersion: 1,
    goal: 'Review the API change',
    concurrency: 2,
    workers,
  };
}
const board = (value = plan()) => {
  const b = new Board();
  b.load(serialize(value));
  return b;
};
test('distinct complete worker scopes produce no warning and deterministic batches', () => {
  const result = analyze(plan());
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.batches, [['api', 'docs']]);
});
for (const [a, b, expected] of [
  ['src/api/', 'src/api/auth.ts', true],
  ['src/', 'src/api/', true],
  ['src', 'src/', true],
  ['./', 'docs/readme.md', true],
  ['src/api/', 'src/apix.ts', false],
  ['src/a.ts', 'src/a.tsx', false],
  ['src/a.ts', 'src/a.ts', true],
  ['src/A.ts', 'src/a.ts', false],
] as const)
  test(`lexical overlap ${a} / ${b}`, () => {
    assert.equal(overlap(a, b), expected);
    assert.equal(overlap(b, a), expected);
  });
test('shared read overlap differs from write-involved overlap', () => {
  assert.match(
    analyze(plan([worker('a', ['src/']), worker('b', ['src/auth.ts'])])).warnings.join('\n'),
    /shared read/,
  );
  assert.match(
    analyze(plan([worker('a', ['src/'], 'write'), worker('b', ['src/auth.ts'])])).warnings.join(
      '\n',
    ),
    /write-involved/,
  );
});
test('changing concurrency changes suggested batches without hiding sequential overlap', () => {
  const value = plan([worker('a', ['src/']), worker('b', ['src/'])]);
  value.concurrency = 1;
  const result = analyze(value);
  assert.deepEqual(result.batches, [['a'], ['b']]);
  assert.match(result.warnings.join('\n'), /different suggested batches/);
  value.concurrency = 2;
  assert.match(analyze(value).warnings.join('\n'), /same suggested batch/);
});
test('repeated task/role labels and broad or internally redundant scopes are surfaced', () => {
  const a = worker('a', ['./', 'src/']);
  const b = worker('b', ['tests/']);
  a.role = 'Reviewer';
  b.role = ' reviewer ';
  a.task = 'Review the API';
  b.task = 'REVIEW  THE API';
  const warnings = analyze(plan([a, b])).warnings.join('\n');
  assert.match(warnings, /workspace-wide/);
  assert.match(warnings, /internally overlapping/);
  assert.match(warnings, /identical task/);
  assert.match(warnings, /repeated role/);
});
test('incomplete draft plans remain editable but cannot be approved', async () => {
  const b = new Board();
  assert.equal((await b.review()).blockers.length, 2);
  await assert.rejects(b.approve(), /Complete/);
  b.goal('Task');
  b.add('api');
  const result = await b.review();
  assert.match(result.blockers.join('\n'), /set task/);
  assert.match(result.blockers.join('\n'), /select at least one scope/);
  await assert.rejects(b.approve(true), /Complete/);
});
test('approval requires review and explicit warning acknowledgment', async () => {
  const b = board(plan([worker('a', ['src/'], 'write'), worker('b', ['src/'])]));
  await assert.rejects(b.approve(), /Review/);
  await b.review();
  await assert.rejects(b.approve(), /acknowledge/);
  await b.approve(true);
  assert.equal(b.approved, true);
  assert.match(b.draft(), /No workers have been started/);
});
test('every saved edit invalidates exact-plan review and local approval', async () => {
  const mutations = [
    (b: Board) => b.goal('Another goal'),
    (b: Board) => b.concurrency(1),
    (b: Board) => b.add('extra'),
    (b: Board) => b.remove('docs'),
    (b: Board) => b.edit('api', 'task', 'Review authentication'),
    (b: Board) => b.edit('api', 'model', 'planned-model'),
    (b: Board) => b.edit('api', 'role', 'API reviewer'),
    (b: Board) => b.edit('api', 'access', 'write'),
    (b: Board) => b.edit('api', 'scopes', 'src/auth/'),
    (b: Board) => b.load(b.export()),
    (b: Board) => b.clear(),
  ];
  for (const mutate of mutations) {
    const b = board();
    await b.review();
    await b.approve();
    mutate(b);
    assert.equal(b.approved, false);
    assert.equal(b.reviewed, undefined);
    assert.throws(() => b.draft());
    assert.throws(() => b.view());
  }
});
test('unchanged repeated review preserves approval while exported/imported JSON excludes it', async () => {
  const b = board();
  const first = await b.review();
  await b.approve();
  const second = await b.review();
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(b.approved, true);
  const raw = b.export();
  assert.ok(!raw.includes('approved'));
  const fresh = new Board();
  fresh.load(raw);
  assert.equal(fresh.approved, false);
  assert.throws(() => fresh.draft());
});
test('mutations during asynchronous review or approval cannot approve a stale plan', async () => {
  const b = board();
  const pending = b.review();
  b.goal('Changed during review');
  await assert.rejects(pending, /changed during review/);
  await b.review();
  const approval = b.approve();
  b.concurrency(1);
  await assert.rejects(approval, /changed/);
  assert.equal(b.approved, false);
});
test('external snapshots cannot mutate saved workers or approval blockers', async () => {
  const b = board();
  b.plan.workers[0]!.task = 'Injected';
  assert.notEqual(b.plan.workers[0]?.task, 'Injected');
  const review = await b.review();
  review.blockers.push('Injected');
  review.batches[0]?.push('injected');
  assert.equal(b.reviewed?.blockers.length, 0);
  assert.ok(!b.reviewed?.batches[0]?.includes('injected'));
  await b.approve();
  assert.equal(b.approved, true);
});
for (const scope of [
  '../src/',
  '/src/',
  'C:\\src',
  'src//api/',
  'src/./api',
  'src/**',
  'src/*.ts',
  '{src,tests}/',
  'src/[a].ts',
  'src/a,b.ts',
  'src\na.ts',
  '',
]) {
  test(`rejects ambiguous/unsafe scope ${JSON.stringify(scope)}`, () =>
    assert.throws(() => validateScope(scope)));
}
test('supports exact hidden/space-containing path labels without reading them', () => {
  assert.equal(validateScope('.github/workflows/'), '.github/workflows/');
  assert.equal(validateScope('src/my file.ts'), 'src/my file.ts');
});
test('strict schema rejects malicious/extra fields, duplicate IDs, and unknown versions', () => {
  for (const value of [
    null,
    [],
    { ...plan(), approved: true },
    { ...plan(), schemaVersion: 2 },
    { ...plan(), kind: 'other' },
    { ...plan(), workers: [worker('a', []), worker('a', [])] },
    { ...plan(), workers: [{ ...worker('a', []), command: 'run me' }] },
  ])
    assert.throws(() => parsePlan(JSON.stringify(value)));
  assert.throws(() => parsePlan('{broken'));
  assert.throws(() => parsePlan('é'.repeat(LIMITS.jsonBytes)), /32 KiB/);
});
test('field, worker, and concurrency bounds preserve previously saved data on error', () => {
  const b = board();
  const saved = b.export();
  for (const limit of [0, 9, 1.5, NaN]) assert.throws(() => b.concurrency(limit));
  assert.throws(() => b.edit('api', 'access', 'admin'));
  assert.throws(() => b.edit('api', 'model', 'model && shell'));
  assert.throws(() => b.edit('api', 'task', 'x'.repeat(401)));
  assert.throws(() => b.goal('\u001b[31mTask'));
  assert.throws(() => b.add('API'));
  assert.throws(() => b.add('api'));
  assert.throws(() => b.remove('missing'));
  assert.throws(() => b.edit('missing', 'role', 'x'));
  assert.equal(b.export(), saved);
  for (let i = 0; i < 6; i++) b.add(`worker-${i}`);
  assert.throws(() => b.add('ninth'), /eight/);
});
test('scope count/duplicates and model choices are validated without resolving availability', () => {
  const b = board();
  assert.throws(() => b.edit('api', 'scopes', 'src/, src/'));
  assert.throws(() => b.edit('api', 'scopes', 'a/,b/,c/,d/,e/,f/,g/'));
  b.edit('api', 'model', 'provider/custom-model-v99');
  assert.equal(b.plan.workers[0]?.model, 'provider/custom-model-v99');
});
test('failed replacement imports preserve saved work and its valid approval', async () => {
  const b = board();
  await b.review();
  await b.approve();
  const saved = b.export();
  assert.throws(() => b.load('{broken'));
  assert.equal(b.export(), saved);
  assert.equal(b.approved, true);
});
test('large reviews remain paginated with all warnings available', async () => {
  const workers = Array.from({ length: 8 }, (_, i) =>
    worker(`w${i}`, ['./', `src/${'a'.repeat(210)}${i}/`], 'write'),
  );
  const b = board(plan(workers));
  const r = await b.review();
  assert.ok(r.warnings.length > 20);
  assert.ok(b.view().length < LIMITS.page + 120);
  assert.equal(page(r.report, 0), b.view());
  assert.match(b.view(5000), /characters 5000/);
  assert.throws(() => b.view(-1));
  assert.throws(() => b.view(r.report.length + 1));
  assert.throws(() => b.view(0.5));
});
test('authored backticks stay inside a larger handoff fence', async () => {
  const b = board();
  b.goal('Inspect ```` example');
  await b.review();
  await b.approve();
  assert.match(b.draft(), /`````json/);
  assert.ok(b.draft().endsWith('`````'));
});

test('oversized approved handoffs are refused without truncating portable JSON', async () => {
  const workers = Array.from({ length: 8 }, (_, i) => ({
    ...worker(
      `w${i}`,
      Array.from({ length: 6 }, (_, j) => `src/w${i}/${'x'.repeat(210)}${j}.ts`),
    ),
    role: 'r'.repeat(80),
    task: 't'.repeat(400),
    model: 'm'.repeat(120),
  }));
  const value = plan(workers);
  value.goal = 'g'.repeat(1000);
  const b = board(value);
  await b.review();
  await b.approve(true);
  assert.throws(() => b.draft(), /16,000/);
  assert.equal(parsePlan(b.export()).workers.length, 8);
  assert.equal(b.approved, true);
});
