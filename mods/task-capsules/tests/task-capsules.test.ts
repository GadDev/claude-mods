import { expect, test } from 'claude-code/testing';

test('explicit export/import preserves handoff data; draft appends only after re-verification', async ($, on) => {
  let source = 'export const enabled = true;';
  let saved = '';
  let writes = 0;
  const reads: string[] = [];
  const fills: { text: string; mode: string }[] = [];
  on('session.cwd', () => ({ value: '/repo' }));
  on('fs.stat', (_$, e) => ({
    value: {
      kind: e.path === '/repo' ? 'dir' : 'file',
      size: e.path.endsWith('.json') ? saved.length : source.length,
      mtimeMs: 0,
      isLink: false,
      realPath: e.path,
    },
  }));
  on('fs.read', (_$, e) => {
    reads.push(e.path);
    return { value: e.path.endsWith('.json') ? saved : source };
  });
  on('fs.write', (_$, e, next) => {
    writes++;
    return next(e);
  });
  on('prompt.fill', (_$, e) => {
    fills.push({ text: e.text, mode: e.mode });
    return { isFilled: true };
  });
  const run = (args: string) =>
    $.command.run({
      command: 'task-capsules',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  await run('goal Finish auth cleanup');
  await run('decision Keep the public API');
  await run('check Run auth tests');
  await run('file src/auth.ts');
  const exported = await run('export');
  const result = exported.text ?? '';
  saved = result.slice(result.indexOf('{'));
  expect(JSON.parse(saved).goal).toBe('Finish auth cleanup');
  expect(fills.length).toBe(0);
  expect(writes).toBe(0);
  await run('clear');
  const previousReads = reads.length;
  await run('import handoffs/auth.json');
  expect(reads.slice(previousReads)).toEqual(['/repo/handoffs/auth.json']);
  const handoff = await run('preview');
  expect(handoff.text).toContain('unresolved and unverified');
  expect(handoff.text).toContain('matching');
  await run('draft');
  expect(fills.length).toBe(1);
  expect(fills[0]?.mode).toBe('append');
  expect(fills[0]?.text).toContain('Run auth tests');
  source = 'export const enabled = True;';
  expect((await run('draft')).text).toContain('need review');
  expect(fills.length).toBe(1);
  expect((await run('preview')).text).toContain('changed');
  await run('refresh 1');
  await run('draft');
  expect(fills.length).toBe(2);
  expect(writes).toBe(0);
});

test('empty and populated panes validate without rendering reads on all supported surfaces', async ($, on) => {
  let reads = 0;
  on('fs.read', (_$, e, next) => {
    reads++;
    return next(e);
  });
  const run = (args: string) =>
    $.command.run({
      command: 'task-capsules',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const empty = await $.ui.mount({
      plugin: 'task-capsules',
      surface,
      component: 'Pane',
      requestId: 'task-capsules',
      props: {
        title: 'Task Capsules',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });
    expect(await empty.find({ key: 'goal' })).toBeDefined();
    expect(await empty.find({ key: 'import' })).toBeDefined();
    await empty.unmount();
    await run('goal Review the editor');
    await run('decision Keep the public API');
    await run('check Run tests');
    await run('preview');
    const loaded = await $.ui.mount({
      plugin: 'task-capsules',
      surface,
      component: 'Pane',
      requestId: 'task-capsules',
      props: {
        title: 'Task Capsules',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });
    expect(await loaded.find({ key: 'decision-1' })).toBeDefined();
    expect(await loaded.find({ key: 'check-1' })).toBeDefined();
    expect(await loaded.find({ key: 'export' })).toBeDefined();
    expect(await loaded.find({ type: 'Code' })).toBeDefined();
    await loaded.input({ key: 'decision-1', text: 'Preserve the API contract' });
    expect(JSON.stringify(await loaded.drawn())).toContain('Preserve the API contract');
    await loaded.unmount();
    await run('clear');
  }
  expect(reads).toBe(0);
});

test('missing prompt editors and malformed replacement imports retain authored work', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }));
  on('fs.stat', (_$, e) => ({
    value: {
      kind: e.path === '/repo' ? 'dir' : 'file',
      size: 1,
      mtimeMs: 0,
      isLink: false,
      realPath: e.path,
    },
  }));
  on('fs.read', () => ({ value: '{' }));
  on('prompt.fill', () => ({ isFilled: false }));
  const run = (args: string) =>
    $.command.run({
      command: 'task-capsules',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  await run('goal Keep my notes');
  expect((await run('import broken.json')).text).toContain('Invalid capsule JSON');
  expect((await run('preview')).text).toContain('Keep my notes');
  expect((await run('draft')).text).toContain('No prompt editor');
  expect((await run('preview')).text).toContain('Keep my notes');
});
