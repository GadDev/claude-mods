# Review: task-capsules 0.1.0 — 2026-10-23

## Scope
Reviewed commit `b404cd3 feat(task-capsules): add reviewed portable task handoffs (#13)`. Files examined:
- `mods/task-capsules/src/capsule.ts`
- `mods/task-capsules/hooks/register.ts`
- `mods/task-capsules/README.md`
- `mods/task-capsules/tests/task-capsules.test.ts`

## Summary
No critical bugs found. Implementation follows existing patterns for mods: TypeScript ESM, no Node/DOM APIs, self-contained plugin, explicit user actions only.

## Observations

### Correctness
- `parseCapsule` validates shape, limits, path safety, duplicate paths, SHA-256 format. `serialize` re-validates via `parseCapsule`.
- `read` performs before/after stat to detect races and verifies `realPath` stays under workspace root. Rejects binary, oversized, and changed-while-reading.
- `inspect` correctly distinguishes `matching`, `changed`, `unavailable`, `workspace-changed`. Root is resolved once per inspect; missing root leaves references `unavailable`.
- `draft` blocks insertion when any reference is not `matching`, preserving authored data.
- Path validation rejects absolute paths, control chars, traversal, hidden parts, and obvious secret filenames. Regex is safe for simple paths.

### Structure / Conventions
- Limits are centralized in `LIMITS`. Validation functions `text`, `validatePath`, `list` are reused.
- `Capsules` class clears review on mutation, avoids stale state.
- Queueing via `state.queue` in `register.ts` serialises commands; errors are caught and reported without swallowing authored content.
- UI rendering only mounts for supported surfaces and uses stable keys.

### Potential improvements / notes
- `Capsules.file` asserts workspace then reads, then checks `this.root !== source.root`. The second check is redundant given `assertWorkspace` and `read`’s root validation, but harmless.
- `inspect` computes `root` once; if `rootOf` succeeds but workspace changes mid-loop, status will be based on the initial root. Realistic race is low; current behaviour is acceptable for point-in-time review.
- `validatePath` rejects any path segment starting with `.`, which also blocks legitimate names like `.hiddenish`. Documented as intentional for safety.
- No measurement of token savings; README correctly states savings are unmeasured.

## Test coverage
Existing tests cover export/import round-trip, draft blocking on change, preview status, pane rendering on terminal/desktop/vscode, malformed import retention, and missing prompt editor fallback. No failures observed in review.

## Severity
No bugs raised. No changes required.
