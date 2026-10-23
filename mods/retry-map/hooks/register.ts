import type { Register } from 'claude-code';
import { History, LIMITS } from '../src/history.ts';

const PANE = 'retry-map';

export const register: Register = (on) => {
  const history = new History();
  let selected: number | undefined;
  let queue = Promise.resolve();
  let generation = 0;

  // Observational failures leave Claude Code's original tool result intact.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const startedInGeneration = generation;
    const revisionAtStart = history.editRevision;
    const result = await next(e);
    if (result.deny !== undefined || startedInGeneration !== generation) return result;
    const work = queue.then(async () => {
      if (startedInGeneration !== generation) return;
      const agent = e.agentId ?? 'main';
      if (result.isError) {
        const error =
          result.text ?? (typeof result.result === 'string' ? result.result : undefined);
        // A command overlapping an observed edit is not comparable to earlier attempts.
        const group = await history.failure(
          e.command,
          error,
          agent,
          Date.now(),
          revisionAtStart === history.editRevision,
        );
        if (group.count === LIMITS.warningOccurrences)
          $.ui.log(
            'Retry Map: the same command/error occurred three times for this agent. Inspect /retry-map before another retry.',
          );
      } else if (!result.result.backgroundTaskId && !result.result.interrupted) {
        await history.success(e.command, agent);
      }
      $.ui.invalidate('ui.render');
    });
    queue = work.catch(() => undefined);
    await queue;
    return result;
  });

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const startedInGeneration = generation;
    const result = await next(e);
    if (result.deny === undefined && !result.isError && startedInGeneration === generation) {
      const staged =
        result.result &&
        typeof result.result === 'object' &&
        'staged' in result.result &&
        result.result.staged === true;
      if (staged) return result;
      const work = queue.then(() => {
        if (startedInGeneration === generation) history.observedEdit();
        $.ui.invalidate('ui.render');
      });
      queue = work.catch(() => undefined);
      await queue;
    }
    return result;
  });

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PANE,
      description: 'Inspect repeated Bash tool failures',
      argumentHint: '[show|clear]',
    });
    return next(e);
  });
  on('session.end', async (_$, e, next) => {
    generation += 1;
    const work = queue.then(() => {
      history.clear();
      selected = undefined;
    });
    queue = work.catch(() => undefined);
    await queue;
    return next(e);
  });
  on('command.run', { command: PANE }, async ($, e) => {
    await queue;
    if (e.args.trim() === 'clear') {
      generation += 1;
      history.clear();
      selected = undefined;
      $.ui.invalidate('ui.render');
      return { text: 'Retry Map history cleared.' };
    }
    if (e.args.trim() === 'show') return { text: history.summary() };
    if (e.args.trim()) return { text: 'Use /retry-map, /retry-map show, or /retry-map clear.' };
    await $.ui.open({ id: PANE, title: 'Retry Map', focus: true, closeOnEscape: true });
    return {};
  }).catch(() => ({ text: 'Retry Map could not open. Tool execution was not changed.' }));
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button, Code } = $.ui.resolve(e);
    const detail = history.groups.find((group) => group.id === selected);
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [
        Text({ bold: true, children: ['RETRY MAP'] }),
        Text({
          children: [
            'Inspect repetition before spending another attempt. No automatic blocking or model calls.',
          ],
        }),
        Text({
          children: [
            'File-tool edits are observed; shell and external edits may be invisible. Identical failures can still be legitimate.',
          ],
        }),
        ...(history.groups.length
          ? history.groups
              .slice()
              .reverse()
              .map((group) =>
                Box({
                  key: `group-${group.id}`,
                  flexDirection: 'column',
                  children: [
                    Text({
                      bold: group.count >= LIMITS.warningOccurrences,
                      children: [
                        `#${group.id} · ${group.count} occurrence(s) · ${history.status(group)}`,
                      ],
                    }),
                    Text({ children: [`${group.agent}: ${group.command.slice(0, 200)}`] }),
                    Button({
                      key: `inspect-${group.id}`,
                      label: `Inspect failure ${group.id}`,
                      onPress: () => {
                        selected = group.id;
                        $.ui.invalidate('ui.render');
                      },
                    }),
                  ],
                }),
              )
          : [Text({ children: ['No Bash failures recorded in this session.'] })]),
        ...(detail
          ? [
              Code({
                source: `${detail.command}\n\n${detail.error}${detail.truncated ? '\n\n[Display truncated. The original tool result remains in the session.]' : ''}`,
                language: 'text',
                wrap: 'wrap',
              }),
            ]
          : []),
        Button({
          key: 'clear',
          label: 'Clear history',
          onPress: () => {
            generation += 1;
            queue = queue
              .then(() => {
                history.clear();
                selected = undefined;
                $.ui.invalidate('ui.render');
              })
              .catch(() => undefined);
          },
        }),
      ],
    });
  });
};
