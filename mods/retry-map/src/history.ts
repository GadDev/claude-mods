export const LIMITS = {
  groups: 30,
  commandCharacters: 16_000,
  errorCharacters: 64_000,
  displayErrorCharacters: 8_000,
  warningOccurrences: 3,
} as const;
export interface Failure {
  id: number;
  command: string;
  agent: string;
  error: string;
  count: number;
  first: number;
  last: number;
  editRevision: number;
  signature: string | undefined;
  commandKey: string;
  resolved: boolean;
  truncated: boolean;
}

export function clean(text: string): string {
  /* oxlint-disable no-control-regex -- Intentionally reject path controls or strip terminal control sequences. */
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  /* oxlint-enable no-control-regex */
}

async function hash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

export class History {
  groups: Failure[] = [];
  editRevision = 0;
  private nextId = 1;
  private active = new Map<string, number>();

  clear(): void {
    this.groups = [];
    this.editRevision = 0;
    this.nextId = 1;
    this.active.clear();
  }

  observedEdit(): void {
    this.editRevision += 1;
    this.active.clear();
  }

  async failure(
    command: string,
    error: string | undefined,
    agent: string,
    now: number,
    canCompare = true,
  ): Promise<Failure> {
    // Incomplete output is never used to assert that two failures are identical.
    const comparable =
      canCompare &&
      command.length <= LIMITS.commandCharacters &&
      error !== undefined &&
      error.length > 0 &&
      error.length <= LIMITS.errorCharacters;
    const commandKey = await hash(JSON.stringify([agent, command]));
    const signature = comparable ? await hash(error) : undefined;
    const previous = this.groups.find((group) => group.id === this.active.get(commandKey));
    if (
      previous &&
      signature &&
      previous.signature === signature &&
      previous.editRevision === this.editRevision &&
      !previous.resolved
    ) {
      previous.count += 1;
      previous.last = now;
      return previous;
    }
    const group: Failure = {
      id: this.nextId++,
      command: clean(command.slice(0, LIMITS.commandCharacters)),
      agent: clean(agent),
      error: clean(
        (error || 'Failure details unavailable. This occurrence is not comparable.').slice(
          0,
          LIMITS.displayErrorCharacters,
        ),
      ),
      count: 1,
      first: now,
      last: now,
      editRevision: this.editRevision,
      signature,
      commandKey,
      resolved: false,
      truncated:
        command.length > LIMITS.commandCharacters ||
        (error?.length ?? 0) > LIMITS.displayErrorCharacters,
    };
    this.groups.push(group);
    if (this.groups.length > LIMITS.groups) this.groups.shift();
    this.active.set(commandKey, group.id);
    const retained = new Set(this.groups.map((group) => group.id));
    for (const [key, id] of this.active) if (!retained.has(id)) this.active.delete(key);
    return group;
  }

  async success(command: string, agent: string): Promise<void> {
    const commandKey = await hash(JSON.stringify([agent, command]));
    const previous = this.groups.find((group) => group.id === this.active.get(commandKey));
    if (previous) previous.resolved = true;
    this.active.delete(commandKey);
  }

  status(group: Failure): string {
    if (group.resolved) return 'Tool later succeeded';
    if (group.editRevision !== this.editRevision) return 'Before an observed file-tool edit';
    if (!group.signature) return 'Incomplete evidence';
    return group.count >= LIMITS.warningOccurrences
      ? 'Repeated failure: inspect before retrying'
      : 'Failure recorded';
  }

  summary(): string {
    return [
      'Retry Map — recent Bash tool failures',
      'Exact command/error matches are grouped per agent, since the last successful Edit/Write/NotebookEdit observed by this mod. Shell or external edits may be invisible. Counts are not evidence of wasted tokens.',
      ...this.groups
        .slice()
        .reverse()
        .map(
          (group) =>
            `#${group.id} · ${group.count} occurrence(s) · ${this.status(group)}\n${group.agent}: ${group.command.slice(0, 200)}`,
        ),
    ].join('\n\n');
  }
}
