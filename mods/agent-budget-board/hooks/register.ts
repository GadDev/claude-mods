import type { EngineInterface, Register } from 'claude-code';
import { Board } from '../src/board.ts';
import type { WorkerField } from '../src/board.ts';
const NAME = 'agent-budget-board';
const HELP =
  '/agent-budget-board goal <text> | add <id> | set <id> <role|task|model|access|scopes> <value> | remove <id> | concurrency <1-8> | review | page [offset] | approve [acknowledge] | export | load <json> | draft | clear';
interface State {
  board: Board;
  text: string;
  format: 'text' | 'json';
  message: string;
  queue: Promise<void>;
}
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
      if (['review', 'export', 'draft', 'clear'].includes(kind) && value.trim())
        throw new Error(`${kind} takes no arguments.`);
      if (kind === 'goal') state.board.goal(value);
      else if (kind === 'add') state.board.add(value.trim());
      else if (kind === 'remove') state.board.remove(value.trim());
      else if (kind === 'concurrency') state.board.concurrency(Number(value));
      else if (kind === 'set') {
        const match = /^(\S+)\s+(role|task|model|access|scopes)(?:\s+([\s\S]*))?$/.exec(value);
        if (!match) throw new Error('Use set <id> <role|task|model|access|scopes> <value>.');
        state.board.edit(match[1] ?? '', match[2] as WorkerField, match[3] ?? '');
      } else if (kind === 'load') {
        state.board.load(value);
        state.message =
          'Plan JSON imported. Local approval is reset; review this authored data before use.';
      } else if (kind === 'clear') {
        state.board.clear();
        state.message = 'Plan and approval cleared. No workers were stopped or started.';
      } else if (kind === 'review') {
        const review = await state.board.review();
        state.text = state.board.view();
        state.format = 'text';
        state.message = `${review.blockers.length} approval blocker(s), ${review.warnings.length} warning(s). Inspect all report pages before approval.`;
      } else if (kind === 'page') {
        state.text = state.board.view(Number(value || '0'));
        state.format = 'text';
        state.message = 'Saved-plan review page. No worker activity is observed or changed.';
      } else if (kind === 'approve') {
        if (value && value !== 'acknowledge')
          throw new Error('Use approve, or approve acknowledge after reviewing warnings.');
        await state.board.approve(value === 'acknowledge');
        state.message =
          'Current plan approved locally. No workers started and no engine permissions changed.';
      } else if (kind === 'export') {
        state.text = state.board.export();
        state.format = 'json';
        state.message =
          'Copy this complete JSON to save it. No file was written; approval is not exported.';
      } else if (kind === 'draft') {
        const result = await $.prompt.fill({
          text: `\n\n${state.board.draft()}\n`,
          mode: 'append',
        });
        if (!result.isFilled)
          throw new Error(
            'No prompt editor is available. Export and copy the reviewed plan instead.',
          );
        state.message =
          'Reviewed plan appended to the current draft. Read it before sending. Nothing was submitted or started.';
      } else throw new Error(HELP);
      if (['goal', 'add', 'remove', 'concurrency', 'set'].includes(kind))
        state.message = 'Saved plan changed. Review and approval reset. No workers started.';
      return {
        text: kind === 'export' ? `${state.message}\n\n${state.text}` : state.text || state.message,
      };
    } catch (error) {
      state.message =
        error instanceof Error
          ? error.message
          : 'Plan action failed. Existing saved data is retained.';
      return { text: `Agent Budget Board: ${state.message}` };
    } finally {
      $.ui.invalidate('ui.render');
    }
  });
export const register: Register = (on) => {
  const state: State = {
    board: new Board(),
    text: '',
    format: 'text',
    message: 'Plan the work before delegating. Approval is advisory and starts no workers.',
    queue: Promise.resolve(),
  };
  on('session.start', async ($, e, next) => {
    await schedule(state, async () => {
      state.board.clear();
      state.text = '';
    });
    await $.command.register({
      name: NAME,
      description: 'Review planned agent roles, scope overlap, model preferences, and concurrency',
      argumentHint: '[goal|add|set|remove|concurrency|review|approve|export|load|draft|clear]',
    });
    return next(e);
  });
  on('session.end', async (_$, e, next) => {
    await schedule(state, async () => {
      state.board.clear();
      state.text = '';
      state.message = 'Session plan and local approval cleared.';
    });
    return next(e);
  });
  on('command.run', { command: NAME }, async ($, e) => {
    if (!e.args.trim()) {
      await $.ui.open({ id: NAME, title: 'Agent Budget Board', focus: true, closeOnEscape: true });
      return {};
    }
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(e.args.trim());
    return act($, state, match?.[1] ?? '', match?.[2] ?? '');
  }).catch(() => ({
    text: 'Agent Budget Board could not complete the action. No workers were started.',
  }));
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (
      e.requestId !== NAME ||
      (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode')
    )
      return next(e);
    const { Box, Text, Input, Select, Button, Code } = $.ui.resolve(e);
    const plan = state.board.plan;
    const reviewed = state.board.reviewed;
    const run = (kind: string, value = '') => act($, state, kind, value).then(() => undefined);
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [
        Text({ bold: true, children: ['AGENT BUDGET BOARD'] }),
        Text({
          children: ['Advisory planning · No worker starts · No model calls or filesystem access'],
        }),
        Text({
          bold: true,
          children: [
            state.board.approved
              ? 'APPROVED LOCALLY · NOTHING STARTED'
              : reviewed
                ? 'REVIEWED · APPROVAL PENDING'
                : 'DRAFT · REVIEW REQUIRED',
          ],
        }),
        Input({
          key: 'goal',
          label: 'Plan goal',
          value: plan.goal,
          placeholder: 'What outcome needs multiple workers?',
          submitLabel: 'Save',
          onSubmit: (value) => run('goal', value),
        }),
        Input({
          key: 'concurrency',
          label: 'Requested concurrency (1–8; advisory only)',
          value: String(plan.concurrency),
          submitLabel: 'Save',
          onSubmit: (value) => run('concurrency', value),
        }),
        Text({
          children: [
            `${plan.workers.length}/8 planned workers · up to ${Math.min(plan.workers.length, plan.concurrency)} in a suggested batch · 0 workers started by this mod`,
          ],
        }),
        ...plan.workers.map((worker) =>
          Box({
            flexDirection: 'column',
            gap: 1,
            children: [
              Text({ bold: true, children: [worker.id.toUpperCase()] }),
              Input({
                key: `role-${worker.id}`,
                label: 'Role',
                value: worker.role,
                submitLabel: 'Save',
                onSubmit: (value) => run('set', `${worker.id} role ${value}`),
              }),
              Input({
                key: `task-${worker.id}`,
                label: 'Distinct task',
                value: worker.task,
                placeholder: 'A bounded responsibility',
                submitLabel: 'Save',
                onSubmit: (value) => run('set', `${worker.id} task ${value}`),
              }),
              Input({
                key: `model-${worker.id}`,
                label: 'Model preference (unverified label)',
                value: worker.model,
                submitLabel: 'Save',
                onSubmit: (value) => run('set', `${worker.id} model ${value}`),
              }),
              Select({
                key: `access-${worker.id}`,
                label: 'Planned access (not a permission grant)',
                value: worker.access,
                options: [
                  { value: 'read', label: 'Read / analyze' },
                  { value: 'write', label: 'Write / implement' },
                ],
                onSelect: (value) => run('set', `${worker.id} access ${value}`),
              }),
              Input({
                key: `scopes-${worker.id}`,
                label: 'Scopes: comma-separated files or folders ending /',
                value: worker.scopes.join(', '),
                placeholder: 'src/auth/, tests/auth.test.ts',
                submitLabel: 'Save',
                onSubmit: (value) => run('set', `${worker.id} scopes ${value}`),
              }),
              Button({
                key: `remove-${worker.id}`,
                label: `Remove worker ${worker.id}`,
                onPress: () => run('remove', worker.id),
              }),
            ],
          }),
        ),
        Input({
          key: 'add-worker',
          label: 'Add worker ID',
          placeholder: 'auth-review',
          submitLabel: 'Add',
          onSubmit: (value) => run('add', value),
        }),
        Button({
          key: 'review',
          label: 'Review roles, overlap, models, and suggested batches',
          onPress: () => run('review'),
        }),
        ...(reviewed
          ? [
              Text({
                children: [
                  `${reviewed.blockers.length} blocker(s) · ${reviewed.warnings.length} warning(s) · plan ${reviewed.fingerprint.slice(0, 12)}`,
                ],
              }),
              Button({
                key: 'approve',
                label: reviewed.warnings.length
                  ? `Acknowledge ${reviewed.warnings.length} warnings and approve locally`
                  : 'Approve reviewed plan locally',
                onPress: () => run('approve', reviewed.warnings.length ? 'acknowledge' : ''),
              }),
              Input({
                key: 'report-offset',
                label: 'Review report character offset',
                placeholder: '5000',
                submitLabel: 'Read page',
                onSubmit: (value) => run('page', value),
              }),
            ]
          : []),
        ...(state.board.approved
          ? [
              Button({
                key: 'draft',
                label: 'Append reviewed advisory plan to current draft',
                onPress: () => run('draft'),
              }),
            ]
          : []),
        Button({
          key: 'export',
          label: 'Export plan JSON (approval excluded)',
          onPress: () => run('export'),
        }),
        Input({
          key: 'load',
          label: 'Import pasted plan JSON (replaces saved plan)',
          placeholder: 'Paste version 1 plan JSON',
          submitLabel: 'Import',
          onSubmit: (value) => run('load', value),
        }),
        Button({
          key: 'clear',
          label: 'Clear plan and local approval',
          onPress: () => run('clear'),
        }),
        Text({ children: [state.message] }),
        ...(state.text ? [Code({ source: state.text, language: state.format, wrap: 'wrap' })] : []),
      ],
    });
  });
};
