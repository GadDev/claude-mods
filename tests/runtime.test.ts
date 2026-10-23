import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineInterface, On } from 'claude-code';
import { register } from '../mods/context-studio/hooks/register.ts';

type Handler = ($: EngineInterface, event: Record<string, unknown>, next: (event: unknown) => Promise<unknown>) => Promise<Record<string, unknown>>;

function harness() {
  const hooks = new Map<string, Handler>();
  const calls = { opened: 0, reads: 0, filled: [] as string[], commands: [] as string[] };
  let content = 'const answer = 42;\n';
  const elements = Object.fromEntries(['Box', 'Text', 'Input', 'Button', 'Code'].map(type => [type, (props: Record<string, unknown>) => ({ type, ...props })]));
  const engine = {
    session: { cwd: async () => '/repo' },
    command: { register: async (spec: { name: string }) => { calls.commands.push(spec.name); } },
    fs: {
      stat: async (path: string) => ({ kind: path === '/repo' ? 'dir' : 'file', size: path === '/repo' ? 0 : content.length, mtimeMs: 0, realPath: path }),
      read: async () => { calls.reads += 1; return content; },
    },
    ui: { invalidate: () => undefined, open: async () => { calls.opened += 1; }, resolve: () => elements },
    prompt: { fill: async ({ text }: { text: string }) => { calls.filled.push(text); return { isFilled: true }; } },
  } as unknown as EngineInterface;
  const on = ((name: string, ...args: unknown[]) => { hooks.set(name, args.at(-1) as Handler); return { catch: () => undefined }; }) as unknown as On;
  register(on, {});
  const fire = async (name: string, event: Record<string, unknown> = {}) => {
    const handler = hooks.get(name); assert.ok(handler, `${name} hook is registered`);
    return handler(engine, event, async () => ({}));
  };
  const command = (args: string) => fire('command.run', { command: 'context-studio', args });
  return { calls, fire, command, setContent: (value: string) => { content = value; } };
}

test('opening the pane registers a command and performs no file reads or model turns', async () => {
  const h = harness(); await h.fire('session.start'); await h.command('');
  assert.deepEqual(h.calls.commands, ['context-studio']);
  assert.equal(h.calls.opened, 1); assert.equal(h.calls.reads, 0); assert.equal(h.calls.filled.length, 0);
});

test('command flow prepares a draft only after task, selection, and freshness verification', async () => {
  const h = harness();
  await h.command('goal Explain the constant'); await h.command('add src/app.ts:1-1');
  const preview = await h.command('preview'); assert.match(String(preview.text), /const answer = 42/);
  assert.equal(h.calls.filled.length, 0);
  await h.command('draft'); assert.equal(h.calls.filled.length, 1);
  assert.match(h.calls.filled[0] ?? '', /Task: Explain the constant/);
});

test('stale snapshots are never appended to the prompt editor', async () => {
  const h = harness(); await h.command('goal Task'); await h.command('add src/app.ts:1-1');
  h.setContent('const answer = 43;\n');
  const result = await h.command('draft'); assert.match(String(result.text), /Stale excerpt/);
  assert.equal(h.calls.filled.length, 0);
});

test('lifecycle reset removes task source content', async () => {
  const h = harness(); await h.command('goal Task'); await h.command('add src/app.ts:1-1');
  await h.fire('session.end');
  assert.match(String((await h.command('preview')).text), /Set a task/);
});

test('pane renders on supported surfaces and does not take over other panes', async () => {
  const h = harness();
  for (const surface of ['terminal', 'desktop', 'vscode']) {
    const tree = await h.fire('ui.render', { requestId: 'context-studio', surface });
    assert.equal(tree.type, 'Box'); assert.ok(Array.isArray(tree.children));
  }
  assert.deepEqual(await h.fire('ui.render', { requestId: 'another-mod', surface: 'terminal' }), {});
  assert.deepEqual(await h.fire('ui.render', { requestId: 'context-studio', surface: 'mobile' }), {});
});

test('queued commands retain task and excerpt ordering', async () => {
  const h = harness();
  await Promise.all([h.command('goal Task'), h.command('add src/app.ts:1-1'), h.command('preview')]);
  assert.match(String((await h.command('preview')).text), /const answer/);
});
