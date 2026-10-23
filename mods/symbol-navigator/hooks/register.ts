import type { EngineInterface, Register } from 'claude-code';
import { LIMITS, Navigator } from '../src/index.ts';

const NAME = 'symbol-navigator';
const HELP =
  '/symbol-navigator help | load <index.json> | find <name> | results <offset> | show <id> | references <offset> | select <number> | preview | page <offset> | draft | clear';
const QUICK_START = [
  'SYMBOL NAVIGATOR — FIRST RUN',
  '1. In a checkout of GadDev/claude-mods, use Node 24+ and run:',
  '   npm ci',
  '   npm run symbols:demo',
  '2. Follow the printed launch commands. The demo makes a fresh temporary project and index.',
  '3. In that project: /symbol-navigator load symbol-index.json',
  '4. Search quoteTotal, choose src/pricing.ts, and select a checkout reference.',
  '5. Preview first. Append to draft only when ready; sending stays with you.',
  'For your own project, use npm run symbols:index with its tsconfig and a new JSON output.',
  'Start Claude in the directory containing that tsconfig. Paths in load are relative to that directory.',
  'Generation happens in the repository terminal. This pane does not run a compiler.',
].join('\n');
interface State {
  navigator: Navigator;
  text: string;
  message: string;
  lastIndexPath: string;
  packetPage: string;
  packetOffset: number;
  packetLength: number;
  busy: boolean;
  queue: Promise<void>;
}
const files = ($: EngineInterface) => ({
  cwd: () => $.session.cwd(),
  stat: (path: string) => $.fs.stat(path, { resolve: true }),
  read: (path: string) => $.fs.read(path),
});
const resetPreview = (state: State) => {
  state.text = '';
  state.packetPage = '';
  state.packetOffset = 0;
  state.packetLength = 0;
};
const range = (offset: number, total: number, size: number) =>
  total ? `${offset + 1}–${Math.min(offset + size, total)} of ${total}` : '0';
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
    resetPreview(state);
    state.busy = true;
    $.ui.invalidate('ui.render');
    try {
      const navigator = state.navigator;
      if (kind === 'help') {
        state.text = QUICK_START;
        state.message =
          'Quick start: generate the index in a repository terminal, then load it here.';
      } else if (kind === 'load') {
        await navigator.load(files($), value);
        state.lastIndexPath = value;
        state.message =
          'Index loaded. Next: search a declaration name. Recorded inputs are verified when you retrieve.';
      } else if (kind === 'clear') {
        navigator.clear();
        state.lastIndexPath = '';
        state.message = 'Index and selections cleared. Load an index to begin again.';
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
        } else {
          const offset = kind === 'page' ? Number(value || '0') : 0;
          if (!Number.isSafeInteger(offset) || offset < 0 || offset >= packet.length)
            throw new Error('Use an existing packet character offset starting at zero.');
          state.packetLength = packet.length;
          state.packetOffset = offset;
          state.packetPage = packet.slice(offset, offset + LIMITS.page);
          state.text =
            kind === 'preview'
              ? packet
              : `Packet characters ${range(offset, packet.length, LIMITS.page)}\n` +
                state.packetPage;
        }
      } else throw new Error(HELP);
      if (state.text && kind !== 'help')
        state.message =
          'Recorded inputs verified now. Rebuild after added files or dependency changes; this is a snapshot.';
      return { text: state.text || state.message };
    } catch (error) {
      resetPreview(state);
      state.message = error instanceof Error ? error.message : 'Source retrieval failed.';
      return { text: `Symbol Navigator: ${state.message}` };
    } finally {
      state.busy = false;
      $.ui.invalidate('ui.render');
    }
  });

export const register: Register = (on) => {
  const state: State = {
    navigator: new Navigator(),
    text: '',
    message: 'Start with a demo or load an existing index.',
    lastIndexPath: '',
    packetPage: '',
    packetOffset: 0,
    packetLength: 0,
    busy: false,
    queue: Promise.resolve(),
  };
  on('session.start', async ($, e, next) => {
    await schedule(state, async () => {
      state.navigator.clear();
      resetPreview(state);
      state.lastIndexPath = '';
      state.message = 'Start with a demo or load an existing index.';
    });
    await $.command.register({
      name: NAME,
      description: 'Retrieve selected TypeScript definitions and references from a local index',
      argumentHint: '[help|load|find|show|select|preview|draft|clear]',
    });
    return next(e);
  });
  on('session.end', async (_$, e, next) => {
    await schedule(state, async () => {
      state.navigator.clear();
      resetPreview(state);
      state.lastIndexPath = '';
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
        'help',
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
      (['help', 'preview', 'draft', 'clear'].includes(kind) && value.trim())
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
        Text({ children: ['Load → find → choose definition → select references → preview'] }),
        Button({
          key: 'help',
          label: 'Quick start and demo instructions',
          onPress: () => run('help'),
        }),
        ...(!view.loaded
          ? [
              Text({ bold: true, children: ['1. Load an index'] }),
              Text({
                children: [
                  'First visit? Run npm run symbols:demo in a checkout of GadDev/claude-mods. Follow its printed launch commands, then load symbol-index.json here.',
                ],
              }),
              Text({
                children: [
                  'For your own index, start Claude in the directory containing its tsconfig. Load a path relative to that directory.',
                ],
              }),
              ...(state.lastIndexPath
                ? [
                    Text({
                      children: [
                        `Previous index: ${state.lastIndexPath}. Rebuild in the repository terminal, then submit the index path again. No automatic reload occurs.`,
                      ],
                    }),
                  ]
                : []),
            ]
          : []),
        Input({
          key: 'index-path',
          label: 'Generated index JSON (relative to workspace)',
          placeholder: 'symbol-index.json',
          value: state.lastIndexPath,
          submitLabel: 'Load index',
          onSubmit: (value) => run('load', value),
        }),
        ...(view.loaded
          ? [
              Text({
                children: [
                  `${view.project} · ${view.total} symbols · Freshness checked on retrieval`,
                ],
              }),
              Text({ bold: true, children: ['2. Find a definition'] }),
              Input({
                key: 'symbol-query',
                label: 'Declaration name',
                placeholder: 'Demo: quoteTotal',
                value: view.query,
                submitLabel: 'Find',
                onSubmit: (value) => run('find', value),
              }),
              ...(!view.query
                ? [
                    Text({
                      children: [
                        'Search the original declaration name. Import aliases appear in references, not as separate search names.',
                      ],
                    }),
                  ]
                : [
                    Text({
                      children: [
                        view.matches
                          ? `Matches ${range(view.resultOffset, view.matches, LIMITS.rows)}. Choose by definition location.`
                          : 'No matching declarations. Try a shorter name or the original name behind an import alias.',
                      ],
                    }),
                    ...view.results.map((symbol) =>
                      Button({
                        key: `show-${symbol.id}`,
                        label: `${symbol.id} ${symbol.name} · ${symbol.definitions[0]?.path}:${symbol.definitions[0]?.line}`,
                        onPress: () => run('show', symbol.id),
                      }),
                    ),
                    ...(view.resultOffset > 0
                      ? [
                          Button({
                            key: 'results-previous',
                            label: 'Previous matches',
                            onPress: () =>
                              run('results', String(Math.max(0, view.resultOffset - LIMITS.rows))),
                          }),
                        ]
                      : []),
                    ...(view.resultOffset + LIMITS.rows < view.matches
                      ? [
                          Button({
                            key: 'results-next',
                            label: 'Next matches',
                            onPress: () => run('results', String(view.resultOffset + LIMITS.rows)),
                          }),
                        ]
                      : []),
                  ]),
            ]
          : []),
        ...(view.active
          ? [
              Text({
                bold: true,
                children: [
                  `3. ${view.active.name} · ${view.selected.length}/8 references selected`,
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
                  view.active.references.length
                    ? `References ${range(view.referenceOffset, view.active.references.length, LIMITS.rows)}. The definition is always included; references are optional.`
                    : 'No indexed identifier references. You can preview the definition alone.',
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
              ...(view.referenceOffset > 0
                ? [
                    Button({
                      key: 'references-previous',
                      label: 'Previous references',
                      onPress: () =>
                        run('references', String(Math.max(0, view.referenceOffset - LIMITS.rows))),
                    }),
                  ]
                : []),
              ...(view.referenceOffset + LIMITS.rows < view.active.references.length
                ? [
                    Button({
                      key: 'references-next',
                      label: 'Next references',
                      onPress: () => run('references', String(view.referenceOffset + LIMITS.rows)),
                    }),
                  ]
                : []),
              Button({
                key: 'preview',
                label: '4. Verify and preview selected source',
                onPress: () => run('preview'),
              }),
              Button({
                key: 'draft',
                label: 'Append verified source to draft',
                onPress: () => run('draft'),
              }),
            ]
          : []),
        ...(state.packetLength
          ? [
              Text({
                children: [
                  `Packet characters ${range(state.packetOffset, state.packetLength, LIMITS.page)}. Each page rechecks recorded inputs.`,
                ],
              }),
              ...(state.packetOffset > 0
                ? [
                    Button({
                      key: 'packet-previous',
                      label: 'Previous packet page',
                      onPress: () =>
                        run('page', String(Math.max(0, state.packetOffset - LIMITS.page))),
                    }),
                  ]
                : []),
              ...(state.packetOffset + LIMITS.page < state.packetLength
                ? [
                    Button({
                      key: 'packet-next',
                      label: 'Next packet page',
                      onPress: () => run('page', String(state.packetOffset + LIMITS.page)),
                    }),
                  ]
                : []),
            ]
          : []),
        Button({ key: 'clear', label: 'Clear index and selections', onPress: () => run('clear') }),
        Text({ children: [state.busy ? 'Working locally…' : state.message] }),
        ...(state.text
          ? [
              Code({
                source: state.packetLength
                  ? state.packetPage
                  : state.text.slice(0, LIMITS.page) +
                    (state.text.length > LIMITS.page
                      ? '\n[Report preview limited to 4000 characters; use the match/reference lists above.]'
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
