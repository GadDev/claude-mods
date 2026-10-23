import { expect, test } from 'claude-code/testing';

test('review, warning acknowledgment, and local approval start no workers; edits invalidate drafts', async ($, on) => {
  let starts = 0;
  let reads = 0;
  let writes = 0;
  const fills: { mode: string; text: string }[] = [];
  on('agent.spawn', () => {
    starts++;
    throw new Error('Unexpected worker start');
  });
  on('fs.read', () => {
    reads++;
    throw new Error('Unexpected filesystem read');
  });
  on('fs.write', () => {
    writes++;
    throw new Error('Unexpected filesystem write');
  });
  on('prompt.fill', (_$, e) => {
    fills.push({ mode: e.mode, text: e.text });
    return { isFilled: true };
  });
  const run = (args: string) =>
    $.command.run({
      command: 'agent-budget-board',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  await run('goal Review the API change');
  await run('add api');
  await run('set api task Implement API validation');
  await run('set api scopes src/api/');
  await run('set api access write');
  await run('add review');
  await run('set review task Review authentication');
  await run('set review scopes src/api/auth.ts');
  expect((await run('review')).text).toContain('write-involved');
  expect((await run('approve')).text).toContain('acknowledge');
  expect((await run('draft')).text).toContain('approve');
  await run('approve acknowledge');
  expect(starts).toBe(0);
  expect(fills.length).toBe(0);
  await run('draft');
  expect(fills.length).toBe(1);
  expect(fills[0]?.mode).toBe('append');
  expect(fills[0]?.text).toContain('No workers have been started');
  await run('set review scopes tests/');
  expect((await run('draft')).text).toContain('approve');
  expect(fills.length).toBe(1);
  await run('review');
  await run('approve');
  const exported = (await run('export')).text ?? '';
  const json = exported.slice(exported.indexOf('{'));
  await run(`load ${json}`);
  expect((await run('draft')).text).toContain('approve');
  expect(starts).toBe(0);
  expect(reads).toBe(0);
  expect(writes).toBe(0);
});

test('empty, edited, reviewed, and approved panes validate on terminal, desktop, and vscode', async ($, on) => {
  let starts = 0;
  let reads = 0;
  on('agent.spawn', () => {
    starts++;
    throw new Error('Unexpected worker start');
  });
  on('fs.read', () => {
    reads++;
    throw new Error('Unexpected filesystem read');
  });
  const run = (args: string) =>
    $.command.run({
      command: 'agent-budget-board',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-budget-board',
      surface,
      component: 'Pane',
      requestId: 'agent-budget-board',
      props: {
        title: 'Agent Budget Board',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });
    expect(await ui.find({ key: 'goal' })).toBeDefined();
    expect(await ui.find({ key: 'add-worker' })).toBeDefined();
    await ui.input({ key: 'goal', text: 'Review API' });
    await ui.input({ key: 'add-worker', text: 'api' });
    await ui.input({ key: 'task-api', text: 'Inspect authentication' });
    await ui.input({ key: 'scopes-api', text: 'src/api/' });
    await ui.input({ key: 'model-api', text: 'planned-model' });
    await ui.select({ key: 'access-api', value: 'write' });
    expect(JSON.stringify(await ui.drawn())).toContain('planned-model');
    await ui.press({ key: 'review' });
    expect(await ui.find({ key: 'approve' })).toBeDefined();
    expect(await ui.find({ type: 'Code' })).toBeDefined();
    await ui.press({ key: 'approve' });
    expect(await ui.find({ key: 'draft' })).toBeDefined();
    await ui.input({ key: 'concurrency', text: '1' });
    expect(await ui.find({ key: 'draft' })).toBeUndefined();
    await ui.unmount();
    await run('clear');
  }
  expect(starts).toBe(0);
  expect(reads).toBe(0);
});

test('approval blockers, invalid imports, and absent editors preserve saved plan data', async ($, on) => {
  on('prompt.fill', () => ({ isFilled: false }));
  const run = (args: string) =>
    $.command.run({
      command: 'agent-budget-board',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  await run('goal Keep this plan');
  await run('add api');
  await run('review');
  expect((await run('approve acknowledge')).text).toContain('Complete');
  await run('set api task Review auth');
  await run('set api scopes src/api/');
  await run('review');
  await run('approve');
  expect((await run('draft')).text).toContain('No prompt editor');
  expect((await run('load {broken')).text).toContain('Invalid plan JSON');
  expect((await run('review')).text).toContain('Keep this plan');
});

test('large eight-worker plan exports and renders within native tree limits on every supported surface', async ($) => {
  const plan = {
    kind: 'gaddev.agent-plan',
    schemaVersion: 1,
    goal: 'g'.repeat(1000),
    concurrency: 2,
    workers: Array.from({ length: 8 }, (_, i) => ({
      id: `w${i}`,
      role: `Role ${i} ${'r'.repeat(70)}`,
      task: 't'.repeat(400),
      model: 'm'.repeat(120),
      access: 'write',
      scopes: Array.from({ length: 6 }, (_, j) => `src/w${i}/${'x'.repeat(225)}${j}.ts`),
    })),
  };
  const run = (args: string) =>
    $.command.run({
      command: 'agent-budget-board',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    });
  await run(`load ${JSON.stringify(plan)}`);
  await run('export');
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-budget-board',
      surface,
      component: 'Pane',
      requestId: 'agent-budget-board',
      props: {
        title: 'Agent Budget Board',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });
    expect(await ui.find({ key: 'scopes-w7' })).toBeDefined();
    expect(await ui.find({ type: 'Code' })).toBeDefined();
    await ui.unmount();
  }
});
