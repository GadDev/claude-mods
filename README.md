# Claude Mods

Focused tools for deliberate context, useful interfaces, and less wasted work in Claude Code.

[![CI](https://github.com/GadDev/claude-mods/actions/workflows/ci.yml/badge.svg)](https://github.com/GadDev/claude-mods/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-51796E.svg)](LICENSE)

An independent collection by [GadDev](https://github.com/GadDev). Each mod is an independently installable plugin. No affiliation with Anthropic.

## Available mods

Each available mod has its own icon, documentation, and installation. Versions are tracked in each plugin manifest; Symbol Navigator is the new experimental 0.1.0 prototype.

| Icon                                                                                                                                       | Mod                                                           | What it helps you do                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| <img src="mods/context-studio/assets/icon.png" width="80" alt="Context Studio: an open folio gathering selected source tabs" />            | [Context Studio](mods/context-studio/README.md)               | Select source excerpts, verify their freshness, and append a reviewed task packet to your prompt draft.                                    |
| <img src="mods/output-lens/assets/icon.png" width="80" alt="Output Lens: a magnifying lens revealing diagnostic lines" />                  | [Output Lens](mods/output-lens/README.md)                     | Inspect a selected Vitest JSON report and retrieve bounded summaries, individual diagnostics, or raw report pages.                         |
| <img src="mods/retry-map/assets/icon.png" width="80" alt="Retry Map: a looping path with a breakout arrow" />                              | [Retry Map](mods/retry-map/README.md)                         | Recognize identical Bash failures and inspect retry history without blocking commands or changing tool results.                            |
| <img src="mods/instruction-workbench/assets/icon.png" width="80" alt="Instruction Workbench: instruction cards on a drafting workbench" /> | [Instruction Workbench](mods/instruction-workbench/README.md) | Review selected instruction files, exact duplicate lines, source locations, and consolidation proposals without model calls or file edits. |
| <img src="mods/task-capsules/assets/icon.png" width="80" alt="Task Capsules: a compact capsule holding a task card" />                     | [Task Capsules](mods/task-capsules/README.md)                 | Edit a small handoff with goals, decisions, file hashes, and unresolved checks; explicitly export/import it for another session.           |
| <img src="mods/agent-budget-board/assets/icon.png" width="80" alt="Agent Budget Board: task tiles connected to a resource dial" />         | [Agent Budget Board](mods/agent-budget-board/README.md)       | Review worker roles, scope overlap, model preferences, and suggested concurrency; locally approve or narrow the plan before delegation.    |
| <img src="mods/symbol-navigator/assets/icon.png" width="80" alt="Symbol Navigator: code braces around a compass" />                        | [Symbol Navigator](mods/symbol-navigator/README.md)           | Retrieve a TypeScript definition and selected references from an explicit local index, with recorded-input freshness checks.               |

See the [icon gallery](docs/icons.md) for the original artwork and asset details.

## Try Output Lens and Retry Map

Each installs independently:

```text
/plugin marketplace add GadDev/claude-mods
/plugin install output-lens@gaddev-mods
/plugin install retry-map@gaddev-mods
```

After reloading plugins, generate a Vitest JSON report through your usual test command and select it with `/output-lens load vitest-results.json`. Open `/output-lens` to inspect it, or ask Claude to use its report tool for concise diagnostics. Open `/retry-map` to inspect repeated Bash tool failures; it observes without blocking commands or changing their output.

These target reduced diagnostic context and earlier intervention in repeated failures. Savings remain unbenchmarked. Current Vitest already offers an agent-friendly reporter; Output Lens adds structured report inspection and evidence retrieval.

## Try Instruction Workbench

```text
/plugin install instruction-workbench@gaddev-mods
/reload-plugins
/instruction-workbench add CLAUDE.md
/instruction-workbench add .claude/rules/testing.md
/instruction-workbench audit
```

Open `/instruction-workbench` for the review pane. Source references and fingerprints make findings inspectable; scope labels describe file location, not effective instruction loading. Proposals are review-only. Claude's built-in `/doctor prompt-audit` remains the option for a model-assisted semantic review. See [usage and limits](mods/instruction-workbench/README.md).

## Try Task Capsules

```text
/plugin install task-capsules@gaddev-mods
/reload-plugins
/task-capsules goal Finish authentication cleanup
/task-capsules decision Keep the public API
/task-capsules check Run authentication tests
/task-capsules file src/auth.ts
/task-capsules preview
/task-capsules export
```

Copy the complete exported JSON to a local file, then use `/task-capsules import <capsule.json>` in a fresh session in the intended project. Preview it and choose **Append verified handoff to current draft** when ready. The mod does not autosave, submit prompts, or launch sessions. See [the handoff workflow and freshness limits](mods/task-capsules/README.md).

## Try Agent Budget Board

```text
/plugin install agent-budget-board@gaddev-mods
/reload-plugins
/agent-budget-board
```

Add planned workers, edit their roles/tasks/scopes/model preferences, and choose requested concurrency. Review the report, narrow overlaps or explicitly acknowledge warnings, then mark the saved plan approved locally. An approved plan can be appended to your draft. Approval starts no workers and grants no engine permissions; this is an advisory planning step, not a billing or live-concurrency limit. See [usage and limits](mods/agent-budget-board/README.md).

## Try Symbol Navigator

From a checkout of this repository with Node 24+:

```sh
npm ci
npm run symbols:demo
```

Follow the exact launch commands it prints, then load `symbol-index.json`, search `quoteTotal`, and choose the pricing definition. The demo creates a fresh temporary project, so you can try selection, paging, stale-source refusal, and rebuilding without changing a real project. The pane guides you through loading, finding, choosing, and previewing; Previous/Next buttons handle paging.

See the [guided test drive](examples/symbol-navigator/README.md) and [your-own-project setup and limits](mods/symbol-navigator/README.md#generate-an-index). To rehearse the demo without launching Claude or calling a model, run `npm run symbols:demo -- --check`.

## Try Context Studio

You need Claude Code CLI **2.1.287 or later**. Desktop and VS Code support depend on their bundled engine and available UI elements; see [compatibility](docs/compatibility.md). Node.js is needed for repository development and explicit Symbol Navigator index generation; the installed native readers need no Node runtime.

In Claude Code:

```text
/plugin marketplace add GadDev/claude-mods
/plugin install context-studio@gaddev-mods
```

Restart the session or run `/reload-plugins`, then open `/context-studio`.

1. Set a concrete task.
2. Add a source range such as `src/app.ts:1-30`.
3. Choose **Verify and preview**.
4. Choose **Append verified packet to draft**, inspect it, and press Enter yourself.

The mod makes no background model calls, changes no source files, and does not submit prompts automatically. Once you send a packet, it becomes ordinary model context. It does not remove previous context or guarantee savings.

## Develop

Use Node.js 24+ and npm:

```sh
npm ci
npm run types:fetch
npm run check
claude --plugin-dir ./mods/context-studio
```

`npm ci` installs the Husky pre-commit hook. It uses lint-staged to lint staged code with Oxlint and format supported staged files with Oxfmt, preserving unstaged edits.

```sh
npm run lint          # Check code with Oxlint
npm run format        # Apply Oxfmt formatting
npm run format:check  # Check formatting without writing
```

`npm run check` runs lint, formatting, repository validation, TypeScript, and Node/native tests. The same command runs in CI. See [contributing](CONTRIBUTING.md) for the full workflow.

The type-fetch step verifies a pinned copy of Anthropic's official declarations. Runtime code has no third-party dependencies and no build step. [Development and testing](docs/development.md) covers the local Claude validation commands and their limits.

## Documentation

- [Context Studio usage and commands](mods/context-studio/README.md)
- [Output Lens usage and commands](mods/output-lens/README.md)
- [Retry Map usage and commands](mods/retry-map/README.md)
- [Instruction Workbench usage and commands](mods/instruction-workbench/README.md)
- [Task Capsules usage and commands](mods/task-capsules/README.md)
- [Agent Budget Board usage and commands](mods/agent-budget-board/README.md)
- [Symbol Navigator usage and commands](mods/symbol-navigator/README.md)
- [Architecture and repository structure](docs/architecture.md)
- [Development and testing](docs/development.md)
- [Compatibility and troubleshooting](docs/compatibility.md)
- [Release operations and PR labels](docs/releases.md)
- [Measurement methodology](docs/measurement.md)
- [Roadmap](docs/roadmap.md)
- [Custom mod icons](docs/icons.md)
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), and [community conduct](CODE_OF_CONDUCT.md)

## License

[MIT](LICENSE). Source code and original project assets use this license unless a file says otherwise. Third-party names remain their owners' property.
