import { expect, test } from 'claude-code/testing';

test('observes repeated failures, preserves results, and recognizes later tool success', async ($, on) => {
  let fails = true;
  on('tool.call', { tool: 'Bash' }, () => fails ? { isError: true, result: 'compiler failed', text: 'compiler failed' } : { result: { stdout: 'done', stderr: '', interrupted: false } });
  for (let i = 0; i < 3; i++) {
    const result = await $.tool.call({ tool: 'Bash', command: 'npm test' });
    expect(result.isError).toBe(true); expect(result.result).toBe('compiler failed');
  }
  const command = (args: string) => $.command.run({ command: 'retry-map', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } });
  expect((await command('show')).text).toContain('3 occurrence(s)');
  expect((await command('show')).text).toContain('Repeated failure');
  fails = false; await $.tool.call({ tool: 'Bash', command: 'npm test' });
  expect((await command('show')).text).toContain('Tool later succeeded');
  await command('clear'); expect((await command('show')).text).not.toContain('compiler failed');
});

test('native pane validates and exposes inspectable failures on each supported surface', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'failed', text: 'failed' }));
  await $.tool.call({ tool: 'Bash', command: 'npm test' });
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'retry-map', surface, component: 'Pane', requestId: 'retry-map', props: { title: 'Retry Map', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} } });
    expect(await ui.find({ key: 'inspect-1' })).toBeDefined();
    await ui.press({ key: 'inspect-1' });
    expect(await ui.find({ type: 'Code' })).toBeDefined();
    await ui.unmount();
  }
});

test('staged edits do not reset comparisons, while successful file edits do', async ($, on) => {
  let staged = true;
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'same failure', text: 'same failure' }));
  on('tool.call', { tool: 'Edit' }, (_$, e) => ({ result: { filePath: e.file_path, oldString: e.old_string, newString: e.new_string, originalFile: 'old', structuredPatch: [], userModified: false, replaceAll: false, ...(staged ? { staged: true as const } : {}) } }));
  await $.tool.call({ tool: 'Bash', command: 'npm test' });
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'old', new_string: 'new' });
  await $.tool.call({ tool: 'Bash', command: 'npm test' });
  const command = () => $.command.run({ command: 'retry-map', args: 'show', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } });
  expect((await command()).text).toContain('2 occurrence(s)');
  staged = false;
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'old', new_string: 'new' });
  await $.tool.call({ tool: 'Bash', command: 'npm test' });
  expect((await command()).text).toContain('Before an observed file-tool edit');
  expect((await command()).text).toContain('#2 · 1 occurrence(s)');
});
