# Contributing

Start with a concrete recurring problem and the smallest useful user action. For a new mod, open a feature proposal before introducing a shared framework or large integration.

## Local setup

```sh
npm ci
npm run types:fetch
npm run check
```

Use Node.js 24+, TypeScript strict mode, ESM, two-space indentation, and LF line endings. Runtime modules run in Claude Code's environment: use the mods API for I/O, not Node imports, browser globals, or an implicit shell. Keep imports inside the installed plugin directory.

## Pull requests

1. Create a short branch such as `feat/context-studio-preview`.
2. Make one coherent change. Add tests for meaningful failure modes and update the affected mod's README.
3. Run the repository checks and, when available, `claude plugin validate ./mods/context-studio`. Record any unavailable checks.
4. Include screenshots for visible changes and explain permission or compatibility changes.
5. Use a Conventional Commit PR title: `feat(context-studio): ...`, `fix(context-studio): ...`, `docs: ...`, or `chore(ci): ...`. Squash merges should preserve this title for Release Please.

Area labels are automatic. Apply intent labels such as `bug`, `enhancement`, `security`, or `accessibility` where appropriate. Labels organize work; conventional commits drive version changes. See [release operations](docs/releases.md).

## Quality expectations

- Give controls visible labels and keyboard access; pair status colors with text.
- Keep expensive work outside rendering and return explicit errors for missing or stale evidence.
- Preserve normal Claude Code permissions. Never add automatic approvals to make a demo work.
- Keep raw evidence available when filtering output; preserve failure and exit status.
- Label token estimates and evaluate task success as well as output size.
- Do not add telemetry, model calls, network access, or persistent source storage without documenting the user-facing behavior.

## Adding a mod

Create `mods/<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, source files, README, LICENSE, and CHANGELOG. Add its npm workspace, marketplace entry, tests, labels, and Release Please component. List only working implementations in the marketplace. Shared utilities should be extracted after a second mod needs them, and included inside every installed plugin that uses them.

## Licensing

By submitting a contribution you agree it can be distributed under the repository's MIT license. Credit third-party work and include required notices.
