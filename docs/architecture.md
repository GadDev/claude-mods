# Architecture

## Product boundary

One repository hosts independently installable Claude Code plugins. The root marketplace lists implemented mods only. Each plugin carries its runtime files, documentation, license, and assets; installing one does not activate the others.

Context Studio prepares additional source context for a task. It does not control Claude's entire context window, replace existing instructions, or guarantee reduced usage.

## Repository layout

| Path                                     | Responsibility                                               |
| ---------------------------------------- | ------------------------------------------------------------ |
| `.claude-plugin/marketplace.json`        | Catalog of independently installable plugins                 |
| `mods/<name>/.claude-plugin/plugin.json` | Independent plugin metadata and version                      |
| `mods/<name>/hooks/`                     | Claude Code entry points and event handlers                  |
| `mods/<name>/src/`                       | Host-independent domain logic                                |
| `tests/`                                 | Node tests for core behavior and runtime adapter contracts   |
| `scripts/`                               | Repository validation and pinned API-type retrieval          |
| `docs/`                                  | Maintainer guidance, decisions, roadmap, and measurement     |
| `.github/`                               | CI, releases, labels, issue forms, and contributor templates |

There are no empty shared-package or browser-app workspaces. Add them only when working code needs them.

## Context Studio flow

The hooks module registers `/context-studio`. The command opens a pane or performs one explicit action. The core `Studio` receives filesystem operations through a small interface; it has no Node, DOM, network, or Claude dependencies.

On **Add**, it validates a relative text-file selection, resolves the working directory and file, checks containment and size, reads the source, and records the range with a whole-file SHA-256 fingerprint. On **Preview** or **Draft**, it rechecks every selected source before formatting the packet. Any failed read or mismatch refuses the entire operation.

The pane uses standard `Box`, `Text`, `Input`, `Button`, and `Code` elements. Source I/O happens in explicit actions, not rendering. Actions are serialized so overlapping inputs cannot reorder mutations. State is held in the registration closure and cleared on session lifecycle changes; no persistent source cache is created.

Draft insertion uses `prompt.fill` with append mode. It preserves an existing draft and leaves sending to the user. A later file edit does not rewrite or retract a prepared draft.

## Sharing and packaging

Agent Budget Board keeps a bounded, human-authored worker plan in memory. Its pure analyzer compares exact path/directory labels, distinguishes shared reading from write-involved overlap, flags repeated roles/tasks, and groups workers in list order into suggested batches. It accesses no filesystem or model metadata and intercepts no worker starts. Canonical-plan fingerprints bind review and local approval to saved data; every successful mutation invalidates both. Explicit draft insertion is available only after completeness checks and acknowledgment of remaining warnings. Concurrency, model preference, access, and approval are advisory labels rather than engine controls. JSON export carries no approval state; pasted JSON load is strict, transactional, and resets approval.

Task Capsules keeps one human-authored handoff in memory. Its versioned JSON schema carries only a goal, decisions, unresolved checks, and relative file/text-hash references. Import reads the selected JSON file without resolving its references; explicit review checks those references against the current workspace. Matching means content matches an authored baseline, not trusted provenance or passed tests. Stale references remain visible and block prompt-draft insertion until the user refreshes or removes them. Explicit export displays complete JSON for the user to save, without filesystem writes; explicit draft insertion appends and never submits. All actions are serialized and session lifecycle events clear state.

Instruction Workbench explicitly selects local instruction sources through a filesystem port. Its pure scanner groups exact guidance lines, retaining source locations and lexical scope labels. It never follows imports or simulates the engine's loading rules. Every audit and report page verifies all selected source hashes. Findings propose human review without writing files, creating skills, registering model-facing tools, or modifying prompts. The plugin keeps all state in memory and ships independently.

Output Lens loads a user-selected local JSON report through filesystem ports. Its parser validates counts and assertion evidence, formats bounded summaries, and pages complete diagnostics or raw report text. The registered `report` tool can only query this selection. Every query rechecks the report fingerprint and working directory. It does not observe a test process or verify the tested source revision; statuses describe report evidence only.

Retry Map observes Bash outcomes after the existing tool chain returns. It groups exact command/error fingerprints per agent and observed file-tool edit period. A bounded history drives its pane. The original result is returned unchanged, including failures, denials, and permission behavior. Lifecycle generations prevent pending old observations from entering a new session. It has no filesystem port or model-facing tool.

Both implementations remain self-contained. `scripts/check-native.ts` discovers every marketplace entry and runs native validation and tests with the pinned development CLI, so adding a plugin cannot silently omit its native checks.

No runtime imports may escape a plugin directory. If two mods later share logic, extract a package and copy or bundle its required code into each installed artifact. Do not assume a sibling workspace exists in Claude Code's plugin cache.

A future browser companion should reuse domain contracts, with a separate adapter for its data source. It must not assume native mod panes appear in claude.ai. Start with explicit packet import/export; a live local bridge would require a separate design for authentication, origins, permissions, and lifecycle.

## Decisions

- TypeScript ESM, strict checks, Node 24 tooling, no runtime dependencies.
- Native loading of `.ts` files; no bundler until a concrete dependency requires one.
- One release component per working mod, managed with Release Please.
- No automatic model calls, prompt submission, agent starts, or telemetry in Context Studio.
- Conservative fingerprints: any source-file change invalidates its selected ranges.
- Human selection is the MVP; automatic relevance and symbol navigation remain future work.
