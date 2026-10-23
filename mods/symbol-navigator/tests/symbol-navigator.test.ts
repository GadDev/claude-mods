import { expect, test } from 'claude-code/testing';
import { fingerprint } from '../src/index.ts';

test('explicit index retrieval and selected draft perform no writes or worker starts; stale inputs block insertion', async ($, on) => {
  const content: Record<string, string> = {
    'tsconfig.json': '{}',
    'src/api.ts': 'export const answer = 42;\n',
    'src/use.ts': 'answer;\nanswer;\n',
  };
  const index = {
    kind: 'gaddev.symbol-index',
    schemaVersion: 1,
    compilerVersion: '6.0.3',
    project: 'tsconfig.json',
    inputs: await Promise.all(
      Object.entries(content).map(async ([path, value]) => ({
        path,
        sha256: await fingerprint(value),
        kind: path.endsWith('.json') ? 'config' : 'source',
      })),
    ),
    symbols: [
      {
        id: 's1',
        name: 'answer',
        definitions: [{ path: 'src/api.ts', line: 1, column: 14, endLine: 1 }],
        references: [1, 2].map((line) => ({ path: 'src/use.ts', line, column: 1, endLine: line })),
      },
    ],
  };
  content['symbol-index.json'] = JSON.stringify(index);
  const reads: string[] = [];
  const fills: { text: string; mode: string }[] = [];
  let writes = 0;
  let starts = 0;
  on('session.cwd', () => ({ value: '/repo' }));
  on('fs.stat', (_$, e) => ({
    value: {
      kind: e.path === '/repo' ? 'dir' : 'file',
      size: content[e.path.slice(6)]?.length ?? 0,
      mtimeMs: 0,
      isLink: false,
      realPath: e.path,
    },
  }));
  on('fs.read', (_$, e) => {
    reads.push(e.path);
    return { value: content[e.path.slice(6)] ?? '' };
  });
  on('fs.write', () => {
    writes++;
    throw new Error('Unexpected write');
  });
  on('agent.spawn', () => {
    starts++;
    throw new Error('Unexpected worker start');
  });
  on('prompt.fill', (_$, e) => {
    fills.push({ text: e.text, mode: e.mode });
    return { isFilled: true };
  });
  const run = (args: string) =>
    $.command.run({
      command: 'symbol-navigator',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  await run('load symbol-index.json');
  expect(reads.length).toBe(1);
  expect((await run('find answer')).text).toContain('s1 answer');
  await run('show s1');
  await run('select 2');
  const preview = await run('preview');
  expect(preview.text).toContain('Definition src/api.ts');
  expect(preview.text).toContain('identifier 2:1');
  expect(fills.length).toBe(0);
  await run('draft');
  expect(fills.length).toBe(1);
  expect(fills[0]?.mode).toBe('append');
  content['src/use.ts'] = 'Answer;\nanswer;\n';
  expect((await run('draft')).text).toContain('Stale or unavailable');
  expect(fills.length).toBe(1);
  expect((await run('preview')).text).toContain('Load a generated index');
  expect(starts).toBe(0);
  expect(writes).toBe(0);
});

test('empty and populated panes support actual selection controls on terminal, desktop, and vscode without rendering reads', async ($, on) => {
  const source = 'export const answer = 42;\nanswer;\n';
  const index = JSON.stringify({
    kind: 'gaddev.symbol-index',
    schemaVersion: 1,
    compilerVersion: '6.0.3',
    project: 'tsconfig.json',
    inputs: [
      { path: 'tsconfig.json', sha256: await fingerprint('{}'), kind: 'config' },
      { path: 'src/api.ts', sha256: await fingerprint(source), kind: 'source' },
    ],
    symbols: [
      {
        id: 's1',
        name: 'answer',
        definitions: [{ path: 'src/api.ts', line: 1, column: 14, endLine: 1 }],
        references: [{ path: 'src/api.ts', line: 2, column: 1, endLine: 2 }],
      },
    ],
  });
  const content: Record<string, string> = {
    'tsconfig.json': '{}',
    'src/api.ts': source,
    'index.json': index,
  };
  let reads = 0;
  on('session.cwd', () => ({ value: '/repo' }));
  on('fs.stat', (_$, e) => ({
    value: {
      kind: e.path === '/repo' ? 'dir' : 'file',
      size: content[e.path.slice(6)]?.length ?? 0,
      mtimeMs: 0,
      isLink: false,
      realPath: e.path,
    },
  }));
  on('fs.read', (_$, e) => {
    reads++;
    return { value: content[e.path.slice(6)] ?? '' };
  });
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const count = reads;
    const ui = await $.ui.mount({
      plugin: 'symbol-navigator',
      surface,
      component: 'Pane',
      requestId: 'symbol-navigator',
      props: {
        title: 'Symbol Navigator',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });
    expect(await ui.find({ key: 'index-path' })).toBeDefined();
    expect(reads).toBe(count);
    await ui.press({ key: 'help' });
    expect((await ui.find({ type: 'Code' }))?.text).toContain('npm run symbols:demo');
    expect(reads).toBe(count);
    await ui.input({ key: 'index-path', text: 'index.json' });
    await ui.input({ key: 'symbol-query', text: 'answer' });
    await ui.press({ key: 'show-s1' });
    await ui.press({ key: 'ref-1' });
    expect(JSON.stringify(await ui.drawn())).toContain('Deselect 1');
    await ui.press({ key: 'preview' });
    expect(await ui.find({ type: 'Code' })).toBeDefined();
    expect(JSON.stringify(await ui.drawn())).toContain('Selected reference');
    const after = reads;
    await ui.drawn();
    expect(reads).toBe(after);
    await ui.press({ key: 'clear' });
    expect(await ui.find({ key: 'draft' })).toBeUndefined();
    await ui.unmount();
  }
});

test('guided paging preserves complete packet slices and selection; stale recovery retains the load path on all surfaces', async ($, on) => {
  const source = 'export const target = "' + 'x'.repeat(9200) + '";\n' + 'target;\n'.repeat(17);
  const content: Record<string, string> = { 'tsconfig.json': '{}', 'src/api.ts': source };
  content['index.json'] = JSON.stringify({
    kind: 'gaddev.symbol-index',
    schemaVersion: 1,
    compilerVersion: '6.0.3',
    project: 'tsconfig.json',
    inputs: [
      { path: 'tsconfig.json', sha256: await fingerprint('{}'), kind: 'config' },
      { path: 'src/api.ts', sha256: await fingerprint(source), kind: 'source' },
    ],
    symbols: Array.from({ length: 9 }, (_, i) => ({
      id: `s${i + 1}`,
      name: `target${i + 1}`,
      definitions: [{ path: 'src/api.ts', line: 1, column: 14, endLine: 1 }],
      references: Array.from({ length: 17 }, (_, j) => ({
        path: 'src/api.ts',
        line: j + 2,
        column: 1,
        endLine: j + 2,
      })),
    })),
  });
  on('session.cwd', () => ({ value: '/repo' }));
  on('fs.stat', (_$, e) => ({
    value: {
      kind: e.path === '/repo' ? 'dir' : 'file',
      size: content[e.path.slice(6)]?.length ?? 0,
      mtimeMs: 0,
      isLink: false,
      realPath: e.path,
    },
  }));
  let reads = 0;
  on('fs.read', (_$, e) => {
    reads++;
    return { value: content[e.path.slice(6)] ?? '' };
  });
  const run = (args: string) =>
    $.command.run({
      command: 'symbol-navigator',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    content['src/api.ts'] = source;
    const ui = await $.ui.mount({
      plugin: 'symbol-navigator',
      surface,
      component: 'Pane',
      requestId: 'symbol-navigator',
      props: {
        title: 'Symbol Navigator',
        isFocused: true,
        bodyColumns: 40,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });
    await ui.input({ key: 'index-path', text: 'index.json' });
    await ui.input({ key: 'symbol-query', text: 'target' });
    expect(await ui.find({ key: 'results-previous' })).toBeUndefined();
    await ui.press({ key: 'results-next' });
    expect(await ui.find({ key: 'show-s9' })).toBeDefined();
    expect(await ui.find({ key: 'results-next' })).toBeUndefined();
    await ui.press({ key: 'results-previous' });
    await ui.press({ key: 'show-s1' });
    await ui.press({ key: 'references-next' });
    await ui.press({ key: 'ref-9' });
    await ui.press({ key: 'references-previous' });
    await ui.press({ key: 'references-next' });
    expect((await ui.find({ key: 'ref-9' }))?.text).toContain('Deselect');
    const packet = (await run('preview')).text ?? '';
    await ui.press({ key: 'preview' });
    let assembled = '';
    for (let offset = 0; offset < packet.length; offset += 4000) {
      const code = await ui.find({ type: 'Code' });
      expect(code?.props.source).toBe(packet.slice(offset, offset + 4000));
      assembled += String(code?.props.source ?? '');
      if (offset + 4000 < packet.length) await ui.press({ key: 'packet-next' });
    }
    expect(assembled).toBe(packet);
    expect(await ui.find({ key: 'packet-next' })).toBeUndefined();
    await ui.press({ key: 'packet-previous' });
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(packet.slice(4000, 8000));
    const after = reads;
    await ui.drawn();
    expect(reads).toBe(after);
    content['src/api.ts'] = source + '// changed';
    await ui.press({ key: 'packet-next' });
    expect(await ui.find({ key: 'draft' })).toBeUndefined();
    expect(await ui.find({ type: 'Code' })).toBeUndefined();
    expect(JSON.stringify(await ui.drawn())).toContain('Rebuild');
    expect((await ui.find({ key: 'index-path' }))?.props.value).toBe('index.json');
    await ui.press({ key: 'clear' });
    await ui.unmount();
  }
});

test('malformed index and absent editor keep usable source selection', async ($, on) => {
  const source = 'export const answer = 42;';
  const index = JSON.stringify({
    kind: 'gaddev.symbol-index',
    schemaVersion: 1,
    compilerVersion: '6.0.3',
    project: 'tsconfig.json',
    inputs: [
      { path: 'tsconfig.json', sha256: await fingerprint('{}'), kind: 'config' },
      { path: 'src/a.ts', sha256: await fingerprint(source), kind: 'source' },
    ],
    symbols: [
      {
        id: 's1',
        name: 'answer',
        definitions: [{ path: 'src/a.ts', line: 1, column: 14, endLine: 1 }],
        references: [],
      },
    ],
  });
  const content: Record<string, string> = {
    'index.json': index,
    'bad.json': '{',
    'tsconfig.json': '{}',
    'src/a.ts': source,
  };
  on('session.cwd', () => ({ value: '/repo' }));
  on('fs.stat', (_$, e) => ({
    value: {
      kind: e.path === '/repo' ? 'dir' : 'file',
      size: content[e.path.slice(6)]?.length ?? 0,
      mtimeMs: 0,
      isLink: false,
      realPath: e.path,
    },
  }));
  on('fs.read', (_$, e) => ({ value: content[e.path.slice(6)] ?? '' }));
  on('prompt.fill', () => ({ isFilled: false }));
  const run = (args: string) =>
    $.command.run({
      command: 'symbol-navigator',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  await run('load index.json');
  await run('show s1');
  expect((await run('draft')).text).toContain('No prompt editor');
  expect((await run('load bad.json')).text).toContain('Invalid index JSON');
  expect((await run('preview')).text).toContain('42');
});
