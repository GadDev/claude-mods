import assert from 'node:assert/strict';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (path: string) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const marketplace = await json('.claude-plugin/marketplace.json');
assert.equal(marketplace.name, 'gaddev-mods');
assert.ok(marketplace.plugins.length > 0, 'List at least one implemented plugin.');
const names = new Set<string>();
for (const plugin of marketplace.plugins) {
  assert.ok(!names.has(plugin.name), `Duplicate plugin: ${plugin.name}`);
  names.add(plugin.name);
  assert.match(plugin.source, /^\.\/mods\/[a-z0-9-]+$/);
  const directory = await realpath(resolve(root, plugin.source));
  assert.ok(directory.startsWith(root + sep));
  const manifest = await json(`${plugin.source}/.claude-plugin/plugin.json`);
  const pkg = await json(`${plugin.source}/package.json`);
  assert.equal(manifest.name, plugin.name);
  assert.equal(manifest.version, pkg.version);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.license, 'MIT');
  for (const path of ['README.md', 'LICENSE', 'CHANGELOG.md']) await stat(resolve(directory, path));
  const hooks = await json(`${plugin.source}/hooks/hooks.json`);
  assert.equal(hooks.modules.length, 1);
  for (const module of hooks.modules) {
    assert.ok(typeof module === 'string' && module.startsWith('./') && !module.includes('..'));
    const modulePath = await realpath(resolve(directory, 'hooks', module));
    assert.ok(modulePath.startsWith(directory + sep));
    const source = await readFile(modulePath, 'utf8');
    assert.ok(!source.includes('node:'), 'Runtime entry cannot import Node APIs.');
    assert.match(source, /export const register/);
  }
}

const release = await json('release-please-config.json');
for (const plugin of marketplace.plugins) {
  const path = plugin.source.slice(2);
  assert.ok(release.packages[path], `Missing release configuration for ${path}`);
  assert.ok(release.packages[path]['extra-files'].some((file: { path: string }) => file.path === '.claude-plugin/plugin.json'));
}
const labels = await json('.github/labels.json') as { name: string; color: string; description: string }[];
assert.equal(new Set(labels.map(label => label.name)).size, labels.length);
for (const label of labels) {
  assert.match(label.color, /^[a-fA-F0-9]{6}$/);
  assert.ok(label.description.length <= 100);
}
for (const file of await readdir(resolve(root, '.github/workflows'))) {
  if (!file.endsWith('.yml')) continue;
  const text = await readFile(resolve(root, '.github/workflows', file), 'utf8');
  for (const match of text.matchAll(/uses:\s+([^\s#]+)/g)) {
    assert.match(match[1] ?? '', /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, `${file}: pin third-party actions to full commit SHAs`);
  }
}

// Check repository-local Markdown links, excluding external URLs, anchors, and images.
async function checkDocs(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.cache', '.git'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await checkDocs(path);
    else if (entry.name.endsWith('.md')) {
      const text = await readFile(path, 'utf8');
      for (const match of text.matchAll(/(?<!!)\[[^\]]*\]\(([^\s)]+)\)/g)) {
        const link = match[1] ?? '';
        if (/^(?:https?:|mailto:|#)/.test(link)) continue;
        await stat(resolve(dirname(path), link.split('#')[0] ?? '')).catch(() => { throw new Error(`Broken local link in ${path}: ${link}`); });
      }
    }
  }
}
await checkDocs(root);
console.log(`Validated ${names.size} plugin(s), release configuration, labels, pinned actions, and documentation links.`);
