import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clean, History, LIMITS } from '../mods/retry-map/src/history.ts';

test('three identical command/error pairs form one actionable group', async () => {
  const history = new History();
  for (let i = 0; i < 3; i++) await history.failure('npm test', 'same error', 'main', i);
  assert.equal(history.groups.length, 1); assert.equal(history.groups[0]?.count, 3);
  assert.match(history.summary(), /Repeated failure: inspect/);
});

test('agents, commands, and error contents define distinct groups', async () => {
  const history = new History();
  await history.failure('npm test', 'error A', 'main', 0);
  await history.failure('npm test', 'error A', 'worker', 1);
  await history.failure('npm test', 'error B', 'main', 2);
  await history.failure('npm run test', 'error B', 'main', 3);
  assert.equal(history.groups.length, 4);
});

test('observed edits start a new comparison period', async () => {
  const history = new History(); await history.failure('npm test', 'error', 'main', 0); history.observedEdit();
  await history.failure('npm test', 'error', 'main', 1);
  assert.equal(history.groups.length, 2);
  assert.match(history.status(history.groups[0]!), /Before an observed/);
});

test('later tool success resolves the active group and subsequent failure starts anew', async () => {
  const history = new History(); await history.failure('npm test', 'error', 'main', 0);
  await history.success('npm test', 'main');
  assert.equal(history.groups[0]?.resolved, true);
  await history.failure('npm test', 'error', 'main', 1);
  assert.equal(history.groups.length, 2); assert.equal(history.groups[1]?.count, 1);
});

test('incomplete, absent, and edit-overlapping evidence is never grouped', async () => {
  const history = new History();
  for (let i = 0; i < 2; i++) await history.failure('npm test', undefined, 'main', i);
  for (let i = 0; i < 2; i++) await history.failure('npm test', 'error', 'main', i, false);
  for (let i = 0; i < 2; i++) await history.failure('npm test', 'x'.repeat(LIMITS.errorCharacters + 1), 'main', i);
  assert.equal(history.groups.length, 6); assert.ok(history.groups.every(group => group.signature === undefined));
});

test('full error fingerprints distinguish identical previews with different tails', async () => {
  const history = new History(); const prefix = 'x'.repeat(LIMITS.displayErrorCharacters);
  await history.failure('npm test', prefix + 'A', 'main', 0);
  await history.failure('npm test', prefix + 'B', 'main', 1);
  assert.equal(history.groups.length, 2); assert.equal(history.groups[0]?.error, history.groups[1]?.error);
  assert.equal(history.groups[0]?.truncated, true);
});

test('history bounds retained groups and active comparison keys', async () => {
  const history = new History();
  for (let i = 0; i < 100; i++) await history.failure(`command ${i}`, 'error', 'main', i);
  assert.equal(history.groups.length, LIMITS.groups);
  await history.failure('command 0', 'error', 'main', 101);
  assert.equal(history.groups.at(-1)?.count, 1);
});

test('clearing resets local evidence', async () => {
  const history = new History(); await history.failure('command', 'error', 'main', 0); history.observedEdit(); history.clear();
  assert.equal(history.groups.length, 0); assert.equal(history.editRevision, 0);
});

test('terminal control sequences are stripped from displayed text', () => {
  assert.equal(clean('\x1b[31merror\x1b[0m\0'), 'error');
});
