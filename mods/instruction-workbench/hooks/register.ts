import type { EngineInterface, Register } from 'claude-code';
import { clean, Workbench } from '../src/audit.ts';

const NAME = 'instruction-workbench';
const HELP = '/instruction-workbench add <path> | remove <index> | audit | page [offset] | clear';
interface State {
  workbench: Workbench;
  text: string;
  message: string;
  queue: Promise<void>;
}
const files = ($: EngineInterface) => ({
  cwd: () => $.session.cwd(),
  stat: (path: string) => $.fs.stat(path, { resolve: true }),
  read: (path: string) => $.fs.read(path),
});
const schedule = <T>(state: State, work: () => Promise<T>): Promise<T> => {
  const result = state.queue.then(work);
  state.queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};
const act = ($: EngineInterface, state: State, kind: string, value = '') =>
  schedule(state, async () => {
    state.text = '';
    try {
      if (kind === 'add') {
        await state.workbench.add(files($), value);
        state.message =
          'Source selected. Run audit to verify and compare selected instruction text.';
      } else if (kind === 'remove') {
        state.workbench.remove(Number(value));
        state.message = 'Source removed. Run audit again.';
      } else if (kind === 'clear') {
        state.workbench.clear();
        state.message = 'Sources and report cleared.';
      } else if (kind === 'audit') {
        if (value.trim()) throw new Error('audit takes no arguments.');
        state.text = await state.workbench.audit(files($));
        state.message = 'Selected sources reverified. Findings are review-only proposals.';
      } else if (kind === 'page') {
        state.text = await state.workbench.view(files($), Number(value || '0'));
        state.message = 'Selected sources reverified before report retrieval.';
      }
      return { text: state.text || state.message };
    } catch (error) {
      state.message = error instanceof Error ? error.message : 'Instruction review failed.';
      return { text: `Instruction Workbench: ${state.message}` };
    } finally {
      $.ui.invalidate('ui.render');
    }
  });

export const register: Register = (on) => {
  const state: State = {
    workbench: new Workbench(),
    text: '',
    message: 'Select instruction files explicitly. No reads happen when opening this pane.',
    queue: Promise.resolve(),
  };
  on('session.start', async ($, e, next) => {
    await schedule(state, async () => {
      state.workbench.clear();
      state.text = '';
    });
    await $.command.register({
      name: NAME,
      description: 'Review selected instruction sources and exact duplicate guidance locally',
      argumentHint: '[add|remove|audit|page|clear]',
    });
    return next(e);
  });
  on('session.end', async (_$, e, next) => {
    await schedule(state, async () => {
      state.workbench.clear();
      state.text = '';
      state.message = 'Sources cleared for this session.';
    });
    return next(e);
  });
  on('command.run', { command: NAME }, async ($, e) => {
    if (!e.args.trim()) {
      await $.ui.open({
        id: NAME,
        title: 'Instruction Workbench',
        focus: true,
        closeOnEscape: true,
      });
      return {};
    }
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(e.args.trim());
    const kind = match?.[1] ?? '';
    if (!['add', 'remove', 'audit', 'page', 'clear'].includes(kind)) return { text: HELP };
    if (kind === 'clear' && match?.[2]?.trim()) return { text: HELP };
    return act($, state, kind, match?.[2] ?? '');
  }).catch(() => ({
    text: 'Instruction Workbench could not complete the review. No edits were applied.',
  }));
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (
      e.requestId !== NAME ||
      (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode')
    )
      return next(e);
    const { Box, Text, Input, Button, Code } = $.ui.resolve(e);
    const run = (kind: string, value = '') => {
      void act($, state, kind, value);
    };
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [
        Text({ bold: true, children: ['INSTRUCTION WORKBENCH'] }),
        Text({
          children: ['Selected files only · Review proposals · No model calls or file edits'],
        }),
        Input({
          key: 'instruction-path',
          label: 'Instruction source',
          placeholder: 'CLAUDE.md or .claude/rules/testing.md',
          submitLabel: 'Add',
          onSubmit: (value) => run('add', value),
        }),
        Text({
          children: [
            `${state.workbench.sources.length}/12 selected · Effective instruction loading is unverified`,
          ],
        }),
        ...state.workbench.sources.map((source, index) =>
          Box({
            flexDirection: 'column',
            gap: 1,
            children: [
              Text({
                children: [
                  `${index + 1}. ${clean(source.path)} · ${source.text.length} characters`,
                  source.scope,
                ],
              }),
              Button({
                key: `remove-${index + 1}`,
                label: `Remove source ${index + 1}`,
                onPress: () => run('remove', String(index + 1)),
              }),
            ],
          }),
        ),
        Button({
          key: 'audit',
          label: 'Verify sources and audit duplicates',
          onPress: () => run('audit'),
        }),
        Input({
          key: 'report-offset',
          label: 'Report character offset',
          placeholder: '5000',
          submitLabel: 'Read page',
          onSubmit: (value) => run('page', value),
        }),
        Button({ key: 'clear', label: 'Clear sources and report', onPress: () => run('clear') }),
        Text({ children: [state.message] }),
        ...(state.text ? [Code({ source: state.text, language: 'text', wrap: 'wrap' })] : []),
      ],
    });
  });
};
