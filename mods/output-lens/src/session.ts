import { diagnostic, LIMITS, page, parseReport, summary } from './report.ts';
import type { Report } from './report.ts';

export interface Stat { kind: string; size: number; mtimeMs: number; realPath?: string }
export interface Files { cwd(): Promise<string>; stat(path: string): Promise<Stat>; read(path: string): Promise<string> }
export interface Loaded { root: string; path: string; realPath: string; hash: string; report: Report }

export function validatePath(value: string): string {
  const path = value.trim();
  if (!path.endsWith('.json') || path.length > 300 || /[\\:\x00-\x1f\x7f]/.test(path) || path.startsWith('/')) throw new Error('Use a relative JSON report path with forward slashes (at most 300 characters).');
  const segments = path.split('/');
  if (segments.some((part, index) => !part || part === '.' || part === '..' || (part.startsWith('.') && !(part === '.vitest' && index === 0))) || /(?:^|\/)(?:credentials|secrets?)(?:[./]|$)/i.test(path)) {
    throw new Error('Hidden paths, traversal, and obvious secret filenames are excluded; .vitest reports are allowed.');
  }
  return path;
}

async function hash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

async function read(files: Files, path: string): Promise<{ root: string; realPath: string; text: string }> {
  const root = await files.stat(await files.cwd());
  if (root.kind !== 'dir' || !root.realPath) throw new Error('Working directory cannot be resolved.');
  const base = root.realPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const requested = `${base}/${path}`;
  const before = await files.stat(requested);
  const realPath = before.realPath;
  if (!realPath || !realPath.replace(/\\/g, '/').startsWith(`${base}/`)) throw new Error('Report resolves outside the working directory.');
  if (before.kind !== 'file' || before.size > LIMITS.reportBytes) throw new Error('Select a JSON report file no larger than 2 MiB.');
  const text = await files.read(realPath);
  const after = await files.stat(requested);
  if (after.realPath !== before.realPath || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('Report changed while being read. Load it again when the run finishes.');
  return { root: root.realPath, realPath, text };
}

export class Lens {
  loaded: Loaded | undefined;

  clear(): void { this.loaded = undefined; }

  async load(files: Files, value: string): Promise<void> {
    this.clear();
    const path = validatePath(value);
    const source = await read(files, path);
    const report = parseReport(source.text);
    this.loaded = { root: source.root, path, realPath: source.realPath, hash: await hash(source.text), report };
  }

  async view(files: Files, kind: string, index = 1, offset = 0): Promise<string> {
    const loaded = this.loaded;
    if (!loaded) throw new Error('No report selected. Use /output-lens load <report.json> first.');
    try {
      const current = await read(files, loaded.path);
      if (current.root !== loaded.root || current.realPath !== loaded.realPath || await hash(current.text) !== loaded.hash) {
        throw new Error('Report or working directory changed. Load the report again to inspect the new run.');
      }
    } catch (error) {
      this.clear();
      throw error;
    }
    switch (kind) {
      case 'summary': return summary(loaded.report, loaded.path, loaded.hash);
      case 'failure': return diagnostic(loaded.report, index, offset);
      case 'raw': return page(loaded.report.raw, offset);
      default: throw new Error('Choose summary, failure, or raw.');
    }
  }
}
