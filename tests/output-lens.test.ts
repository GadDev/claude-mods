import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  clean,
  diagnostic,
  LIMITS,
  page,
  parseReport,
  summary,
} from '../mods/output-lens/src/report.ts';
import { Lens, validatePath } from '../mods/output-lens/src/session.ts';
import type { Files } from '../mods/output-lens/src/session.ts';

function report(status = 'passed', message = '') {
  const failed = status === 'failed';
  return {
    numTotalTests: 1,
    numPassedTests: failed ? 0 : 1,
    numFailedTests: failed ? 1 : 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: failed ? 1 : 0,
    success: !failed,
    testResults: [
      {
        name: '/repo/app.test.ts',
        status: failed ? 'failed' : 'passed',
        message: '',
        assertionResults: [
          {
            fullName: 'pagination preserves the next page',
            status,
            failureMessages: failed ? [message || 'expected /2 but received /1'] : [],
          },
        ],
      },
    ],
  };
}

function fixture() {
  let raw = JSON.stringify(report());
  let root = '/repo';
  const files: Files = {
    cwd: async () => root,
    stat: async (path) => ({
      kind: path === root ? 'dir' : 'file',
      size: path === root ? 0 : Buffer.byteLength(raw),
      mtimeMs: 0,
      realPath: path,
    }),
    read: async () => raw,
  };
  return {
    files,
    setRaw: (text: string) => {
      raw = text;
    },
    setRoot: (path: string) => {
      root = path;
    },
  };
}

test('real Vitest 5.0.5 mixed-result report retains counts and assertion evidence', () => {
  const raw = readFileSync(new URL('./fixtures/vitest-5-mixed.json', import.meta.url), 'utf8');
  const parsed = parseReport(raw);
  assert.equal(parsed.outcome, 'reported failed');
  assert.deepEqual(
    [parsed.total, parsed.passed, parsed.failed, parsed.pending, parsed.todo],
    [4, 1, 1, 1, 1],
  );
  assert.ok(
    parsed.diagnostics.some((entry) =>
      entry.message.includes("expected '/articles/1' to be '/articles/2'"),
    ),
  );
});

test('reports passing assertions without claiming observed execution success', () => {
  const parsed = parseReport(JSON.stringify(report()));
  assert.equal(parsed.outcome, 'reported passed');
  assert.match(summary(parsed, 'report.json'), /Process exit code.*not observed/);
});

test('failed assertions preserve file, test title, expected/actual, and stack text', () => {
  const parsed = parseReport(
    JSON.stringify(report('failed', 'Expected /2\nReceived /1\nat app.test.ts:18:4')),
  );
  assert.equal(parsed.outcome, 'reported failed');
  assert.equal(
    parsed.diagnostics.find((entry) => entry.kind === 'test')?.message,
    'Expected /2\nReceived /1\nat app.test.ts:18:4',
  );
});

test('contradictory success flags never turn failure evidence green', () => {
  const data = report('failed');
  data.success = true;
  const parsed = parseReport(JSON.stringify(data));
  assert.equal(parsed.outcome, 'reported failed');
  assert.ok(parsed.warnings.some((warning) => warning.includes('conflicts')));
});

test('collection crashes remain visible without assertion failures', () => {
  const data = report();
  data.numTotalTests = 0;
  data.numPassedTests = 0;
  data.numFailedTestSuites = 1;
  data.success = false;
  data.testResults[0]!.assertionResults = [];
  data.testResults[0]!.status = 'failed';
  data.testResults[0]!.message = 'Cannot import module';
  const parsed = parseReport(JSON.stringify(data));
  assert.equal(parsed.outcome, 'reported failed');
  assert.match(summary(parsed, 'r.json'), /Cannot import module/);
});

test('zero tests or all skipped tests do not count as passed checks', () => {
  const empty = report();
  empty.numTotalTests = 0;
  empty.numPassedTests = 0;
  empty.testResults = [];
  assert.equal(parseReport(JSON.stringify(empty)).outcome, 'no tests');
  const skipped = report('skipped');
  skipped.numPassedTests = 0;
  skipped.numPendingTests = 1;
  assert.equal(parseReport(JSON.stringify(skipped)).outcome, 'no tests');
});

test('count mismatches and unfinished statuses remain unknown', () => {
  const data = report();
  data.numTotalTests = 2;
  data.numPassedTests = 2;
  assert.equal(parseReport(JSON.stringify(data)).outcome, 'unknown');
  const pending = report('pending');
  pending.numPassedTests = 0;
  pending.numPendingTests = 1;
  assert.equal(parseReport(JSON.stringify(pending)).outcome, 'unknown');
});

test('snapshot and reported runtime errors cannot be hidden by success=true', () => {
  for (const extra of [{ snapshot: { failure: true } }, { numRuntimeErrorTestSuites: 1 }]) {
    assert.equal(parseReport(JSON.stringify({ ...report(), ...extra })).outcome, 'reported failed');
  }
});

for (const raw of [
  'not json',
  '{}',
  'null',
  JSON.stringify({ ...report(), numTotalTests: -1 }),
  JSON.stringify({ ...report(), success: 'true' }),
  JSON.stringify({ ...report(), testResults: 'not an array' }),
]) {
  test(`rejects malformed or unsupported report ${raw.slice(0, 40)}`, () =>
    assert.throws(() => parseReport(raw)));
}

test('oversized JSON is rejected before parsing', () => {
  assert.throws(() => parseReport(' '.repeat(LIMITS.reportBytes + 1)), /exceeds/);
});

test('bounded summary labels omitted diagnostics and retains full messages for paging', () => {
  const data = report('failed', 'x'.repeat(8000));
  data.numTotalTests = 20;
  data.numFailedTests = 20;
  data.testResults[0]!.assertionResults = Array.from({ length: 20 }, (_, index) => ({
    fullName: `failure ${index}`,
    status: 'failed',
    failureMessages: ['x'.repeat(8000)],
  }));
  const parsed = parseReport(JSON.stringify(data));
  const text = summary(parsed, 'report.json');
  assert.ok(text.length <= LIMITS.summaryCharacters);
  assert.match(text, /additional diagnostic entries omitted/);
  assert.match(text, /characters omitted/);
  const last = diagnostic(parsed, 21, 5000);
  assert.match(last, /next offset end/);
});

test('raw pagination is lossless across all pages', () => {
  const text = 'abc'.repeat(5000);
  let reconstructed = '';
  for (let offset = 0; offset < text.length; offset += LIMITS.pageCharacters)
    reconstructed += page(text, offset).split('\n\n').slice(1).join('\n\n');
  assert.equal(reconstructed, text);
  for (const offset of [-1, 0.5, NaN, text.length + 1]) assert.throws(() => page(text, offset));
});

test('long source names, titles, and diagnostics still produce a bounded summary', () => {
  const data = report('failed');
  data.numTotalTests = 8;
  data.numFailedTests = 8;
  data.testResults[0]!.name = 'a'.repeat(10_000);
  data.testResults[0]!.message = 'b'.repeat(10_000);
  data.testResults[0]!.assertionResults = Array.from({ length: 8 }, () => ({
    fullName: 'c'.repeat(10_000),
    status: 'failed',
    failureMessages: ['d'.repeat(10_000)],
  }));
  assert.ok(
    summary(parseReport(JSON.stringify(data)), 'report.json').length <= LIMITS.summaryCharacters,
  );
});

test('null failureMessages remains valid and explicitly unavailable', () => {
  const data = report('failed');
  const raw = JSON.stringify(data).replace(
    /"failureMessages":\[[^\]]*\]/,
    '"failureMessages":null',
  );
  assert.ok(
    parseReport(raw).diagnostics.some((entry) => entry.message.includes('without a message')),
  );
});

test('summary strips terminal control sequences without altering raw evidence', () => {
  assert.equal(clean('\x1b[31mFAIL\x1b[0m\0'), 'FAIL');
  const raw = JSON.stringify(report('failed', '\x1b[31mFAIL\x1b[0m'));
  const parsed = parseReport(raw);
  assert.equal(parsed.raw, raw);
  assert.ok(!summary(parsed, 'r.json').includes('\x1b'));
});

for (const path of [
  '../r.json',
  '/r.json',
  '.env.json',
  'src/.secret/r.json',
  'src/secrets.json',
  'C:\\r.json',
  'r.txt',
  'src//r.json',
]) {
  test(`rejects unsafe report path ${path}`, () => assert.throws(() => validatePath(path)));
}

test('default Vitest artifact directory and spaces are supported', () => {
  assert.equal(validatePath('.vitest/json/output.json'), '.vitest/json/output.json');
  assert.equal(validatePath('reports/test results.json'), 'reports/test results.json');
});

test('load and tool view revalidate report hashes even if modification time is unchanged', async () => {
  const h = fixture();
  const lens = new Lens();
  await lens.load(h.files, 'report.json');
  assert.match(await lens.view(h.files, 'summary'), /reported passed/);
  h.setRaw(JSON.stringify(report('failed')));
  await assert.rejects(lens.view(h.files, 'summary'), /changed/);
  assert.equal(lens.loaded, undefined);
});

test('invalid replacement reports clear old evidence', async () => {
  const h = fixture();
  const lens = new Lens();
  await lens.load(h.files, 'report.json');
  h.setRaw('broken');
  await assert.rejects(lens.load(h.files, 'report.json'), /Invalid JSON/);
  assert.equal(lens.loaded, undefined);
});

test('different workspaces clear a previously selected report', async () => {
  const h = fixture();
  const lens = new Lens();
  await lens.load(h.files, 'report.json');
  h.setRoot('/other');
  await assert.rejects(lens.view(h.files, 'summary'), /changed/);
  assert.equal(lens.loaded, undefined);
});

test('outward symlinks and changing files are rejected before yielding evidence', async () => {
  const h = fixture();
  const original = h.files.stat;
  let reads = 0;
  h.files.stat = async (path) =>
    path.endsWith('.json')
      ? { kind: 'file', size: 10, mtimeMs: 0, realPath: '/outside/report.json' }
      : original(path);
  h.files.read = async () => {
    reads += 1;
    return '';
  };
  await assert.rejects(new Lens().load(h.files, 'report.json'), /outside/);
  assert.equal(reads, 0);
  const changing = fixture();
  const stat = changing.files.stat;
  let calls = 0;
  changing.files.stat = async (path) => ({ ...(await stat(path)), mtimeMs: calls++ });
  await assert.rejects(new Lens().load(changing.files, 'report.json'), /changed while/);
});
