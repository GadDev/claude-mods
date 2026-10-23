import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  duplicates,
  fingerprint,
  LIMITS,
  page,
  report,
  scope,
  validatePath,
  Workbench,
} from '../mods/instruction-workbench/src/audit.ts';
import type { Files, Source } from '../mods/instruction-workbench/src/audit.ts';
const guidance = '- Run the repository checks before opening any pull request.';
function fixture(initial: Record<string, string> = { 'CLAUDE.md': guidance }) {
  const content = new Map(Object.entries(initial));
  let root = '/repo';
  let reads = 0;
  const files: Files = {
    cwd: async () => root,
    stat: async (path) => {
      const text = content.get(path.slice(root.length + 1));
      if (path === root) return { kind: 'dir', size: 0, mtimeMs: 0, realPath: path };
      if (text === undefined) throw new Error('Missing instruction source');
      return {
        kind: 'file',
        size: new TextEncoder().encode(text).length,
        mtimeMs: 0,
        realPath: path,
      };
    },
    read: async (path) => {
      reads++;
      return content.get(path.slice(root.length + 1)) ?? '';
    },
  };
  return {
    files,
    content,
    setRoot: (value: string) => {
      root = value;
    },
    reads: () => reads,
  };
}
function source(path: string, text: string): Source {
  return {
    path,
    text,
    root: '/repo',
    realPath: `/repo/${path}`,
    hash: 'abc',
    bytes: text.length,
    scope: scope(path, text),
  };
}
test('reports exact duplicates with original source line numbers and scope caution', () => {
  const sources = [source('CLAUDE.md', '# Rules\n' + guidance), source('src/CLAUDE.md', guidance)];
  const result = duplicates(sources);
  assert.equal(result.length, 1);
  assert.deepEqual(
    result[0]?.occurrences.map((o) => o.line),
    [2, 1],
  );
  assert.match(report(sources), /different scopes can be intentional/);
  assert.match(report(sources), /not followed/);
});
test('ignores code fences, frontmatter, multiline comments, quotes, and short boilerplate', () => {
  const text = [
    '---',
    'description: ' + guidance,
    '---',
    '```md',
    guidance,
    '```',
    '<!--',
    guidance,
    '-->',
    '> ' + guidance,
    'Short',
    guidance,
  ].join('\n');
  assert.equal(duplicates([source('CLAUDE.md', text)]).length, 0);
});
test('longer fences close correctly; nested shorter fences stay inside code', () => {
  const text = ['````md', guidance, '```', guidance, '````', guidance].join('\n');
  assert.equal(duplicates([source('CLAUDE.md', text)]).length, 0);
});
test('collapses whitespace but preserves case, punctuation, and bullet structure', () => {
  assert.equal(
    duplicates([source('CLAUDE.md', guidance + '\n' + guidance.replaceAll(' ', '  '))]).length,
    1,
  );
  assert.equal(
    duplicates([source('CLAUDE.md', guidance + '\n' + guidance.toUpperCase())]).length,
    0,
  );
});
test('rule frontmatter is labeled as present, never treated as resolved scope', () => {
  assert.match(
    scope('.claude/rules/api.md', '---\npaths:\n  - src/**\n---\n'),
    /matching unverified/,
  );
  assert.match(scope('.claude/rules/api.md', ''), /loading unverified/);
});
for (const path of [
  '../CLAUDE.md',
  '/CLAUDE.md',
  '.env',
  'src/.secret/CLAUDE.md',
  'C:\\CLAUDE.md',
  'src//CLAUDE.md',
  '.claude/skills/review/SKILL.md',
  'README.md',
]) {
  test(`rejects unsupported or unsafe instruction path ${path}`, () =>
    assert.throws(() => validatePath(path)));
}
test('supports explicit local, nested, rule, and AGENTS paths including spaces', () => {
  for (const path of [
    'CLAUDE.local.md',
    'AGENTS.md',
    'apps/web app/CLAUDE.md',
    '.claude/rules/testing.md',
  ])
    assert.equal(validatePath(path), path);
});
test('audit and paging reverify full hashes; stale same-size text clears all evidence', async () => {
  const h = fixture();
  const w = new Workbench();
  await w.add(h.files, 'CLAUDE.md');
  assert.match(await w.audit(h.files), /0 EXACT DUPLICATE/);
  assert.match(await w.view(h.files), /REVIEW ONLY/);
  h.content.set('CLAUDE.md', guidance.replace('Run', 'Try'));
  await assert.rejects(w.view(h.files), /changed/);
  assert.equal(w.sources.length, 0);
});
test('working directory changes clear selected sources', async () => {
  const h = fixture();
  const w = new Workbench();
  await w.add(h.files, 'CLAUDE.md');
  h.setRoot('/other');
  await assert.rejects(w.audit(h.files), /changed/);
  assert.equal(w.sources.length, 0);
});
test('outward symlinks are rejected before reading source text', async () => {
  const h = fixture();
  const original = h.files.stat;
  h.files.stat = async (path) =>
    path.endsWith('CLAUDE.md')
      ? { kind: 'file', size: 10, mtimeMs: 0, realPath: '/elsewhere/CLAUDE.md' }
      : original(path);
  await assert.rejects(new Workbench().add(h.files, 'CLAUDE.md'), /outside/);
  assert.equal(h.reads(), 0);
});
test('aliasing one physical source is rejected', async () => {
  const h = fixture({ 'CLAUDE.md': guidance, 'src/CLAUDE.md': guidance });
  const original = h.files.stat;
  h.files.stat = async (path) => ({
    ...(await original(path)),
    realPath: path.endsWith('CLAUDE.md') ? '/repo/CLAUDE.md' : path,
  });
  const w = new Workbench();
  await w.add(h.files, 'CLAUDE.md');
  await assert.rejects(w.add(h.files, 'src/CLAUDE.md'), /already selected/);
});
test('source mutations during reads and disappearing files fail closed', async () => {
  const h = fixture();
  const original = h.files.stat;
  let calls = 0;
  h.files.stat = async (path) => ({ ...(await original(path)), mtimeMs: calls++ });
  await assert.rejects(new Workbench().add(h.files, 'CLAUDE.md'), /changed while/);
  const stable = fixture();
  const w = new Workbench();
  await w.add(stable.files, 'CLAUDE.md');
  stable.content.clear();
  await assert.rejects(w.audit(stable.files), /Missing/);
  assert.equal(w.sources.length, 0);
});
test('actual UTF-8 size and source count are bounded', async () => {
  const h = fixture({ 'CLAUDE.md': 'é'.repeat(LIMITS.fileBytes) });
  await assert.rejects(new Workbench().add(h.files, 'CLAUDE.md'), /64 KiB/);
  const rows: Record<string, string> = {};
  for (let i = 0; i < 13; i++) rows[`dir${i}/CLAUDE.md`] = guidance;
  const full = fixture(rows);
  const w = new Workbench();
  for (let i = 0; i < 12; i++) await w.add(full.files, `dir${i}/CLAUDE.md`);
  await assert.rejects(w.add(full.files, 'dir12/CLAUDE.md'), /at most 12/);
});
test('aggregate bytes and binary data are bounded', async () => {
  const rows: Record<string, string> = {};
  for (let i = 0; i < 5; i++) rows[`dir${i}/CLAUDE.md`] = 'a'.repeat(LIMITS.fileBytes);
  const h = fixture(rows);
  const w = new Workbench();
  for (let i = 0; i < 4; i++) await w.add(h.files, `dir${i}/CLAUDE.md`);
  await assert.rejects(w.add(h.files, 'dir4/CLAUDE.md'), /256 KiB/);
  await assert.rejects(
    new Workbench().add(fixture({ 'CLAUDE.md': '\0' }).files, 'CLAUDE.md'),
    /binary/,
  );
});
test('selection changes invalidate report; removal indices are strict', async () => {
  const h = fixture({ 'CLAUDE.md': guidance, 'AGENTS.md': guidance });
  const w = new Workbench();
  await w.add(h.files, 'CLAUDE.md');
  await w.audit(h.files);
  await w.add(h.files, 'AGENTS.md');
  await assert.rejects(w.view(h.files), /Run audit/);
  await w.audit(h.files);
  assert.throws(() => w.remove(0));
  w.remove(2);
  await assert.rejects(w.view(h.files), /Run audit/);
  w.clear();
  await assert.rejects(w.audit(h.files), /Add an instruction/);
});
test('pages remain bounded, reveal omitted evidence, and validate offsets', () => {
  const text = 'x'.repeat(12_000);
  assert.ok(page(text).length < LIMITS.page + 100);
  assert.ok(page(text, 5000).includes('5000–10000'));
  assert.throws(() => page(text, -1));
  assert.throws(() => page(text, 0.5));
});
test('fingerprint is SHA-256 and terminal controls cannot enter report display', async () => {
  assert.equal((await fingerprint('abc')).length, 64);
  assert.ok(
    !report([source('CLAUDE.md', guidance + '\u001b[31m\n' + guidance + '\u001b[31m')]).includes(
      '\u001b',
    ),
  );
});

test('actual read size is bounded even when stat understates the size', async () => {
  const h = fixture({ 'CLAUDE.md': 'a'.repeat(LIMITS.fileBytes + 1) });
  const original = h.files.stat;
  h.files.stat = async (path) => ({ ...(await original(path)), size: 1 });
  await assert.rejects(new Workbench().add(h.files, 'CLAUDE.md'), /oversized/);
});

test('large findings explicitly report omitted groups and occurrences', () => {
  const rows = Array.from(
    { length: 22 },
    (_, i) => `- Run validation for component ${i} before preparing any release.`,
  );
  const text = Array.from({ length: 14 }, () => rows.join('\n')).join('\n');
  const result = report([source('CLAUDE.md', text)]);
  assert.match(result, /2 more group\(s\) omitted/);
  assert.match(result, /2 more occurrence\(s\) omitted/);
});
