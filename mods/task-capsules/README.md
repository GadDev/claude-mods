# Task Capsules

<img src="assets/icon.png" width="128" alt="Task Capsules: a compact capsule holding a task card" />

**Experimental 0.1.0.** Prepare one small, human-edited handoff for a separate task or fresh session: a goal, decisions, relative file references, and unresolved checks. Export portable JSON explicitly, then import and review it in the intended project. No conversation is captured or summarized automatically.

## Install and build a capsule

```text
/plugin marketplace add GadDev/claude-mods
/plugin install task-capsules@gaddev-mods
/reload-plugins
/task-capsules
```

Use the pane to edit the goal, add or edit decisions and unresolved checks, and capture file text fingerprints. File reference cards show the last explicit review status in words. Opening or rendering the pane performs no file reads. Goal and item edits are committed when you submit the field; unfinished typing is not exported.

The command equivalents are:

```text
/task-capsules goal Finish authentication cleanup
/task-capsules decision Keep the existing public API
/task-capsules check Run the authentication tests
/task-capsules file src/auth.ts
/task-capsules preview
```

`goal` edits the existing goal while retaining the other fields. To start an unrelated capsule, export the current one first, then use `clear`. This MVP holds one active capsule per session; separate JSON files organize separate tasks.

## Carry it to a fresh session

1. Choose **Verify files and preview handoff**. Review authored notes and the reference statuses.
2. Choose **Export JSON for saving**, or run `/task-capsules export`.
3. Copy the complete JSON body to a local file such as `handoffs/auth-cleanup.capsule.json`. The command includes an explanatory message before the JSON; copy only the JSON object. The pane shows a complete JSON code block. **The mod does not write this file or autosave.**
4. Start a fresh Claude Code session in the intended project with the mod installed.
5. Import and review:

```text
/task-capsules import handoffs/auth-cleanup.capsule.json
/task-capsules preview
/task-capsules draft
```

Import explicitly replaces the current capsule only after validation succeeds. Malformed imports retain previous authored work. Import reads the selected JSON file, not its referenced sources. Every imported reference starts unverified, regardless of what a previous session checked.

`draft` verifies all file references again and appends the handoff to the **current prompt draft**. It leaves existing draft text intact and does not submit a message or launch a session. Read the draft before sending it. If the host has no prompt editor, use preview and copy the handoff. Source files can change after verification; regenerate the handoff if needed. Already inserted text is ordinary draft content and is not retracted automatically.

## Stale references and unresolved work

| Status              | Meaning                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `unverified`        | No explicit review since import or editing                                                                                          |
| `matching`          | Decoded file text matches the recorded SHA-256 fingerprint at review time                                                           |
| `changed`           | Current decoded text has a different fingerprint                                                                                    |
| `unavailable`       | The source is missing, unreadable, binary, oversized, outside the workspace, changing during a read, or the root cannot be resolved |
| `workspace-changed` | The working directory differs from the one this session's capsule was bound to                                                      |

Changed/unavailable/workspace-changed references block draft insertion and preserve the capsule's authored data. Review the source, then explicitly capture its current version or remove the reference:

```text
/task-capsules refresh 1
/task-capsules remove file 1
/task-capsules edit decision 1 Preserve the API contract
/task-capsules edit check 1 Run the focused authentication tests
/task-capsules remove decision 1
/task-capsules remove check 1
```

Import again in the intended project after changing workspaces. Relative paths and matching hashes do not prove repository identity, commit provenance, correctness, or trust. An imported hash is authored data, not a signature. Source hashes compare decoded text, not arbitrary binary file bytes. Verification uses best-effort stat/read/stat checks, not an atomic filesystem snapshot.

Export remains available with stale references so unresolved work can be carried forward. It retains the original hashes, reports how many references need review, and does not persist freshness statuses. No automatic refresh hides source changes. **All checklist entries remain unresolved and unverified by the mod.** It runs no commands or tests and never marks an authored claim as a verified result.

## JSON contract and bounds

The version 1 format has exactly these fields:

```json
{
  "kind": "gaddev.task-capsule",
  "schemaVersion": 1,
  "goal": "Finish authentication cleanup",
  "decisions": ["Keep the existing public API"],
  "files": [],
  "checks": ["Run the authentication tests"]
}
```

File entries have exactly `path` and `sha256` fields. Prefer capturing them with the mod; manually changing a fingerprint can hide a change from the comparison. Unknown fields and versions, invalid hashes, duplicate paths, and malformed data are rejected. JSON import is data parsing only; notes and paths are never executed.

- Goal: 1,000 characters; up to eight decisions and eight checks, 400 characters each.
- Up to eight file references; relative paths at most 240 characters; ordinary spaces are supported.
- Source text: at most 256 KiB per file. Source content is read only on explicit capture, refresh, preview, export, or draft; it is not stored in the capsule.
- JSON import/export: at most 32 KiB in UTF-8. The entire JSON is shown; no silent truncation or pagination can create an incomplete export.
- Hidden paths, traversal, absolute/Windows paths, outward symlinks, binary data, and obvious secret filenames are excluded. JSON capsule files must end in `.json` and be inside the current working directory.

Human-written notes and paths may still contain private information. Review before saving, committing, or sharing; this is not a secret scanner. All in-memory data clears at session end. Nothing is saved unless you copy the export yourself.

Native empty and populated panes are tested on terminal, Desktop, and VS Code, including item editing. This is a Claude Code plugin, not a claude.ai browser integration. It registers no model-facing tool, reads no conversation history, makes no model/network calls, writes no files, and starts no agents or sessions. A shorter handoff may be useful, but token savings remain unmeasured.
