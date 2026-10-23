# Agent Budget Board

<img src="assets/icon.png" width="128" alt="Agent Budget Board: task tiles connected to a resource dial" />

**Experimental 0.1.0.** Review a proposed delegation plan before choosing whether to start workers. Edit roles, distinct tasks, scope labels, model preferences, and requested concurrency in a native pane. The board identifies lexical overlaps and repeated assignments, suggests batches, and records local approval of the exact saved plan.

This is an advisory planning tool. It starts no workers, intercepts no agent calls, changes no models or permissions, and enforces no live concurrency, token, or billing limits. It does not observe workers started elsewhere.

## Install and plan

```text
/plugin marketplace add GadDev/claude-mods
/plugin install agent-budget-board@gaddev-mods
/reload-plugins
/agent-budget-board
```

Set the goal, add worker IDs, and give each worker a distinct task and scope. Fields save when submitted; unfinished typing is not part of the reviewed plan. Model values are authored preferences. The default `inherit` label means an intended preference for the eventual host's default; the mod does not resolve or select a real model. Model availability, pricing, and suitability are not checked.

Example commands for two distinct workers:

```text
/agent-budget-board goal Review the API change and its documentation
/agent-budget-board add api-review
/agent-budget-board set api-review role API reviewer
/agent-budget-board set api-review task Inspect API validation
/agent-budget-board set api-review scopes src/api/
/agent-budget-board add docs-review
/agent-budget-board set docs-review role Documentation reviewer
/agent-budget-board set docs-review task Check the usage examples
/agent-budget-board set docs-review scopes docs/
/agent-budget-board concurrency 2
/agent-budget-board review
```

Use `set <id> model <label>` to change a preference and `set <id> access write` to describe planned editing. Access modes are labels, not permission grants. Scope strings name exact files or directories ending in `/`; separate multiple scopes with commas. `./` explicitly means the entire workspace and produces a broad-scope warning. Hidden paths and spaces are supported as labels. No files are read or resolved.

## Review, narrow, or approve

The report shows workers, the canonical plan's SHA-256 fingerprint, suggested batches, approval blockers, and warnings. Missing goal, workers, role, task, model, or scopes block approval. Warnings include:

- Shared read scopes, which may repeat context gathering.
- Overlap involving planned writing, which needs coordination.
- Repeated role labels or identical task text after case/whitespace normalization.
- Workspace-wide scopes and internally overlapping scopes in one worker.

Scope comparison is lexical and case-sensitive. Directory prefixes respect `/` boundaries, so `src/api/` overlaps `src/api/auth.ts` but not `src/apix.ts`. A file label and directory label with the same base, such as `src/api` and `src/api/`, conservatively overlap. Globs, commas inside paths, traversal, absolute paths, and Windows separators are rejected. There is no glob expansion, filesystem inspection, symlink resolution, semantic task analysis, or dependency scheduling. No warning does not prove independence.

Suggested batches follow saved worker order, with at most the requested concurrency per batch. They are a planning aid, not a scheduler. Warnings distinguish same-batch from different-batch overlap; sequential batches can still repeat work or require coordination. To narrow a plan:

```text
/agent-budget-board set api-review scopes src/api/auth.ts
/agent-budget-board set api-review task Inspect only authentication validation
/agent-budget-board concurrency 1
/agent-budget-board remove docs-review
/agent-budget-board review
```

Read all report pages; use `page 5000` or the pane's offset field when the footer shows more content. Then use `approve` for a complete warning-free plan. If warnings remain intentional, use `approve acknowledge` or the explicitly labeled acknowledgment button. Acknowledgment bypasses no completeness blocker.

Every saved edit, removal, concurrency change, clear, or JSON load invalidates review and approval, even when the new text is identical. Invalid inputs preserve the previous saved plan. Re-reviewing an unchanged plan preserves its approval. The approval covers only the saved data, not unsubmitted field text, a repository revision, a verified model, or actual agent behavior.

## Use the reviewed plan

```text
/agent-budget-board approve
/agent-budget-board draft
```

`draft` is available only after local approval. It appends the reviewed advisory plan to the current prompt draft, leaves existing text intact, and does not submit. Read it before sending; any subsequent delegation uses your normal host workflow and permissions. If no editor is available, export and copy the plan instead. The handoff is capped at 16,000 characters and is refused rather than silently truncated; narrow an oversized plan. Changes made after insertion do not retract already inserted text.

`export` displays the complete version 1 JSON for manual saving/copying, with no approval credential or status. The command prints a short message before the JSON; copy only the JSON object. `load <json>` or the pane's pasted-JSON field imports authored data and always resets approval. It reads no local or remote file. Unknown fields, versions, duplicate IDs/scopes, malformed data, and execution/configuration fields are rejected. Invalid replacement imports preserve existing saved work. No JSON text is executed. Export before leaving if you need the plan; all state clears at session end.

## Bounds and compatibility

- At most eight workers, each with a lowercase ID of 1–24 letters/digits/hyphens, starting with a letter.
- Goal: 1,000 characters; role: 80; distinct task: 400; model preference: 120.
- At most six scopes per worker, 240 characters per scope.
- Requested concurrency: an integer from 1 to 8. Actual runtime concurrency is not measured or limited.
- JSON: at most 32 KiB in UTF-8. Review pages: at most 5,000 report characters plus an offset footer; all warnings remain available through paging.

Empty, edited, reviewed, and approved pane contracts are tested on terminal, Desktop, and VS Code, including field edits, access selection, and approval buttons. This is a Claude Code plugin, not a claude.ai browser integration. It registers no model-facing tool, makes no model/network calls, accesses no filesystem or conversation history, and writes no files. Native tests do not replace a manual visual smoke test. Human plans can still contain private information; review before sharing. Any reduction in redundant work or token use remains unmeasured.
