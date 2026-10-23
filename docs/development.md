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

For Instruction Workbench, add two project instruction files with an intentional repeated guidance line, audit, and inspect the referenced locations and scope caveat. Change a selected file and verify that audit/page refuses stale evidence and clears the selection. Opening the pane must perform no reads; no audit action may write files or call a model. Compare a reviewed sample with Claude's built-in `/doctor prompt-audit` before claiming broader usefulness.

For Task Capsules, author a goal, decision, unresolved check, and one file reference in the pane. Export JSON, save only the JSON body to a local file, then import it in a fresh interactive session in the same project. Confirm that import alone does not read references, preview shows their status, and draft insertion appends without sending. Change a referenced file and verify draft insertion refuses it until explicit refresh/removal. Check malformed imports and missing prompt editors preserve notes. Inspect empty and populated panes on your actual terminal or app; native test trees do not prove visual layout.

## API upgrades

Read [Anthropic's mod creation guide](https://code.claude.com/docs/en/plugins/mods/create) and regenerate your installed types using `/plugin-types`. Review the declaration diff before changing the pinned official revision and checksum in `scripts/fetch-mod-types.ts`. Keep the documented baseline, source APIs, CI, and smoke-test results aligned. Never suppress incompatible API fields with `any`.

## CI

The **`Check`** job runs on every pull request (including drafts and base-branch edits), main pushes, and manual dispatch. Select exactly **`Check`**, from GitHub Actions, as the required status in branch protection. There are no path filters or job-level skip conditions that could hide this required status.

It installs the committed lockfile once, using Node 24 and an npm download cache keyed by `package-lock.json`. `npm ci --prefer-offline --no-audit --no-fund` still validates the lockfile and package integrity; it avoids unnecessary audit/funding requests and prefers cached downloads. Dependencies are freshly installed; `node_modules` and test outputs are not cached. `HUSKY=0` disables hook installation only in CI; local hooks remain active.

Named steps expose each required check:

| Step                                     | Local command          |
| ---------------------------------------- | ---------------------- |
| Oxlint                                   | `npm run lint`         |
| Oxfmt (check only, no formatting writes) | `npm run format:check` |
| Repository metadata and documentation    | `npm run validate`     |
| Verified Claude API declarations         | `npm run types:fetch`  |
| TypeScript                               | `npm run typecheck`    |
| Node tests                               | `npm test`             |
| Native plugin validation and tests       | `npm run check:native` |

After a successful install, independent checks continue if another check fails, giving useful diagnostics in one run. TypeScript requires a successful declaration fetch. No step uses `continue-on-error`: any failed required step fails `Check`, including installation or declaration retrieval. Cancellation stops remaining checks and never produces a successful result.

One runner avoids repeated setup and installation for this small suite; a matrix or parallel jobs would add overhead. New runs cancel superseded runs of the same PR. Event-specific concurrency groups keep manual and push runs separate; main runs are not interrupted mid-check. GitHub concurrency may replace pending runs with the latest pending revision.

The checks do not edit source or run an authenticated live conversation. Third-party actions remain pinned to full SHAs and updated by Dependabot. PR code executes with `contents: read`, no injected secrets, and no persisted checkout credentials. The `pull_request_target` labeler never checks out or runs PR code.

Release verification remains independent of CI, so a manual release also checks its exact main revision. It runs with a read-only token; only a separate, dependent job receives write permissions and the optional release token. That fresh runner executes the pinned Release Please action without checking out the project or installing its dependencies.
