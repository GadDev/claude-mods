# Architecture

## Product boundary

One repository hosts independently installable Claude Code plugins. The root marketplace lists implemented mods only. Each plugin carries its runtime files, documentation, license, and assets; installing one does not activate the others.

Context Studio prepares additional source context for a task. It does not control Claude's entire context window, replace existing instructions, or guarantee reduced usage.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `.claude-plugin/marketplace.json` | Catalog of independently installable plugins |
| `mods/context-studio/.claude-plugin/plugin.json` | Plugin metadata and version |
| `mods/context-studio/hooks/` | Claude Code entry point and event handlers |
| `mods/context-studio/src/` | Host-independent task packet and freshness logic |
| `tests/` | Node tests for core behavior and runtime adapter contracts |
| `scripts/` | Repository validation and pinned API-type retrieval |
| `docs/` | Maintainer guidance, decisions, roadmap, and measurement |
| `.github/` | CI, releases, labels, issue forms, and contributor templates |

There are no empty shared-package or browser-app workspaces. Add them only when working code needs them.

## Context Studio flow

The hooks module registers `/context-studio`. The command opens a pane or performs one explicit action. The core `Studio` receives filesystem operations through a small interface; it has no Node, DOM, network, or Claude dependencies.

On **Add**, it validates a relative text-file selection, resolves the working directory and file, checks containment and size, reads the source, and records the range with a whole-file SHA-256 fingerprint. On **Preview** or **Draft**, it rechecks every selected source before formatting the packet. Any failed read or mismatch refuses the entire operation.

The pane uses standard `Box`, `Text`, `Input`, `Button`, and `Code` elements. Source I/O happens in explicit actions, not rendering. Actions are serialized so overlapping inputs cannot reorder mutations. State is held in the registration closure and cleared on session lifecycle changes; no persistent source cache is created.

Draft insertion uses `prompt.fill` with append mode. It preserves an existing draft and leaves sending to the user. A later file edit does not rewrite or retract a prepared draft.

## Sharing and packaging

No runtime imports may escape a plugin directory. If two mods later share logic, extract a package and copy or bundle its required code into each installed artifact. Do not assume a sibling workspace exists in Claude Code's plugin cache.

A future browser companion should reuse domain contracts, with a separate adapter for its data source. It must not assume native mod panes appear in claude.ai. Start with explicit packet import/export; a live local bridge would require a separate design for authentication, origins, permissions, and lifecycle.

## Decisions

- TypeScript ESM, strict checks, Node 24 tooling, no runtime dependencies.
- Native loading of `.ts` files; no bundler until a concrete dependency requires one.
- One release component per working mod, managed with Release Please.
- No automatic model calls, prompt submission, agent starts, or telemetry in Context Studio.
- Conservative fingerprints: any source-file change invalidates its selected ranges.
- Human selection is the MVP; automatic relevance and symbol navigation remain future work.
