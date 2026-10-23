import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fingerprint,
  formatPacket,
  isInside,
  LIMITS,
  parseSelection,
  Studio,
} from '../mods/context-studio/src/studio.ts';
import type { Files, FileStat } from '../mods/context-studio/src/studio.ts';

function fixture() {
  const sources = new Map([['/repo/src/app.ts', 'const first = 1;\nconst second = 2;\n']]);
  let directory = '/repo';
  const files: Files = {
    cwd: async () => directory,
    stat: async (path) => {
      if (path === directory) return { kind: 'dir', size: 0, mtimeMs: 0, realPath: directory };
      const text = sources.get(path);
      if (text === undefined) throw new Error('Missing source');
      return { kind: 'file', size: Buffer.byteLength(text), mtimeMs: 0, realPath: path };
    },
    read: async (path) => {
      const text = sources.get(path);
      if (text === undefined) throw new Error('Missing source');
      return text;
    },
  };
  return {
    files,
    sources,
    changeDirectory: (value: string) => {
      directory = value;
    },
  };
}

test('source range parsing handles paths containing spaces', () => {
  assert.deepEqual(parseSelection('src/my app.ts:2-12'), {
    path: 'src/my app.ts',
    start: 2,
    end: 12,
  });
});

for (const selection of [
  '../secret.ts:1-2',
  '/etc/secret.ts:1-2',
  'src/../secret.ts:1-2',
  '.env:1-2',
  'src/.private.ts:1-2',
  'C:\\secret.ts:1-2',
  'src/secrets.json:1-2',
  'src/file.png:1-2',
  'src/app.ts:0-2',
  'src/app.ts:3-2',
  'src/app.ts:1-201',
  'src/app.ts:1-9999999999999999',
]) {
  test(`rejects invalid selection ${selection}`, () =>
    assert.throws(() => parseSelection(selection)));
}

test('containment checks segment boundaries and Windows separators', () => {
  assert.equal(isInside('/repo', '/repo-other/a.ts'), false);
  assert.equal(isInside('C:\\repo', 'C:\\repo\\src\\a.ts'), true);
  assert.equal(isInside('/repo', '/repo/src/a.ts'), true);
});

test('packet includes exact excerpts, paths, and content fingerprints', async () => {
  const { files } = fixture();
  const studio = new Studio();
  studio.setGoal('Fix the second constant');
  await studio.add(files, 'src/app.ts:2-2');
  const packet = await studio.packet(files);
  assert.match(packet, /src\/app.ts.*:2-2/);
  assert.match(packet, /const second = 2;/);
  assert.ok(!packet.includes('const first'));
  assert.match(packet, /SHA-256 [a-f0-9]{64}/);
});

test('same-size changes with unchanged modification time invalidate a source', async () => {
  const { files, sources } = fixture();
  const studio = new Studio();
  studio.setGoal('Task');
  await studio.add(files, 'src/app.ts:1-1');
  sources.set('/repo/src/app.ts', 'const first = 9;\nconst second = 2;\n');
  await assert.rejects(studio.packet(files), /Stale excerpt/);
});

test('changes outside a selected range also invalidate its snapshot', async () => {
  const { files, sources } = fixture();
  const studio = new Studio();
  studio.setGoal('Task');
  await studio.add(files, 'src/app.ts:1-1');
  sources.set('/repo/src/app.ts', 'const first = 1;\nconst second = 9;\n');
  await assert.rejects(studio.packet(files), /Stale excerpt/);
});

test('missing sources cannot yield a partial successful packet', async () => {
  const { files, sources } = fixture();
  const studio = new Studio();
  studio.setGoal('Task');
  await studio.add(files, 'src/app.ts:1-1');
  sources.clear();
  await assert.rejects(studio.packet(files), /Missing source/);
});

test('symlinks escaping the workspace are rejected before reading', async () => {
  const { files } = fixture();
  let reads = 0;
  const stat = files.stat;
  files.stat = async (path) =>
    path.endsWith('app.ts')
      ? { kind: 'file', size: 2, mtimeMs: 0, realPath: '/outside/app.ts' }
      : stat(path);
  files.read = async () => {
    reads += 1;
    return '';
  };
  await assert.rejects(new Studio().add(files, 'src/app.ts:1-1'), /outside/);
  assert.equal(reads, 0);
});

test('files that change during a read are rejected', async () => {
  const { files } = fixture();
  const stat = files.stat;
  let calls = 0;
  files.stat = async (path) => {
    const entry = await stat(path);
    if (entry.kind === 'file') entry.mtimeMs = calls++;
    return entry;
  };
  await assert.rejects(new Studio().add(files, 'src/app.ts:1-1'), /changed while/);
});

test('oversized and binary inputs are rejected', async () => {
  const { files, sources } = fixture();
  sources.set('/repo/src/app.ts', 'x'.repeat(LIMITS.fileBytes + 1));
  await assert.rejects(new Studio().add(files, 'src/app.ts:1-1'), /no larger/);
  sources.set('/repo/src/app.ts', 'a\0b');
  await assert.rejects(new Studio().add(files, 'src/app.ts:1-1'), /binary/);
});

test('invalid ranges and duplicate excerpts do not modify the selection', async () => {
  const { files } = fixture();
  const studio = new Studio();
  await assert.rejects(studio.add(files, 'src/app.ts:1-3'), /File has 2 lines/);
  await studio.add(files, 'src/app.ts:1-1');
  await assert.rejects(studio.add(files, 'src/app.ts:1-1'), /already selected/);
  assert.equal(studio.entries.length, 1);
});

test('changing workspaces clears task data', async () => {
  const { files, changeDirectory } = fixture();
  const studio = new Studio();
  studio.setGoal('Task');
  await studio.add(files, 'src/app.ts:1-1');
  changeDirectory('/other');
  await assert.rejects(studio.packet(files), /Working directory changed/);
  assert.equal(studio.entries.length, 0);
  assert.equal(studio.goal, '');
});

test('empty tasks and packets are rejected', async () => {
  const { files } = fixture();
  const studio = new Studio();
  assert.throws(() => studio.setGoal(' '));
  await assert.rejects(studio.packet(files), /Set a task/);
});

test('packet boundaries use fences longer than source backticks', async () => {
  const { files, sources } = fixture();
  sources.set('/repo/src/app.ts', '```\ntext\n```');
  const studio = new Studio();
  studio.setGoal('Task');
  await studio.add(files, 'src/app.ts:1-3');
  assert.match(await studio.packet(files), /````\n```/);
});

test('packet limit is checked before adding to the selection', async () => {
  const { files, sources } = fixture();
  sources.set('/repo/src/app.ts', 'x'.repeat(24_000));
  const studio = new Studio();
  await assert.rejects(studio.add(files, 'src/app.ts:1-1'), /Packet exceeds/);
  assert.equal(studio.entries.length, 0);
});

test('fingerprints are deterministic and content-sensitive', async () => {
  assert.equal(await fingerprint('a'), await fingerprint('a'));
  assert.notEqual(await fingerprint('a'), await fingerprint('b'));
});

test('formatting does not claim measured savings', () => {
  assert.ok(!formatPacket('Task', []).includes('saved'));
});

test('unresolvable roots fail closed', async () => {
  const { files } = fixture();
  files.stat = async (): Promise<FileStat> => ({ kind: 'dir', size: 0, mtimeMs: 0 });
  await assert.rejects(new Studio().checkWorkspace(files), /Cannot resolve/);
});
