export const LIMITS = { sources: 12, fileBytes: 65_536, totalBytes: 262_144, page: 5000 } as const;
export interface Stat {
  kind: string;
  size: number;
  mtimeMs: number;
  realPath?: string;
}
export interface Files {
  cwd(): Promise<string>;
  stat(path: string): Promise<Stat>;
  read(path: string): Promise<string>;
}
export interface Source {
  path: string;
  root: string;
  realPath: string;
  text: string;
  hash: string;
  bytes: number;
  scope: string;
}
export interface Occurrence {
  path: string;
  line: number;
  scope: string;
}
export interface Duplicate {
  text: string;
  occurrences: Occurrence[];
}

// These labels describe file location, never the engine's effective instruction set.
export function scope(path: string, text: string): string {
  const rule = path.match(/^(.*?)(?:\.claude\/rules\/)/);
  if (rule) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
    return `${rule[1] || './'} rules; ${frontmatter && /^paths\s*:/m.test(frontmatter) ? 'paths frontmatter present; matching unverified' : 'no recognized paths frontmatter; loading unverified'}`;
  }
  const directory = path.slice(0, path.lastIndexOf('/') + 1) || './';
  return `${directory} directory guidance; loading unverified`;
}

export function validatePath(value: string): string {
  const path = value.trim();
  /* oxlint-disable no-control-regex -- Reject control characters in user-selected paths. */
  if (!path || path.length > 300 || /[\\:\x00-\x1f\x7f]/.test(path) || path.startsWith('/'))
    throw new Error(
      'Use a relative instruction path with forward slashes (at most 300 characters).',
    );
  /* oxlint-enable no-control-regex */
  const parts = path.split('/');
  if (
    parts.some(
      (part) =>
        !part || part === '.' || part === '..' || (part.startsWith('.') && part !== '.claude'),
    )
  )
    throw new Error('Traversal and hidden directories other than .claude are excluded.');
  const name = parts.at(-1);
  if (
    !['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md'].includes(name ?? '') &&
    !/(?:^|\/)\.claude\/rules\/.+\.md$/.test(path)
  )
    throw new Error('Select CLAUDE.md, CLAUDE.local.md, AGENTS.md, or a .claude/rules/*.md file.');
  return path;
}

export function clean(value: string): string {
  /* oxlint-disable no-control-regex -- Strip terminal controls only in presentation; source fingerprints retain original bytes. */
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  /* oxlint-enable no-control-regex */
}

export async function fingerprint(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function read(files: Files, path: string): Promise<Source> {
  const root = await files.stat(await files.cwd());
  if (root.kind !== 'dir' || !root.realPath)
    throw new Error('Working directory cannot be resolved.');
  const base = root.realPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const requested = `${base}/${path}`;
  const before = await files.stat(requested);
  const realPath = before.realPath;
  if (!realPath || !realPath.replace(/\\/g, '/').startsWith(`${base}/`))
    throw new Error('Instruction source resolves outside the working directory.');
  if (before.kind !== 'file' || before.size < 0 || before.size > LIMITS.fileBytes)
    throw new Error('Select a text file no larger than 64 KiB.');
  const text = await files.read(realPath);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > LIMITS.fileBytes || text.includes('\0'))
    throw new Error('Instruction source is oversized or contains binary data.');
  const after = await files.stat(requested);
  if (
    after.kind !== 'file' ||
    after.realPath !== realPath ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new Error('Instruction source changed while being read.');
  return {
    path,
    root: root.realPath,
    realPath,
    text,
    bytes,
    hash: await fingerprint(text),
    scope: scope(path, text),
  };
}

// Exact text with whitespace collapsed. Never infer semantic equivalence or resolve conflicts.
export function duplicates(sources: readonly Source[]): Duplicate[] {
  const groups = new Map<string, Occurrence[]>();
  for (const source of sources) {
    let fence: { character: string; length: number } | undefined;
    let comment = false;
    let frontmatter = false;
    for (const [index, raw] of source.text.split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (index === 0 && line === '---') {
        frontmatter = true;
        continue;
      }
      if (frontmatter) {
        if (line === '---') frontmatter = false;
        continue;
      }
      const marker = /^(\x60{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (
          marker &&
          marker[0] === fence.character &&
          marker.length >= fence.length &&
          line.slice(marker.length).trim() === ''
        )
          fence = undefined;
        continue;
      }
      if (marker) {
        fence = { character: marker[0] ?? '', length: marker.length };
        continue;
      }
      if (comment || line.includes('<!--')) {
        comment = !line.includes('-->');
        continue;
      }
      if (!line || /^(?:#{1,6}\s|>\s|\||@|[-*_]{3,}$)/.test(line)) continue;
      const text = line.replace(/\s+/g, ' ');
      if (text.length < 32 || text.length > 1000) continue;
      const occurrences = groups.get(text) ?? [];
      occurrences.push({ path: source.path, line: index + 1, scope: source.scope });
      groups.set(text, occurrences);
    }
  }
  return [...groups]
    .filter(([, entries]) => entries.length > 1)
    .map(([text, occurrences]) => ({ text, occurrences }));
}

export function report(sources: readonly Source[]): string {
  const findings = duplicates(sources);
  const lines = [
    'INSTRUCTION WORKBENCH — REVIEW ONLY',
    `${sources.length} selected source(s), ${sources.reduce((sum, source) => sum + source.text.length, 0)} source characters. Not loaded-context or token savings.`,
    'Coverage is selected files only. Imports are not followed. Parent/user/managed files, settings, effective loading, and semantic contradictions are unverified.',
    '',
    'SOURCES',
    ...sources.flatMap((source) => [
      `${clean(source.path)} · ${source.scope}`,
      `SHA-256 ${source.hash} · ${source.text.length} characters`,
    ]),
    '',
    `${findings.length} EXACT DUPLICATE GROUP(S)`,
    'Whitespace-only normalization; code fences, recognized frontmatter, comment lines, headings, tables, quotes, and short lines excluded.',
  ];
  for (const [index, finding] of findings.slice(0, 20).entries()) {
    const sameFile = new Set(finding.occurrences.map((o) => o.path)).size === 1;
    lines.push('', `${index + 1}. ${clean(finding.text)}`);
    lines.push(...finding.occurrences.slice(0, 12).map((o) => `  ${clean(o.path)}:${o.line}`));
    if (finding.occurrences.length > 12)
      lines.push(`  ${finding.occurrences.length - 12} more occurrence(s) omitted.`);
    lines.push(
      sameFile
        ? 'Proposal: review repeated lines in this file and retain each contextually necessary occurrence. This is not an approved deletion.'
        : 'Proposal: compare the cited scopes before consolidating. Identical wording in different scopes can be intentional; no deletion is presumed safe.',
    );
  }
  if (findings.length > 20)
    lines.push(`${findings.length - 20} more group(s) omitted from this report.`);
  lines.push(
    '',
    'NEXT REVIEW',
    'Consider an on-demand skill for genuinely task-specific procedures. Preserve always-needed safety and project invariants. Moving text into an imported file alone does not reduce loaded context.',
    'No edits were applied. Re-audit after any source change. This does not replace Claude /doctor prompt-audit or /context.',
  );
  return lines.join('\n');
}

export function page(text: string, offset = 0): string {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    throw new Error('Use an integer offset within the report.');
  return `${text.slice(offset, offset + LIMITS.page)}\n[characters ${offset}–${Math.min(text.length, offset + LIMITS.page)} of ${text.length}; next offset ${Math.min(text.length, offset + LIMITS.page)}]`;
}

export class Workbench {
  sources: Source[] = [];
  private result = '';
  clear(): void {
    this.sources = [];
    this.result = '';
  }
  async add(files: Files, value: string): Promise<void> {
    this.result = '';
    const path = validatePath(value);
    if (this.sources.length >= LIMITS.sources)
      throw new Error('Select at most 12 instruction sources.');
    const source = await read(files, path);
    if (this.sources.some((s) => s.root !== source.root)) {
      this.clear();
      throw new Error('Working directory changed. Add sources again.');
    }
    if (this.sources.some((s) => s.realPath === source.realPath))
      throw new Error('This resolved source is already selected.');
    if (this.sources.reduce((sum, s) => sum + s.bytes, source.bytes) > LIMITS.totalBytes)
      throw new Error('Selected sources exceed 256 KiB.');
    this.sources.push(source);
  }
  remove(index: number): void {
    if (!Number.isSafeInteger(index) || index < 1 || index > this.sources.length)
      throw new Error('Use a selected source index starting at 1.');
    this.sources.splice(index - 1, 1);
    this.result = '';
  }
  private async verify(files: Files): Promise<void> {
    if (!this.sources.length) throw new Error('Add an instruction source first.');
    try {
      for (const source of this.sources) {
        const current = await read(files, source.path);
        if (
          current.root !== source.root ||
          current.realPath !== source.realPath ||
          current.hash !== source.hash
        )
          throw new Error('Instruction sources changed. Add them again for a new review.');
      }
    } catch (error) {
      this.clear();
      throw error;
    }
  }
  async audit(files: Files): Promise<string> {
    this.result = '';
    await this.verify(files);
    this.result = report(this.sources);
    return page(this.result);
  }
  async view(files: Files, offset = 0): Promise<string> {
    if (!this.result) throw new Error('Run audit before paging the report.');
    await this.verify(files);
    return page(this.result, offset);
  }
}
