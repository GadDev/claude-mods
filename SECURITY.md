# Security

Only the latest experimental version is maintained. This project has not received an independent security audit.

## Reporting

Use [GitHub private vulnerability reporting](https://github.com/GadDev/claude-mods/security/advisories/new) when enabled. If unavailable, open an issue asking for a private reporting channel without including exploit details or sensitive data. Do not put secrets, private repository code, or session transcripts in public reports.

## Current permissions

Context Studio reads only source ranges you explicitly select and re-reads their files for freshness. It uses filesystem metadata to resolve the current working directory and reject files resolving outside it. Source selections and task text stay in session memory until a lifecycle reset or reload. The mod appends to the prompt editor only after an explicit user action. It performs no file writes, subprocess launches, HTTP requests, telemetry, model calls, or permission approvals.

Appending is not sending. When you send the draft, its source excerpts go to your configured model provider and may be retained in normal Claude Code history. File policies reject hidden paths and some obvious secret filenames, but cannot detect all secrets in ordinary source files. Review selected text before sending.

File resolution and reads are separate filesystem operations. This prototype is not a sandbox against hostile local processes swapping symlinks or files during a read. Do not use it to inspect an actively hostile workspace. A saved draft is not continuously monitored; regenerate it after edits.

Claude Code mods run with your account's permissions. Inspect any mod before installing it; our narrower behavior is an implementation choice, not an engine sandbox.
