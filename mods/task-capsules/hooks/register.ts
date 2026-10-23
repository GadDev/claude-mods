import type { EngineInterface, Register } from 'claude-code';
import { Capsules } from '../src/capsule.ts';

const NAME = 'task-capsules';
const HELP =
  '/task-capsules goal <text> | decision <text> | check <text> | file <path> | edit <decision|check> <index> <text> | remove <decision|check|file> <index> | refresh <file-index> | import <capsule.json> | preview | export | draft | clear';
interface State {
  capsules: Capsules;
  text: string;
  format: 'json' | 'markdown';
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
      if (['preview', 'export', 'draft', 'clear'].includes(kind) && value.trim())
        throw new Error(`${kind} takes no arguments.`);
      if (kind === 'goal') {
        state.capsules.goal(value);
        state.message =
          'Goal updated; existing decisions, references, and unresolved checks retained.';
      } else if (kind === 'decision' || kind === 'check') {
        state.capsules.add(kind, value);
        state.message =
          kind === 'decision'
            ? 'Authored decision added.'
            : 'Unresolved check added. This mod does not run or verify checks.';
      } else if (kind === 'edit') {
        const match = /^(decision|check)\s+(\d+)\s+([\s\S]+)$/.exec(value);
        if (!match) throw new Error('Use edit <decision|check> <index> <text>.');
        state.capsules.edit(match[1] as 'decision' | 'check', Number(match[2]), match[3] ?? '');
        state.message = 'Authored item updated.';
      } else if (kind === 'remove') {
        const match = /^(decision|check|file)\s+(\d+)$/.exec(value);
        if (!match) throw new Error('Use remove <decision|check|file> <index>.');
        state.capsules.remove(match[1] as 'decision' | 'check' | 'file', Number(match[2]));
        state.message = 'Item removed.';
      } else if (kind === 'file') {
        await state.capsules.file(files($), value);
        state.message =
          'File text fingerprint captured. No source content is included in the capsule.';
      } else if (kind === 'refresh') {
        await state.capsules.refresh(files($), Number(value));
        state.message =
          'Current file text fingerprint captured explicitly. Review your decisions against this version.';
      } else if (kind === 'import') {
        await state.capsules.importFile(files($), value);
        state.message =
          'Capsule imported. Notes are authored data; file references and unresolved checks are unverified.';
      } else if (kind === 'clear') {
        state.capsules.clear();
        state.message = 'Current capsule cleared. Export before clearing if you need to keep it.';
      } else if (kind === 'draft') {
        const handoff = await state.capsules.draft(files($));
        const result = await $.prompt.fill({ text: `\n\n${handoff}\n`, mode: 'append' });
        if (!result.isFilled)
          throw new Error(
            'No prompt editor is available. Use preview and copy the handoff instead.',
          );
        state.text = handoff;
        state.format = 'markdown';
        state.message =
          'Appended to the current draft. Review it before sending. No session was opened or message submitted.';
      } else if (kind === 'preview' || kind === 'export') {
        const review = await state.capsules.inspect(files($));
        state.text = kind === 'export' ? review.json : review.handoff;
        state.format = kind === 'export' ? 'json' : 'markdown';
        const flagged = review.files.filter((file) => file.status !== 'matching').length;
        state.message =
          kind === 'export'
            ? `Copy this complete JSON to a local .json file; no file was written. ${flagged} reference(s) need review. Freshness is not carried into another session.`
            : `Reference check completed: ${flagged} need review. All checklist items remain unresolved. Results are point-in-time only.`;
      } else throw new Error(HELP);
      return {
        text: kind === 'export' ? `${state.message}\n\n${state.text}` : state.text || state.message,
      };
    } catch (error) {
      state.message =
        error instanceof Error
          ? error.message
          : 'Capsule action failed. Existing authored content is retained.';
      return { text: `Task Capsules: ${state.message}` };
    } finally {
      $.ui.invalidate('ui.render');
    }
  });
export const register: Register = (on) => {
  const state: State = {
    capsules: new Capsules(),
    text: '',
    format: 'markdown',
    message:
      'Build one small handoff. Export JSON before leaving the session; nothing is saved automatically.',
    queue: Promise.resolve(),
  };
  on('session.start', async ($, e, next) => {
    await schedule(state, async () => {
      state.capsules.clear();
      state.text = '';
    });
    await $.command.register({
      name: NAME,
      description: 'Prepare and review a small human-authored task handoff',
      argumentHint:
        '[goal|decision|check|file|edit|remove|refresh|import|preview|export|draft|clear]',
    });
    return next(e);
  });
  on('session.end', async (_$, e, next) => {
    await schedule(state, async () => {
      state.capsules.clear();
      state.text = '';
      state.message = 'Session capsule cleared.';
    });
    return next(e);
  });
  on('command.run', { command: NAME }, async ($, e) => {
    if (!e.args.trim()) {
      await $.ui.open({ id: NAME, title: 'Task Capsules', focus: true, closeOnEscape: true });
      return {};
    }
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(e.args.trim());
    return act($, state, match?.[1] ?? '', match?.[2] ?? '');
  }).catch(() => ({
    text: 'Task Capsules could not complete the action. No message was submitted.',
  }));
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (
      e.requestId !== NAME ||
      (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode')
    )
      return next(e);
    const { Box, Text, Input, Button, Code } = $.ui.resolve(e);
    const capsule = state.capsules.current;
    const run = (kind: string, value = '') => {
      void act($, state, kind, value);
    };
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [
        Text({ bold: true, children: ['TASK CAPSULES'] }),
        Text({
          children: [
            'One focused handoff · Authored notes · No automatic capture, saving, or model calls',
          ],
        }),
        Input({
          key: 'goal',
          label: 'Task goal',
          value: capsule?.goal ?? '',
          placeholder: 'What should the next session accomplish?',
          submitLabel: 'Save goal',
          onSubmit: (value) => run('goal', value),
        }),
        ...(capsule
          ? [
              Text({ bold: true, children: [`DECISIONS · ${capsule.decisions.length}/8`] }),
              ...capsule.decisions.flatMap((item, index) => [
                Input({
                  key: `decision-${index + 1}`,
                  label: `Decision ${index + 1}`,
                  value: item,
                  submitLabel: 'Update',
                  onSubmit: (value) => run('edit', `decision ${index + 1} ${value}`),
                }),
                Button({
                  key: `remove-decision-${index + 1}`,
                  label: `Remove decision ${index + 1}`,
                  onPress: () => run('remove', `decision ${index + 1}`),
                }),
              ]),
              Input({
                key: 'add-decision',
                label: 'Add decision',
                placeholder: 'A decision worth carrying forward',
                submitLabel: 'Add',
                onSubmit: (value) => run('decision', value),
              }),
              Text({ bold: true, children: [`UNRESOLVED CHECKS · ${capsule.checks.length}/8`] }),
              ...capsule.checks.flatMap((item, index) => [
                Input({
                  key: `check-${index + 1}`,
                  label: `Unresolved check ${index + 1}`,
                  value: item,
                  submitLabel: 'Update',
                  onSubmit: (value) => run('edit', `check ${index + 1} ${value}`),
                }),
                Button({
                  key: `remove-check-${index + 1}`,
                  label: `Remove unresolved check ${index + 1}`,
                  onPress: () => run('remove', `check ${index + 1}`),
                }),
              ]),
              Input({
                key: 'add-check',
                label: 'Add unresolved check',
                placeholder: 'What still needs checking?',
                submitLabel: 'Add',
                onSubmit: (value) => run('check', value),
              }),
              Text({ bold: true, children: [`FILE REFERENCES · ${capsule.files.length}/8`] }),
              Text({
                dimColor: true,
                children: [
                  'Statuses below are from the last explicit review, not continuous monitoring.',
                ],
              }),
              ...capsule.files.flatMap((file, index) => [
                Text({
                  children: [
                    `${index + 1}. ${file.path} · ${state.capsules.review?.files[index]?.status ?? 'unverified'} · ${file.sha256.slice(0, 12)}`,
                  ],
                }),
                Button({
                  key: `refresh-${index + 1}`,
                  label: `Capture current version of file ${index + 1}`,
                  onPress: () => run('refresh', String(index + 1)),
                }),
                Button({
                  key: `remove-file-${index + 1}`,
                  label: `Remove file ${index + 1}`,
                  onPress: () => run('remove', `file ${index + 1}`),
                }),
              ]),
              Input({
                key: 'add-file',
                label: 'Add relative file reference',
                placeholder: 'src/auth.ts',
                submitLabel: 'Capture hash',
                onSubmit: (value) => run('file', value),
              }),
              Button({
                key: 'preview',
                label: 'Verify files and preview handoff',
                onPress: () => run('preview'),
              }),
              Button({
                key: 'export',
                label: 'Export JSON for saving',
                onPress: () => run('export'),
              }),
              Button({
                key: 'draft',
                label: 'Append verified handoff to current draft',
                onPress: () => run('draft'),
              }),
            ]
          : []),
        Input({
          key: 'import',
          label: 'Import JSON (replaces current capsule)',
          placeholder: 'handoffs/auth-cleanup.capsule.json',
          submitLabel: 'Import',
          onSubmit: (value) => run('import', value),
        }),
        Button({
          key: 'clear',
          label: 'Clear current capsule (export first to keep it)',
          onPress: () => run('clear'),
        }),
        Text({ children: [state.message] }),
        ...(state.text ? [Code({ source: state.text, language: state.format, wrap: 'wrap' })] : []),
      ],
    });
  });
};
