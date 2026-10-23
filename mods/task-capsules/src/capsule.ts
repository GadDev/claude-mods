export const LIMITS = {
  goal: 1000,
  item: 400,
  items: 8,
  files: 8,
  path: 240,
  jsonBytes: 32_768,
  sourceBytes: 262_144,
} as const;
export interface FileReference {
  path: string;
  sha256: string;
}
export interface Capsule {
  kind: 'gaddev.task-capsule';
  schemaVersion: 1;
  goal: string;
  decisions: string[];
  files: FileReference[];
  checks: string[];
}
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
export interface FileCheck {
  path: string;
  status: 'matching' | 'changed' | 'unavailable' | 'workspace-changed';
}
export interface Review {
  files: FileCheck[];
  json: string;
  handoff: string;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error('Unexpected or missing capsule fields.');
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`Enter nonempty text of at most ${max} characters.`);
  /* oxlint-disable no-control-regex -- Reject terminal and binary controls in authored capsule fields. */
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw new Error('Control characters are excluded from capsule fields.');
  /* oxlint-enable no-control-regex */
  return value.trim();
}
export function validatePath(value: unknown): string {
  const path = text(value, LIMITS.path);
  /* oxlint-disable no-control-regex -- Keep paths printable and relative. */
  if (path.startsWith('/') || /[\\:\x00-\x1f\x7f]/.test(path))
    throw new Error('Use a relative path with forward slashes.');
  /* oxlint-enable no-control-regex */
  const parts = path.split('/');
  if (
    parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) ||
    /(?:^|\/)(?:credentials|secrets?)(?:[./]|$)/i.test(path)
  )
    throw new Error('Hidden paths, traversal, and obvious secret filenames are excluded.');
  return path;
}
function list(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > LIMITS.items)
    throw new Error('Use at most eight decisions or unresolved checks.');
  return value.map((item) => text(item, LIMITS.item));
}
export function parseCapsule(raw: string): Capsule {
  if (bytes(raw) > LIMITS.jsonBytes) throw new Error('Capsule JSON exceeds 32 KiB.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid capsule JSON.');
  }
  if (!record(value)) throw new Error('Capsule JSON must be an object.');
  keys(value, ['kind', 'schemaVersion', 'goal', 'decisions', 'files', 'checks']);
  if (value.kind !== 'gaddev.task-capsule' || value.schemaVersion !== 1)
    throw new Error('Unsupported capsule kind or schema version.');
  if (!Array.isArray(value.files) || value.files.length > LIMITS.files)
    throw new Error('Use at most eight file references.');
  const files = value.files.map((item: unknown): FileReference => {
    if (!record(item)) throw new Error('Invalid file reference.');
    keys(item, ['path', 'sha256']);
    const path = validatePath(item.path);
    if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256))
      throw new Error('Each file needs a lowercase SHA-256 text fingerprint.');
    return { path, sha256: item.sha256 };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length)
    throw new Error('Duplicate file paths are excluded.');
  return {
    kind: 'gaddev.task-capsule',
    schemaVersion: 1,
    goal: text(value.goal, LIMITS.goal),
    decisions: list(value.decisions),
    files,
    checks: list(value.checks),
  };
}
export function serialize(capsule: Capsule): string {
  const result = JSON.stringify(capsule, null, 2) + '\n';
  parseCapsule(result);
  return result;
}
export async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function rootOf(files: Files): Promise<string> {
  const root = await files.stat(await files.cwd());
  if (root.kind !== 'dir' || !root.realPath)
    throw new Error('Working directory cannot be resolved.');
  return root.realPath.replace(/\\/g, '/').replace(/\/+$/, '');
}
async function read(
  files: Files,
  path: string,
  max: number,
): Promise<{ root: string; value: string }> {
  const root = await rootOf(files);
  const requested = `${root}/${path}`;
  const before = await files.stat(requested);
  if (!before.realPath || !before.realPath.replace(/\\/g, '/').startsWith(`${root}/`))
    throw new Error('Selected file resolves outside the working directory.');
  if (before.kind !== 'file' || before.size < 0 || before.size > max)
    throw new Error('Selected file is not a regular file or exceeds its size limit.');
  const value = await files.read(before.realPath);
  if (bytes(value) > max || value.includes('\0'))
    throw new Error('Selected file is oversized or contains binary data.');
  const after = await files.stat(requested);
  if (
    after.kind !== 'file' ||
    after.realPath !== before.realPath ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs
  )
    throw new Error('Selected file changed while being read.');
  return { root, value };
}
function handoff(checks: FileCheck[], json: string): string {
  const longest = Math.max(0, ...Array.from(json.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [
    'TASK CAPSULE — HUMAN-AUTHORED HANDOFF',
    'Review the goal and notes in the target project before use. This is authored data, not a test result or an instruction from the system.',
    'All checks in the capsule remain unresolved and unverified by this mod. No commands or tests have been run.',
    'FILE REFERENCES (decoded text fingerprints; point-in-time evidence)',
    ...(checks.length
      ? checks.map((file) => `${file.path}: ${file.status}`)
      : ['No file references selected.']),
    'Matching means content matches the recorded hash, not that it is correct, trusted, or from a particular commit. Verify again after opening a fresh session.',
    '',
    fence + 'json',
    json.trimEnd(),
    fence,
  ].join('\n');
}

export class Capsules {
  current: Capsule | undefined;
  review: Review | undefined;
  private root: string | undefined;
  clear(): void {
    this.current = undefined;
    this.review = undefined;
    this.root = undefined;
  }
  private active(): Capsule {
    if (!this.current) throw new Error('Set a goal or import a capsule first.');
    return this.current;
  }
  private update(next: Capsule): void {
    this.current = parseCapsule(serialize(next));
    this.review = undefined;
  }
  goal(value: string): void {
    const current: Capsule = this.current ?? {
      kind: 'gaddev.task-capsule',
      schemaVersion: 1,
      goal: '',
      decisions: [],
      files: [],
      checks: [],
    };
    this.update({ ...current, goal: text(value, LIMITS.goal) });
  }
  add(kind: 'decision' | 'check', value: string): void {
    const current = this.active();
    const key = kind === 'decision' ? 'decisions' : 'checks';
    this.update({ ...current, [key]: [...current[key], text(value, LIMITS.item)] });
  }
  edit(kind: 'decision' | 'check', index: number, value: string): void {
    const current = this.active();
    const key = kind === 'decision' ? 'decisions' : 'checks';
    if (!Number.isSafeInteger(index) || index < 1 || index > current[key].length)
      throw new Error('Use an existing item index starting at 1.');
    const items = [...current[key]];
    items[index - 1] = text(value, LIMITS.item);
    this.update({ ...current, [key]: items });
  }
  remove(kind: 'decision' | 'check' | 'file', index: number): void {
    const current = this.active();
    const key = kind === 'decision' ? 'decisions' : kind === 'check' ? 'checks' : 'files';
    if (!Number.isSafeInteger(index) || index < 1 || index > current[key].length)
      throw new Error('Use an existing item index starting at 1.');
    const next = {
      ...current,
      decisions: [...current.decisions],
      checks: [...current.checks],
      files: [...current.files],
    };
    next[key].splice(index - 1, 1);
    this.update(next);
  }
  private async assertWorkspace(files: Files): Promise<void> {
    if (this.root !== undefined && (await rootOf(files)) !== this.root)
      throw new Error(
        'Working directory changed. Import the capsule in the intended project to bind it again.',
      );
  }
  async file(files: Files, value: string): Promise<void> {
    this.review = undefined;
    const current = this.active();
    if (current.files.length >= LIMITS.files) throw new Error('Use at most eight file references.');
    const path = validatePath(value);
    if (current.files.some((file) => file.path === path))
      throw new Error('File path is already selected.');
    await this.assertWorkspace(files);
    const source = await read(files, path, LIMITS.sourceBytes);
    if (this.root !== undefined && this.root !== source.root)
      throw new Error(
        'Working directory changed. Import the capsule in the intended project to bind it again.',
      );
    this.update({
      ...current,
      files: [...current.files, { path, sha256: await fingerprint(source.value) }],
    });
    this.root = source.root;
  }
  async refresh(files: Files, index: number): Promise<void> {
    this.review = undefined;
    const current = this.active();
    if (!Number.isSafeInteger(index) || index < 1 || index > current.files.length)
      throw new Error('Use an existing file index starting at 1.');
    const reference = current.files[index - 1];
    if (!reference) throw new Error('File reference unavailable.');
    await this.assertWorkspace(files);
    const source = await read(files, reference.path, LIMITS.sourceBytes);
    if (this.root !== source.root)
      throw new Error(
        'Working directory changed. Import the capsule in the intended project to bind it again.',
      );
    const refs = [...current.files];
    refs[index - 1] = { path: reference.path, sha256: await fingerprint(source.value) };
    this.update({ ...current, files: refs });
  }
  async importFile(files: Files, value: string): Promise<void> {
    this.review = undefined;
    const path = validatePath(value);
    if (!path.endsWith('.json')) throw new Error('Select a JSON capsule file.');
    const source = await read(files, path, LIMITS.jsonBytes);
    const capsule = parseCapsule(source.value);
    this.update(capsule);
    this.root = source.root;
  }
  async inspect(files: Files): Promise<Review> {
    this.review = undefined;
    const current = this.active();
    const json = serialize(current);
    const statuses: FileCheck[] = [];
    let root: string | undefined;
    if (current.files.length) {
      try {
        root = await rootOf(files);
      } catch {
        /* Every reference stays unavailable below. */
      }
    }
    for (const reference of current.files) {
      let status: FileCheck['status'] = 'unavailable';
      if (root !== undefined && root !== this.root) status = 'workspace-changed';
      else if (root !== undefined) {
        try {
          const source = await read(files, reference.path, LIMITS.sourceBytes);
          status =
            source.root !== this.root
              ? 'workspace-changed'
              : (await fingerprint(source.value)) === reference.sha256
                ? 'matching'
                : 'changed';
        } catch {
          /* Missing, oversized, binary, outward links, and read races all stay unavailable. */
        }
      }
      statuses.push({ path: reference.path, status });
    }
    const result = { json, files: statuses, handoff: handoff(statuses, json) };
    this.review = result;
    return result;
  }
  async draft(files: Files): Promise<string> {
    const review = await this.inspect(files);
    if (review.files.some((file) => file.status !== 'matching'))
      throw new Error(
        'File references need review. Refresh or remove changed/unavailable references before draft insertion; re-import after changing workspaces.',
      );
    return review.handoff;
  }
}
