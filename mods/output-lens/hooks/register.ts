import type { EngineInterface, Register } from 'claude-code';
import { clean, LIMITS, summary } from '../src/report.ts';
import { Lens } from '../src/session.ts';

const PANE = 'output-lens';
const TOOL = 'mcp__output-lens__report';
const HELP = '/output-lens load <report.json> | summary | failure <index> [offset] | raw [offset] | clear';
interface State { lens: Lens; text: string; message: string; queue: Promise<void> }
const files = ($: EngineInterface) => ({ cwd: () => $.session.cwd(), stat: (path: string) => $.fs.stat(path, { resolve: true }), read: (path: string) => $.fs.read(path) });

const schedule = <T>(state: State, work: () => Promise<T>): Promise<T> => {
  const result = state.queue.then(work);
  state.queue = result.then(() => undefined, () => undefined);
  return result;
};

const act = ($: EngineInterface, state: State, kind: string, value = '') => schedule(state, async () => {
  state.text = '';
  try {
    if (kind === 'load') {
      await state.lens.load(files($), value);
      state.text = await state.lens.view(files($), 'summary');
      state.message = 'Report loaded. Its process exit code and tested source revision are unverified.';
    } else if (kind === 'clear') {
      state.lens.clear(); state.message = 'Report cleared.';
    } else {
      const args = value.trim() ? value.trim().split(/\s+/) : [];
      if (kind === 'failure' && (args.length < 1 || args.length > 2)) throw new Error('Use failure <index> [offset].');
      if (kind === 'raw' && args.length > 1) throw new Error('Use raw [offset].');
      if (kind === 'summary' && args.length) throw new Error('summary takes no arguments.');
      const index = kind === 'failure' ? Number(args[0]) : 1;
      const offset = Number(kind === 'failure' ? args[1] ?? '0' : args[0] ?? '0');
      state.text = await state.lens.view(files($), kind, index, offset);
      state.message = 'Report content reverified. Viewing details does not make a model request.';
    }
    return { text: state.text || state.message };
  } catch (error) {
    state.message = error instanceof Error ? error.message : 'Report inspection failed.';
    return { text: `Output Lens: ${state.message}` };
  } finally { $.ui.invalidate('ui.render'); }
});

const request = ($: EngineInterface, state: State, input: { view?: unknown; index?: unknown; offset?: unknown }) => schedule(state, async () => {
  try {
    const view = input.view ?? 'summary';
    if (typeof view !== 'string' || !['summary', 'failure', 'raw'].includes(view)) throw new Error('Choose summary, failure, or raw.');
    const index = input.index ?? 1;
    const offset = input.offset ?? 0;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 1 || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('index and offset must be valid nonnegative integers; index starts at 1.');
    return { result: await state.lens.view(files($), view, index, offset) };
  } catch (error) {
    state.text = '';
    state.message = error instanceof Error ? error.message : 'Report inspection failed.';
    $.ui.invalidate('ui.render');
    return { result: `Output Lens: ${state.message}`, isError: true as const };
  }
});

export const register: Register = on => {
  const state: State = { lens: new Lens(), text: '', message: 'Load a local Vitest JSON report. No tests run automatically.', queue: Promise.resolve() };
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: PANE, description: 'Inspect a Vitest JSON report and share bounded diagnostics', argumentHint: '[load|summary|failure|raw|clear]' });
    await $.tool.register({ name: 'report', description: 'Read the Vitest report explicitly selected by the user in Output Lens. summary returns bounded counts and failure previews; failure pages one diagnostic by 1-based index; raw pages the original JSON. No tests are run. Report outcomes do not establish process exit status or source-code freshness.', inputSchema: { type: 'object', properties: { view: { type: 'string', enum: ['summary', 'failure', 'raw'] }, index: { type: 'integer', minimum: 1 }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false } });
    return next(e);
  });
  on('session.end', async (_$, e, next) => {
    await schedule(state, async () => { state.lens.clear(); state.text = ''; state.message = 'Report cleared for this session.'; });
    return next(e);
  });
  on('command.run', { command: PANE }, async ($, e) => {
    if (!e.args.trim()) { await $.ui.open({ id: PANE, title: 'Output Lens', focus: true, closeOnEscape: true }); return {}; }
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(e.args.trim());
    const kind = match?.[1] ?? '';
    if (!['load', 'summary', 'failure', 'raw', 'clear'].includes(kind)) return { text: HELP };
    return act($, state, kind, match?.[2] ?? '');
  }).catch(() => ({ text: 'Output Lens could not complete the command. No tests were run.' }));
  on('tool.call', { tool: TOOL }, async ($, e) => request($, state, { view: e.view, index: e.index, offset: e.offset }))
    .catch(() => ({ result: 'Output Lens report unavailable. No tests were executed by the mod.', isError: true }));
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE || (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode')) return next(e);
    const { Box, Text, Input, Button, Code, Select } = $.ui.resolve(e);
    const loaded = state.lens.loaded;
    const run = (kind: string, value = '') => { void act($, state, kind, value); };
    const summarySize = loaded ? summary(loaded.report, loaded.path, loaded.hash).length : 0;
    return Box({ flexDirection: 'column', gap: 1, children: [
      Text({ bold: true, children: ['OUTPUT LENS'] }),
      Text({ children: ['Local report evidence · No model calls · No automatic test execution'] }),
      Input({ key: 'report-path', label: 'JSON report', placeholder: '.vitest/json/output.json', submitLabel: 'Load', onSubmit: value => run('load', value) }),
      ...(loaded ? [
        Text({ bold: true, children: [loaded.report.outcome.toUpperCase()] }),
        Text({ children: [`${loaded.report.passed} passed · ${loaded.report.failed} failed · ${loaded.report.pending} skipped/pending · ${loaded.report.todo} todo`] }),
        Text({ children: [`JSON ${loaded.report.raw.length} characters → summary ${summarySize} characters. Not measured token savings.`] }),
        Text({ dimColor: true, children: [`${clean(loaded.path)} · SHA-256 ${loaded.hash.slice(0, 12)}`] }),
        ...(loaded.report.diagnostics.length ? [Select({ key: 'diagnostics', label: 'Inspect diagnostic', value: 'summary', options: [{ value: 'summary', label: 'Summary' }, ...loaded.report.diagnostics.slice(0, 50).map((item, index) => ({ value: String(index + 1), label: `${index + 1}. ${clean(item.title).slice(0, 100)}` }))], onSelect: value => value === 'summary' ? run('summary') : run('failure', value) })] : []),
        ...(loaded.report.diagnostics.length > 50 ? [Text({ children: ['The selector shows 50 entries; use failure <index> for the remaining diagnostics.'] })] : []),
      ] : []),
      Box({ flexDirection: 'column', gap: 1, children: [
        Button({ key: 'summary', label: 'Verify and show summary', onPress: () => run('summary') }),
        Button({ key: 'raw', label: `Show first ${LIMITS.pageCharacters} raw characters`, onPress: () => run('raw') }),
        Input({ key: 'raw-offset', label: 'Raw offset', placeholder: '5000', submitLabel: 'Read', onSubmit: value => run('raw', value) }),
        Button({ key: 'clear', label: 'Clear report', onPress: () => run('clear') }),
      ] }),
      Text({ children: [state.message] }),
      ...(state.text ? [Code({ source: state.text, language: 'text', wrap: 'wrap' })] : []),
    ] });
  });
};
