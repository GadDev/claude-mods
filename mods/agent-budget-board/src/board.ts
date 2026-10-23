export const LIMITS = {
  workers: 8,
  scopes: 6,
  path: 240,
  goal: 1000,
  role: 80,
  task: 400,
  model: 120,
  jsonBytes: 32_768,
  page: 5000,
  draft: 16_000,
} as const;
export interface Worker {
  id: string;
  role: string;
  task: string;
  model: string;
  access: 'read' | 'write';
  scopes: string[];
}
export interface Plan {
  kind: 'gaddev.agent-plan';
  schemaVersion: 1;
  goal: string;
  concurrency: number;
  workers: Worker[];
}
export interface Review {
  fingerprint: string;
  blockers: string[];
  warnings: string[];
  batches: string[][];
  report: string;
}
export type WorkerField = 'role' | 'task' | 'model' | 'access' | 'scopes';
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error('Unexpected or missing plan fields.');
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`Use text of at most ${max} characters.`);
  /* oxlint-disable no-control-regex -- Keep authored labels free of terminal/binary control characters. */
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw new Error('Control characters are excluded.');
  /* oxlint-enable no-control-regex */
  return value.trim();
}
export function validateScope(value: unknown): string {
  const path = text(value, LIMITS.path);
  if (path === './') return path;
  /* oxlint-disable no-control-regex -- Scope labels must be printable relative paths. */
  if (!path || path.startsWith('/') || /[\\:\x00-\x1f\x7f*?{}[\]!,]/.test(path))
    throw new Error(
      'Use a relative file path or directory ending in /; globs and commas are unsupported.',
    );
  /* oxlint-enable no-control-regex */
  const parts = path.replace(/\/$/, '').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..'))
    throw new Error('Scope traversal and empty path segments are excluded.');
  return path;
}
export function overlap(a: string, b: string): boolean {
  return (
    a === './' ||
    b === './' ||
    a === b ||
    a.replace(/\/$/, '') === b.replace(/\/$/, '') ||
    (a.endsWith('/') && b.startsWith(a)) ||
    (b.endsWith('/') && a.startsWith(b))
  );
}
export function parsePlan(raw: string): Plan {
  if (new TextEncoder().encode(raw).length > LIMITS.jsonBytes)
    throw new Error('Plan JSON exceeds 32 KiB.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid plan JSON.');
  }
  if (!record(value)) throw new Error('Plan must be an object.');
  keys(value, ['kind', 'schemaVersion', 'goal', 'concurrency', 'workers']);
  if (value.kind !== 'gaddev.agent-plan' || value.schemaVersion !== 1)
    throw new Error('Unsupported plan kind or version.');
  if (
    typeof value.concurrency !== 'number' ||
    !Number.isSafeInteger(value.concurrency) ||
    value.concurrency < 1 ||
    value.concurrency > LIMITS.workers
  )
    throw new Error('Concurrency must be an integer from 1 to 8.');
  if (!Array.isArray(value.workers) || value.workers.length > LIMITS.workers)
    throw new Error('Plan at most eight workers.');
  const workers = value.workers.map((item: unknown): Worker => {
    if (!record(item)) throw new Error('Invalid worker.');
    keys(item, ['id', 'role', 'task', 'model', 'access', 'scopes']);
    if (typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(item.id))
      throw new Error(
        'Worker IDs use 1–24 lowercase letters/digits/hyphens and start with a letter.',
      );
    const model = text(item.model, LIMITS.model);
    if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model))
      throw new Error('Use a model preference label without spaces or shell syntax.');
    if (item.access !== 'read' && item.access !== 'write')
      throw new Error('Choose read or write access for planning.');
    if (!Array.isArray(item.scopes) || item.scopes.length > LIMITS.scopes)
      throw new Error('Use at most six scopes per worker.');
    const scopes = item.scopes.map(validateScope);
    if (new Set(scopes).size !== scopes.length)
      throw new Error('Duplicate scope labels in one worker are excluded.');
    return {
      id: item.id,
      role: text(item.role, LIMITS.role),
      task: text(item.task, LIMITS.task),
      model,
      access: item.access,
      scopes,
    };
  });
  if (new Set(workers.map((worker) => worker.id)).size !== workers.length)
    throw new Error('Worker IDs must be unique.');
  return {
    kind: 'gaddev.agent-plan',
    schemaVersion: 1,
    goal: text(value.goal, LIMITS.goal),
    concurrency: value.concurrency,
    workers,
  };
}
export function serialize(plan: Plan): string {
  const result = JSON.stringify(plan, null, 2) + '\n';
  parsePlan(result);
  return result;
}
export async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export function analyze(plan: Plan): Omit<Review, 'fingerprint' | 'report'> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const batches: string[][] = [];
  if (!plan.goal) blockers.push('Set a concrete plan goal.');
  if (!plan.workers.length) blockers.push('Add at least one worker.');
  for (const worker of plan.workers) {
    for (const field of ['role', 'task', 'model'] as const)
      if (!worker[field]) blockers.push(`${worker.id}: set ${field}.`);
    if (!worker.scopes.length) blockers.push(`${worker.id}: select at least one scope.`);
    if (worker.scopes.includes('./'))
      warnings.push(`${worker.id}: workspace-wide scope. Consider narrowing it.`);
    for (let i = 0; i < worker.scopes.length; i++)
      for (let j = i + 1; j < worker.scopes.length; j++) {
        const a = worker.scopes[i];
        const b = worker.scopes[j];
        if (a && b && overlap(a, b))
          warnings.push(
            `${worker.id}: internally overlapping scopes ${a} and ${b}; consider keeping only the needed scope.`,
          );
      }
  }
  for (let i = 0; i < plan.workers.length; i++)
    for (let j = i + 1; j < plan.workers.length; j++) {
      const a = plan.workers[i];
      const b = plan.workers[j];
      if (!a || !b) continue;
      const simultaneous = Math.floor(i / plan.concurrency) === Math.floor(j / plan.concurrency);
      const when = simultaneous ? 'same suggested batch' : 'different suggested batches';
      if (a.task && normalized(a.task) === normalized(b.task))
        warnings.push(
          `${a.id} / ${b.id}: identical task text after whitespace/case normalization; review redundant work (${when}).`,
        );
      if (a.role && normalized(a.role) === normalized(b.role))
        warnings.push(
          `${a.id} / ${b.id}: repeated role label; confirm distinct responsibilities (${when}).`,
        );
      const matches = a.scopes.flatMap((left) =>
        b.scopes.filter((right) => overlap(left, right)).map((right) => `${left} ↔ ${right}`),
      );
      if (matches.length)
        warnings.push(
          `${a.id} / ${b.id}: ${a.access === 'read' && b.access === 'read' ? 'shared read scope; review repeated context gathering' : 'write-involved scope overlap; coordinate changes'} (${when}): ${matches.slice(0, 3).join('; ')}${matches.length > 3 ? `; ${matches.length - 3} additional scope pair(s)` : ''}.`,
        );
    }
  for (let i = 0; i < plan.workers.length; i += plan.concurrency)
    batches.push(plan.workers.slice(i, i + plan.concurrency).map((worker) => worker.id));
  return { blockers, warnings, batches };
}
export function report(plan: Plan, review: Omit<Review, 'report'>): string {
  return [
    'AGENT BUDGET BOARD — ADVISORY REVIEW',
    `Goal: ${plan.goal || '(not set)'}`,
    `${plan.workers.length} planned worker(s) · requested concurrency ${plan.concurrency} · ${review.batches.length} suggested batch(es)`,
    `Plan SHA-256 ${review.fingerprint}`,
    'No workers started by this mod. Concurrency and access modes are planning labels, not enforced limits or permissions. Models are unverified preferences, not price or availability claims.',
    '',
    'WORKERS',
    ...plan.workers.flatMap((worker) => [
      `${worker.id} · ${worker.role || '(role missing)'} · model ${worker.model || '(missing)'} · ${worker.access}`,
      `Task: ${worker.task || '(missing)'}`,
      `Scopes: ${worker.scopes.join(', ') || '(missing)'}`,
    ]),
    '',
    'SUGGESTED BATCHES (current list order; no dependency or runtime scheduling analysis)',
    ...review.batches.map((batch, index) => `${index + 1}. ${batch.join(', ')}`),
    '',
    `${review.blockers.length} APPROVAL BLOCKER(S)`,
    ...review.blockers,
    '',
    `${review.warnings.length} REVIEW WARNING(S)`,
    ...review.warnings,
    '',
    'Overlap analysis is lexical and case-sensitive for paths. It does not read files, expand globs, resolve symlinks, or prove task independence. No warning does not mean no overlap.',
    'Review flagged scopes or explicitly acknowledge warnings before local approval. Every saved edit invalidates review and approval. No token usage, billing cap, or savings measurement is provided.',
  ].join('\n');
}
export function page(text: string, offset = 0): string {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    throw new Error('Use an integer character offset within the report.');
  return `${text.slice(offset, offset + LIMITS.page)}\n[characters ${offset}–${Math.min(text.length, offset + LIMITS.page)} of ${text.length}; next offset ${Math.min(text.length, offset + LIMITS.page)}]`;
}
export class Board {
  private value: Plan = {
    kind: 'gaddev.agent-plan',
    schemaVersion: 1,
    goal: '',
    concurrency: 2,
    workers: [],
  };
  private last: Review | undefined;
  private approval: { fingerprint: string; serialized: string } | undefined;
  get plan(): Plan {
    return parsePlan(serialize(this.value));
  }
  get reviewed(): Review | undefined {
    return this.last
      ? {
          ...this.last,
          blockers: [...this.last.blockers],
          warnings: [...this.last.warnings],
          batches: this.last.batches.map((batch) => [...batch]),
        }
      : undefined;
  }
  get approved(): boolean {
    return this.approval?.serialized === serialize(this.value);
  }
  private update(plan: Plan): void {
    this.value = parsePlan(serialize(plan));
    this.last = undefined;
    this.approval = undefined;
  }
  clear(): void {
    this.update({
      kind: 'gaddev.agent-plan',
      schemaVersion: 1,
      goal: '',
      concurrency: 2,
      workers: [],
    });
  }
  goal(value: string): void {
    this.update({ ...this.value, goal: text(value, LIMITS.goal) });
  }
  concurrency(value: number): void {
    this.update({ ...this.value, concurrency: value });
  }
  add(id: string): void {
    this.update({
      ...this.value,
      workers: [
        ...this.value.workers,
        { id, role: id, task: '', model: 'inherit', access: 'read', scopes: [] },
      ],
    });
  }
  remove(id: string): void {
    if (!this.value.workers.some((worker) => worker.id === id))
      throw new Error('Unknown worker ID.');
    this.update({
      ...this.value,
      workers: this.value.workers.filter((worker) => worker.id !== id),
    });
  }
  edit(id: string, field: WorkerField, value: string): void {
    const index = this.value.workers.findIndex((worker) => worker.id === id);
    const worker = this.value.workers[index];
    if (!worker) throw new Error('Unknown worker ID.');
    const next = [...this.value.workers];
    next[index] = {
      ...worker,
      [field]:
        field === 'scopes'
          ? value.trim()
            ? value.split(',').map((item) => item.trim())
            : []
          : value,
    };
    this.update({ ...this.value, workers: next });
  }
  load(raw: string): void {
    this.update(parsePlan(raw));
  }
  export(): string {
    return serialize(this.value);
  }
  async review(): Promise<Review> {
    const serialized = this.export();
    const plan = parsePlan(serialized);
    const hash = await fingerprint(serialized);
    if (serialized !== this.export()) throw new Error('Plan changed during review. Review again.');
    const analysis = analyze(plan);
    const result = { ...analysis, fingerprint: hash };
    this.last = { ...result, report: report(plan, result) };
    return this.reviewed!;
  }
  view(offset = 0): string {
    if (!this.last) throw new Error('Review the saved plan first.');
    return page(this.last.report, offset);
  }
  async approve(acknowledge = false): Promise<void> {
    const reviewed = this.last;
    if (!reviewed) throw new Error('Review the saved plan before approval.');
    if (reviewed.blockers.length)
      throw new Error('Complete the plan before approval; see review blockers.');
    if (reviewed.warnings.length && !acknowledge)
      throw new Error('Narrow the flagged plan or explicitly acknowledge the review warnings.');
    const serialized = this.export();
    const hash = await fingerprint(serialized);
    if (this.last !== reviewed || serialized !== this.export() || hash !== reviewed.fingerprint)
      throw new Error('Plan changed. Review and approve it again.');
    this.approval = { fingerprint: hash, serialized };
  }
  draft(): string {
    if (!this.approved || !this.approval || !this.last)
      throw new Error('Review and approve the current plan first.');
    const json = this.export();
    const longest = Math.max(0, ...Array.from(json.matchAll(/`+/g), (match) => match[0].length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    const result = [
      'USER-REVIEWED ADVISORY AGENT PLAN',
      `Plan SHA-256 ${this.approval.fingerprint}`,
      `${this.last.warnings.length} review warning(s) acknowledged locally. No workers have been started by this mod.`,
      'Review this authored plan before deciding whether to delegate. Planned models, access, and concurrency are not engine permissions, resource reservations, or enforced limits. No cost or token savings has been established.',
      '',
      fence + 'json',
      json.trimEnd(),
      fence,
    ].join('\n');
    if (result.length > LIMITS.draft)
      throw new Error(
        'Plan exceeds the 16,000-character draft limit. Narrow it before draft insertion.',
      );
    return result;
  }
}
