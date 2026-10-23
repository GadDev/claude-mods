import { expect, test } from 'claude-code/testing';

test('native commands retain exact source provenance and reject changed content', async ($, on) => {
  let source = 'export const answer = 42;\n';
  on('session.cwd', () => ({ value: '/repo' }));
  on('fs.stat', (_$, e) => ({
    value: {
      kind: e.path === '/repo' ? 'dir' : 'file',
      size: e.path === '/repo' ? 0 : source.length,
      mtimeMs: 0,
      isLink: false,
      realPath: e.path,
    },
  }));
  on('fs.read', () => ({ value: source }));
  const command = (args: string) =>
    $.command.run({
      command: 'context-studio',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  await command('goal Explain the constant');
  await command('add src/app.ts:1-1');
  const preview = await command('preview');
  expect(preview.text).toContain('export const answer = 42;');
  expect(preview.text).toContain('SHA-256');
  source = 'export const answer = 43;\n';
  const stale = await command('preview');
  expect(stale.text).toContain('Stale excerpt');
});

test('native UI trees validate on terminal, Desktop, and VS Code', async ($) => {
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'context-studio',
      surface,
      component: 'Pane',
      requestId: 'context-studio',
      props: {
        title: 'Context Studio',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });
    expect(await ui.find({ key: 'task' })).toBeDefined();
    expect(await ui.find({ key: 'source' })).toBeDefined();
    expect(await ui.find({ key: 'draft' })).toBeDefined();
    await ui.unmount();
  }
});
