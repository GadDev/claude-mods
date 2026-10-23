# Output Lens

<img src="assets/icon.png" width="112" alt="Output Lens: a magnifying lens revealing useful diagnostic lines" />

**Experimental 0.1.0.** Inspect a local Vitest JSON report and give Claude compact diagnostics, with the original report available on demand. No background model calls and no automatic test execution.

## Install

```text
/plugin marketplace add GadDev/claude-mods
/plugin install output-lens@gaddev-mods
```

Reload plugins or restart. CLI 2.1.287+ is the documented baseline; native checks use 2.1.308. The pane uses standard terminal, Desktop, and VS Code elements.

## Use

Generate a report using your existing Vitest installation. This command executes your project's tests under your normal permissions; the mod does not run it for you:

```sh
npx vitest run --reporter=json --outputFile=vitest-results.json
```

Inspect the process exit code and terminal warnings separately, even when a JSON report was written. In Claude Code:

```text
/output-lens load vitest-results.json
/output-lens
```

The pane shows report counts, failure diagnostics, source fingerprint, and raw/summary character sizes. Its selector opens individual diagnostics; raw pages expose the original JSON. The full report remains at the source path. Creating a new report at that path requires loading it again.

After loading, ask Claude to **use the Output Lens report tool to inspect failures**. The tool `mcp__output-lens__report` returns only the requested view:

| Input | Returned evidence |
| --- | --- |
| `{ "view": "summary" }` | Counts, reported outcome, warnings, and up to eight bounded diagnostic previews |
| `{ "view": "failure", "index": 2, "offset": 0 }` | One diagnostic, up to 5,000 characters; index is 1-based |
| `{ "view": "raw", "offset": 5000 }` | Up to 5,000 original JSON characters, with the next offset |

The tool only reads the report explicitly selected by the user. It cannot choose another file, run tests, or change your code. Tool responses enter normal model context; opening and browsing the pane do not make model requests.

## Commands

| Command | Action |
| --- | --- |
| `/output-lens` | Open the pane |
| `/output-lens load <path.json>` | Load and validate a report |
| `/output-lens summary` | Reverify the file and print its bounded summary |
| `/output-lens failure <index> [offset]` | Page through one diagnostic |
| `/output-lens raw [offset]` | Page through the original JSON |
| `/output-lens clear` | Remove the selected report from session memory |

## What the status means

**Reported passed** means this JSON has consistent passing-test evidence. It does not establish a successful process exit, absence of unhandled errors outside the report, or that the current source code was tested. **Reported failed** preserves failure evidence, including suite crashes and snapshot failures. Incomplete counts or unsupported unfinished statuses remain **Unknown**. Empty or entirely skipped/todo runs are **No tests**, not passing verification.

The complete selected report is fingerprinted again before each tool response or explicit detail request. This verifies report-file integrity, not source-code freshness. Session lifecycle changes and working-directory changes invalidate the selection. A malformed replacement clears the previous report rather than silently reusing old evidence.

## Boundaries and measurement

- Supported format: Vitest's Jest-compatible JSON reporter; exercised against a real Vitest 5.0.5 mixed-result run.
- Maximum file size: 2 MiB. Select smaller reports without large coverage payloads if needed.
- Paths must be relative JSON files inside the working directory. Spaces and `.vitest/json/output.json` are supported; outward symlinks, other hidden paths, and obvious secret filenames are excluded.
- Summaries preserve failure previews and explicitly label omissions. Full diagnostics and metadata remain available through paging. The JSON is not a substitute for full stdout/stderr logs, process status, or crash diagnostics that were never written to it.
- The pane compares character counts, not billed tokens or subscription allowance. No savings percentage has been established.

Current Vitest already provides a [minimal/agent reporter](https://vitest.dev/guide/reporters.html#minimal-reporter) optimized for AI assistants, and recent versions select it automatically in agent environments. Use that built-in reporter if concise terminal output is all you need. Output Lens adds structured inspection, report provenance, and bounded diagnostic retrieval. Compare total usage and debugging success against the built-in reporter before claiming a benefit.

## Permissions and development

Runtime calls: `session.cwd`, `fs.stat`, `fs.read`, `command.register`, `tool.register`, `ui.open`, `ui.resolve`, and `ui.invalidate`. No subprocesses, network calls, model calls, source writes, or permission changes. Report content may contain paths, secrets, and test data; review it before exposing details to Claude. File checks are not a sandbox against hostile local processes racing filesystem operations.

From the repository root run `npm run check`. Native tests cover the registered tool, changed-report rejection, and valid UI trees across three surfaces. [Architecture](../../docs/architecture.md), [measurement](../../docs/measurement.md), and [security](../../SECURITY.md) describe collection-wide expectations.
