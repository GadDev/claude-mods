import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

const destination = new URL('../.cache/mod-types/claude-code.d.ts', import.meta.url);
const expected = 'e51e637fbbebb2a6a49c4bdc3860a251c2ca2295884822dff0f4c3e3ec802163';
const url =
  'https://raw.githubusercontent.com/anthropics/claude-code/bf2323b3021c9d3db7a31e1e7d61068c3f704497/mods/types/claude-code.d.ts';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const cached = await readFile(destination, 'utf8').catch(() => '');
if (hash(cached) === expected) {
  console.log('Verified cached official mod declarations.');
} else {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Cannot fetch official declarations: HTTP ${response.status}`);
  const text = await response.text();
  if (hash(text) !== expected)
    throw new Error(
      'Official declarations failed the pinned checksum. Review the source before updating the pin.',
    );
  await mkdir(new URL('../.cache/mod-types/', import.meta.url), { recursive: true });
  await writeFile(destination, text);
  console.log('Downloaded and verified pinned official mod declarations.');
}
