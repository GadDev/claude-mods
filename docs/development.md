# Development and testing

## Install and check

Use Node.js 24+ and npm. From the repository root:

```sh
npm ci
npm run types:fetch
npm run check
```

`validate` checks marketplace and plugin metadata, version alignment, contained entry points, required documentation, release configuration, labels, action pins, and local Markdown links. It is a repository check, not a replacement for Claude Code's engine validator.

`typecheck` checks runtime code without Node or DOM types, against a checksum-verified copy of Anthropic's declarations. A separate configuration checks Node tools and tests. The pinned declarations were published from Claude Code 2.1.277 at official commit `bf2323b3021c9d3db7a31e1e7d61068c3f704497`; this is older than the documented install baseline. They are a reproducible compile-time reference, not proof of behavior in every later build. They are downloaded into ignored `.cache/mod-types/`, never redistributed in the plugin. Your installed engine's generated declarations remain authoritative.

`test` uses Node's built-in test runner and native TypeScript stripping. Tests cover invalid paths, outward symlinks, file changes, packet limits, missing evidence, lifecycle resets, ordering, and draft preparation. Adapter doubles exercise our event handlers.

`check:native` uses the pinned development dependency Claude Code **2.1.308** to validate the marketplace and plugin with the native loader, then runs `claude plugin test`. Native tests verify command handling, content invalidation, and valid UI trees on terminal, Desktop, and VS Code. They run without sign-in or model requests; they validate element contracts, not the actual pixels of each application. `npm run check` includes both Node and native checks.

## Native validation and manual smoke test

The development dependency provides the validation CLI through npm scripts. To try the mod interactively using your own installed and authenticated Claude Code, run:

```sh
claude plugin validate .
claude plugin validate ./mods/context-studio
claude --plugin-dir ./mods/context-studio
```

Inside that session:

```text
/context-studio goal Explain the Studio implementation
/context-studio add mods/context-studio/src/studio.ts:1-30
/context-studio preview
/context-studio draft
```

Verify the pane with `/context-studio`. Check keyboard focus, wrapping in a narrow terminal, removal controls, appending to an existing draft, and dismissal. Confirm opening the pane performs no source reads or model calls. Then edit the selected source outside the mod and verify that preview/draft refuses the stale snapshot. Clear and resume a session and verify the old packet disappears.

Run `claude plugin validate` again after changes. The tests in each `mods/<name>/tests/` use `claude-code/testing`; the root `tests/` use Node. Keep their runners separate. Native test results do not replace a manual smoke test with your own terminal or app.

For Output Lens, generate a JSON report with your installed Vitest, then use `/output-lens load <path.json>` and inspect it through both the pane and `mcp__output-lens__report`. Replace the report and verify stale selection is rejected. The committed mixed-result fixture was captured from Vitest 5.0.5, with environment-specific paths normalized. It includes pass, failure, skipped, and todo cases; ongoing tests do not install or execute Vitest.

For Retry Map, use a disposable project to repeat one failing command three times. Verify one warning appears and the original results remain intact. Change code with a file tool and verify a new comparison group, then run a successful command and inspect its resolved status. Shell and external edits are deliberately not inferred.

## API upgrades

Read [Anthropic's mod creation guide](https://code.claude.com/docs/en/plugins/mods/create) and regenerate your installed types using `/plugin-types`. Review the declaration diff before changing the pinned official revision and checksum in `scripts/fetch-mod-types.ts`. Keep the documented baseline, source APIs, CI, and smoke-test results aligned. Never suppress incompatible API fields with `any`.

## CI

The `Check` job runs on pull requests, main pushes, and manual dispatch. It installs the committed lockfile, retrieves verified declarations, and runs all repository checks including native plugin validation and the Claude test kit. It does not run an authenticated live conversation.

Third-party actions are pinned to full SHAs and updated by Dependabot. PR code executes only in the read-only CI workflow. The `pull_request_target` labeler never checks out or runs PR code.
