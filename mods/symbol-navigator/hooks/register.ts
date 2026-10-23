import type { EngineInterface, Register } from 'claude-code';
import { LIMITS, Navigator } from '../src/index.ts';

const NAME = 'symbol-navigator';
const HELP =
  '/symbol-navigator load <index.json> | find <name> | results <offset> | show <id> | references <offset> | select <number> | preview | page <offset> | draft | clear';
interface State {
  navigator: Navigator;
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
      const navigator = state.navigator;
      if (kind === 'load') {
        await navigator.load(files($), value);
        state.message =
          'Index loaded. Search explicitly to verify recorded inputs. Nothing has been executed.';
      } else if (kind === 'clear') {
        navigator.clear();
        state.message = 'Index and selections cleared.';
      } else if (kind === 'find') state.text = await navigator.find(files($), value);
      else if (kind === 'results')
        state.text = await navigator.results(files($), Number(value || '0'));
      else if (kind === 'show') state.text = await navigator.show(files($), value);
      else if (kind === 'references')
        state.text = await navigator.references(files($), Number(value || '0'));
      else if (kind === 'select') state.text = await navigator.select(files($), Number(value));
      else if (kind === 'preview' || kind === 'draft' || kind === 'page') {
        const packet = await navigator.packet(files($));
        if (kind === 'draft') {
          const result = await $.prompt.fill({ text: '\n\n' + packet + '\n', mode: 'append' });
          if (!result.isFilled)
            throw new Error('No prompt editor is available. Use preview and copy the packet.');
          state.message =
            'Appended verified source to your draft. Review and send it yourself; rebuild after later edits.';
        } else if (kind === 'page') {
          const offset = Number(value || '0');
          if (!Number.isSafeInteger(offset) || offset < 0 || offset >= packet.length)
            throw new Error('Use an existing packet character offset starting at zero.');
          state.text =
            `Packet characters ${offset}–${Math.min(offset + LIMITS.page, packet.length)} of ${packet.length}\n` +
            packet.slice(offset, offset + LIMITS.page);
        } else state.text = packet;
      } else throw new Error(HELP);
      if (state.text)
        state.message =
          'Recorded inputs reverified now. Index coverage is limited to its generation snapshot.';
      return { text: state.text || state.message };
    } catch (error) {
      state.text = '';
      state.message = error instanceof Error ? error.message : 'Source retrieval failed.';
      return { text: `Symbol Navigator: ${state.message}` };
    } finally {
      $.ui.invalidate('ui.render');
    }
  });

export const register: Register = (on) => {
  const state: State = {
    navigator: new Navigator(),
    text: '',
    message: 'Load a locally generated index. Opening the pane reads no files.',
    queue: Promise.resolve(),
  };
  on('session.start', async ($, e, next) => {
    await schedule(state, async () => {
      state.navigator.clear();
      state.text = '';
    });
    await $.command.register({
      name: NAME,
      description: 'Retrieve selected TypeScript definitions and references from a local index',
      argumentHint: '[load|find|show|select|preview|draft|clear]',
    });
    return next(e);
  });
  on('session.end', async (_$, e, next) => {
    await schedule(state, async () => {
      state.navigator.clear();
      state.text = '';
      state.message = 'Index cleared for this session.';
    });
    return next(e);
  });
  on('command.run', { command: NAME }, async ($, e) => {
    if (!e.args.trim()) {
      await $.ui.open({ id: NAME, title: 'Symbol Navigator', focus: true, closeOnEscape: true });
      return {};
    }
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(e.args.trim());
    const kind = match?.[1] ?? '';
    const value = match?.[2] ?? '';
    if (
      ![
        'load',
        'find',
        'results',
        'show',
        'references',
        'select',
        'preview',
        'page',
        'draft',
        'clear',
      ].includes(kind) ||
      (['preview', 'draft', 'clear'].includes(kind) && value.trim())
    )
      return { text: HELP };
    return act($, state, kind, value);
  }).catch(() => ({
    text: 'Symbol Navigator could not retrieve source. No prompt was submitted.',
  }));
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (
      e.requestId !== NAME ||
      (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode')
    )
      return next(e);
    const { Box, Text, Input, Button, Code } = $.ui.resolve(e);
    const view = state.navigator.snapshot;
    const run = (kind: string, value = '') => act($, state, kind, value).then(() => undefined);
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [
        Text({ bold: true, children: ['SYMBOL NAVIGATOR'] }),
        Text({ children: ['Find → choose definition → select references → verify and preview'] }),
        Text({
          children: [
            'Local index · Source excerpts only · No compiler or model calls in this pane',
          ],
        }),
        Input({
          key: 'index-path',
          label: 'Generated index JSON',
          placeholder: 'symbol-index.json',
          submitLabel: 'Load index',
          onSubmit: (value) => run('load', value),
        }),
        ...(view.loaded
          ? [
              Text({
                children: [
                  `${view.project} · ${view.total} symbols · Input freshness checked on retrieval`,
                ],
              }),
              Input({
                key: 'symbol-query',
                label: 'Symbol name',
                placeholder: 'createSession',
                value: view.query,
                submitLabel: 'Find',
                onSubmit: (value) => run('find', value),
              }),
              Text({ children: [`${view.matches} matches · offset ${view.resultOffset}`] }),
              ...view.results.map((symbol) =>
                Button({
                  key: `show-${symbol.id}`,
                  label: `${symbol.id} ${symbol.name} · ${symbol.definitions[0]?.path}:${symbol.definitions[0]?.line}`,
                  onPress: () => run('show', symbol.id),
                }),
              ),
              Input({
                key: 'results-offset',
                label: 'Search result offset (8 rows per page)',
                placeholder: '8',
                submitLabel: 'Read results',
                onSubmit: (value) => run('results', value),
              }),
            ]
          : []),
        ...(view.active
          ? [
              Text({
                bold: true,
                children: [
                  `${view.active.id} ${view.active.name} · ${view.selected.length}/8 references selected`,
                ],
              }),
              ...view.active.definitions.map((definition) =>
                Text({
                  children: [
                    `Definition ${definition.path}:${definition.line}:${definition.column}–${definition.endLine}`,
                  ],
                }),
              ),
              Text({
                children: [
                  `${view.active.references.length} indexed references · offset ${view.referenceOffset}`,
                ],
              }),
              ...view.active.references
                .slice(view.referenceOffset, view.referenceOffset + LIMITS.rows)
                .map((reference, index) => {
                  const number = view.referenceOffset + index + 1;
                  return Button({
                    key: `ref-${number}`,
                    label: `${view.selected.includes(number) ? 'Deselect' : 'Select'} ${number}: ${reference.path}:${reference.line}:${reference.column}`,
                    onPress: () => run('select', String(number)),
                  });
                }),
              Input({
                key: 'references-offset',
                label: 'Reference offset (8 rows per page)',
                placeholder: '8',
                submitLabel: 'Read references',
                onSubmit: (value) => run('references', value),
              }),
              Button({
                key: 'preview',
                label: 'Verify inputs and preview selected source',
                onPress: () => run('preview'),
              }),
              Input({
                key: 'packet-offset',
                label: 'Packet character offset (4000 per page)',
                placeholder: '4000',
                submitLabel: 'Read packet page',
                onSubmit: (value) => run('page', value),
              }),
              Button({
                key: 'draft',
                label: 'Verify and append selected source to draft',
                onPress: () => run('draft'),
              }),
            ]
          : []),
        Button({ key: 'clear', label: 'Clear index and selections', onPress: () => run('clear') }),
        Text({ children: [state.message] }),
        ...(state.text
          ? [
              Code({
                source:
                  state.text.slice(0, LIMITS.page) +
                  (state.text.length > LIMITS.page
                    ? '\n[Pane preview limited to 4000 characters; use packet pages for the rest.]'
                    : ''),
                language: 'text',
                wrap: 'wrap',
              }),
            ]
          : []),
      ],
    });
  });
};
