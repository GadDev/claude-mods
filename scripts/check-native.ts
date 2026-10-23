import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marketplace = JSON.parse(
  await readFile(resolve(root, '.claude-plugin/marketplace.json'), 'utf8'),
) as { plugins: { source: string }[] };
const packageRoot = resolve(root, 'node_modules/@anthropic-ai/claude-code');
const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
  bin: { claude: string };
};
const cli = resolve(packageRoot, pkg.bin.claude);
const commands = [
  ['plugin', 'validate', '.'],
  ...marketplace.plugins.flatMap((plugin) => [
    ['plugin', 'validate', plugin.source],
    ['plugin', 'test', plugin.source],
  ]),
];
for (const args of commands) {
  const result = spawnSync(cli, args, {
    cwd: root,
    stdio: 'inherit',
    timeout: 60_000,
    // Native tests use stubs, not a signed-in session. Keep the CLI's startup
    // telemetry, feature-flag fetches, and update checks out of local/CI checks.
    env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
