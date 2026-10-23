import type { EngineInterface, Register } from 'claude-code';
import { formatPacket, Studio } from '../src/studio.ts';

const PANE = 'context-studio';
const HELP =
  'Commands: /context-studio goal <task> | add <path>:<start>-<end> | remove <number> | preview | draft | clear. With no arguments, opens the pane.';

interface State {
  studio: Studio;
  message: string;
  preview: string;
  busy: boolean;
  queue: Promise<void>;
}

const files = ($: EngineInterface) => ({
  cwd: () => $.session.cwd(),
  stat: (path: string) => $.fs.stat(path, { resolve: true }),
  read: (path: string) => $.fs.read(path),
});

// Serialize file reads, UI actions, and lifecycle resets.
const schedule = <T>(state: State, work: () => Promise<T>): Promise<T> => {
  const result = state.queue.then(work);
  state.queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const act = ($: EngineInterface, state: State, action: string, value = '') =>
  schedule(state, async () => {
    state.busy = true;
    $.ui.invalidate('ui.render');
    try {
      await state.studio.checkWorkspace(files($));
      state.preview = '';
      switch (action) {
        case 'goal':
          state.studio.setGoal(value);
          state.message = 'Task updated.';
          break;
        case 'add':
          await state.studio.add(files($), value);
          state.message = 'Excerpt added. Sources are checked again before preview or draft.';
          break;
        case 'remove':
          state.studio.remove(Number(value));
          state.message = 'Excerpt removed.';
          break;
        case 'clear':
          state.studio.reset();
          state.message = 'Task and excerpts cleared.';
          break;
        case 'preview':
          state.preview = await state.studio.packet(files($));
          state.message = 'Sources verified now. This is a snapshot, not continuous monitoring.';
          break;
        case 'draft': {
          const packet = await state.studio.packet(files($));
          const result = await $.prompt.fill({ text: `\n\n${packet}\n`, mode: 'append' });
          if (!result.isFilled)
            throw new Error(
              'No prompt editor is available. Use preview and copy its text instead.',
            );
          state.preview = packet;
          state.message =
            'Appended to your draft. Review it and press Enter yourself. Rebuild it if source files change.';
          break;
        }
        default:
          throw new Error(HELP);
      }
      return { text: action === 'preview' ? state.preview : state.message };
    } catch (error) {
      state.preview = '';
      state.message =
        error instanceof Error ? error.message : 'Action failed. No packet was prepared.';
      return { text: `Context Studio: ${state.message}` };
    } finally {
      state.busy = false;
      $.ui.invalidate('ui.render');
    }
  });

export const register: Register = (on) => {
  const state: State = {
    studio: new Studio(),
    message: 'Select a few useful excerpts. No model calls run in the background.',
    preview: '',
    busy: false,
    queue: Promise.resolve(),
  };
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PANE,
      description: 'Build a task packet from selected local source excerpts',
      argumentHint: '[goal|add|remove|preview|draft|clear]',
    });
    return next(e);
  });

  on('session.end', async (_$, e, next) => {
    await schedule(state, async () => {
      state.studio.reset();
      state.preview = '';
      state.message = 'New session. Select excerpts for this task.';
    });
    return next(e);
  });

  on('command.run', { command: PANE }, async ($, e) => {
    if (!e.args.trim()) {
      await $.ui.open({ id: PANE, title: 'Context Studio', focus: true, closeOnEscape: true });
      return {};
    }
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(e.args.trim());
    return act($, state, match?.[1] ?? '', match?.[2] ?? '');
  }).catch(() => ({
    text: 'Context Studio could not complete the command. No prompt was submitted automatically.',
  }));

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    if (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode')
      return next(e);
    const { Box, Text, Input, Button, Code } = $.ui.resolve(e);
    const run = (action: string, value = '') => {
      void act($, state, action, value);
    };
    let characters = 0;
    try {
      characters = formatPacket(state.studio.goal, state.studio.entries).length;
    } catch {
      /* action displays the size error */
    }
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [
        Text({ bold: true, children: ['CONTEXT STUDIO'] }),
        Text({
          children: [
            `${state.studio.entries.length}/12 excerpts · ${characters} characters · ~${Math.ceil(characters / 4)} tokens (rough estimate)`,
          ],
        }),
        Text({
          children: [
            'Existing session instructions remain in force. This packet adds source material.',
          ],
        }),
        Input({
          key: 'task',
          label: 'Task',
          placeholder: 'Add accessible category pagination',
          value: state.studio.goal,
          onSubmit: (value) => run('goal', value),
        }),
        Input({
          key: 'source',
          label: 'Source range',
          placeholder: 'src/app.ts:1-30',
          submitLabel: 'Add',
          onSubmit: (value) => run('add', value),
        }),
        ...state.studio.entries.map((entry, index) =>
          Box({
            key: `source-${index}`,
            flexDirection: 'column',
            children: [
              Text({ children: [`${index + 1}. ${entry.path}:${entry.start}-${entry.end}`] }),
              Text({
                dimColor: true,
                children: [
                  `Snapshot ${entry.fingerprint.slice(0, 12)} · ${entry.text.length} source characters`,
                ],
              }),
              Button({
                key: `remove-${index}`,
                label: `Remove excerpt ${index + 1}`,
                onPress: () => run('remove', String(index + 1)),
              }),
            ],
          }),
        ),
        Box({
          flexDirection: 'column',
          gap: 1,
          children: [
            Button({ key: 'preview', label: 'Verify and preview', onPress: () => run('preview') }),
            Button({
              key: 'draft',
              label: 'Append verified packet to draft',
              onPress: () => run('draft'),
            }),
            Button({ key: 'clear', label: 'Clear packet', onPress: () => run('clear') }),
          ],
        }),
        Text({ children: [state.busy ? 'Working locally…' : state.message] }),
        ...(state.preview
          ? [Code({ source: state.preview, language: 'markdown', wrap: 'wrap' })]
          : []),
      ],
    });
  });
};
