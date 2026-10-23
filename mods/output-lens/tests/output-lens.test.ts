import { expect, test } from 'claude-code/testing';

const passing = JSON.stringify({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numFailedTestSuites: 0, success: true, testResults: [{ name: '/repo/app.test.ts', status: 'passed', message: '', assertionResults: [{ fullName: 'works', status: 'passed', failureMessages: [] }] }] });

test('registered report tool refuses unselected evidence, summarizes a loaded report, and rejects mutation', async ($, on) => {
  let source = passing;
  on('session.cwd', () => ({ value: '/repo' }));
  on('fs.stat', (_$, e) => ({ value: { kind: e.path === '/repo' ? 'dir' : 'file', size: e.path === '/repo' ? 0 : source.length, mtimeMs: 0, isLink: false, realPath: e.path } }));
  on('fs.read', () => ({ value: source }));
  const missing = await $.tool.call({ tool: 'mcp__output-lens__report', view: 'summary' });
  expect(missing.isError).toBe(true);
  const loaded = await $.command.run({ command: 'output-lens', args: 'load report.json', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } });
  expect(loaded.text).toContain('reported passed');
  const compact = await $.tool.call({ tool: 'mcp__output-lens__report', view: 'summary' });
  expect(compact.isError).toBeUndefined();
  expect(String(compact.result)).toContain('Process exit code');
  const raw = await $.tool.call({ tool: 'mcp__output-lens__report', view: 'raw', offset: 0 });
  expect(String(raw.result)).toContain(passing);
  source = passing + '\n';
  const stale = await $.tool.call({ tool: 'mcp__output-lens__report', view: 'summary' });
  expect(stale.isError).toBe(true);
  expect(String(stale.result)).toContain('changed');
});

test('UI controls validate on all supported surfaces', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'output-lens', surface, component: 'Pane', requestId: 'output-lens', props: { title: 'Output Lens', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} } });
    expect(await ui.find({ key: 'report-path' })).toBeDefined();
    expect(await ui.find({ key: 'summary' })).toBeDefined();
    expect(await ui.find({ key: 'raw-offset' })).toBeDefined();
    await ui.unmount();
  }
});
