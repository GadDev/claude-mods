import { expect, test } from 'claude-code/testing';

test('selected instruction review has no writes and rejects changed evidence', async ($, on) => {
  let content =
    '- Run the repository checks before opening any pull request.\n- Run the repository checks before opening any pull request.';
  let writes = 0;
  on('session.cwd', () => ({ value: '/repo' }));
  on('fs.stat', (_$, e) => ({
    value: {
      kind: e.path === '/repo' ? 'dir' : 'file',
      size: e.path === '/repo' ? 0 : content.length,
      mtimeMs: 0,
      isLink: false,
      realPath: e.path,
    },
  }));
  on('fs.read', () => ({ value: content }));
  on('fs.write', (_$, e, next) => {
    writes++;
    return next(e);
  });
  const run = (args: string) =>
    $.command.run({
      command: 'instruction-workbench',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  await run('add CLAUDE.md');
  const review = await run('audit');
  expect(review.text).toContain('1 EXACT DUPLICATE');
  expect(review.text).toContain('CLAUDE.md:2');
  expect(writes).toBe(0);
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'instruction-workbench',
      surface,
      component: 'Pane',
      requestId: 'instruction-workbench',
      props: {
        title: 'Instruction Workbench',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });
    expect(await ui.find({ key: 'remove-1' })).toBeDefined();
    expect(await ui.find({ type: 'Code' })).toBeDefined();
    await ui.unmount();
  }
  content = content.replace('Run', 'Try');
  const stale = await run('page');
  expect(stale.text).toContain('changed');
  expect((await run('audit')).text).toContain('Add an instruction');
});

test('pane validates on terminal, desktop, and vscode without filesystem reads', async ($, on) => {
  let reads = 0;
  on('fs.read', (_$, e, next) => {
    reads++;
    return next(e);
  });
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'instruction-workbench',
      surface,
      component: 'Pane',
      requestId: 'instruction-workbench',
      props: {
        title: 'Instruction Workbench',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });
    expect(await ui.find({ key: 'instruction-path' })).toBeDefined();
    expect(await ui.find({ key: 'audit' })).toBeDefined();
    expect(await ui.find({ key: 'report-offset' })).toBeDefined();
    await ui.unmount();
  }
  expect(reads).toBe(0);
});
