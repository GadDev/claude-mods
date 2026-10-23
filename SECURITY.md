# Security

Only the latest experimental version is maintained. This project has not received an independent security audit.

## Reporting

Use [GitHub private vulnerability reporting](https://github.com/GadDev/claude-mods/security/advisories/new) when enabled. If unavailable, open an issue asking for a private reporting channel without including exploit details or sensitive data. Do not put secrets, private repository code, or session transcripts in public reports.

## Current permissions

Context Studio reads only source ranges you explicitly select and re-reads their files for freshness. It uses filesystem metadata to resolve the current working directory and reject files resolving outside it. Source selections and task text stay in session memory until a lifecycle reset or reload. The mod appends to the prompt editor only after an explicit user action. It performs no file writes, subprocess launches, HTTP requests, telemetry, model calls, or permission approvals.

Appending is not sending. When you send the draft, its source excerpts go to your configured model provider and may be retained in normal Claude Code history. File policies reject hidden paths and some obvious secret filenames, but cannot detect all secrets in ordinary source files. Review selected text before sending.

File resolution and reads are separate filesystem operations. This prototype is not a sandbox against hostile local processes swapping symlinks or files during a read. Do not use it to inspect an actively hostile workspace. A saved draft is not continuously monitored; regenerate it after edits.

Claude Code mods run with your account's permissions. Inspect any mod before installing it; our narrower behavior is an implementation choice, not an engine sandbox.

## Other mods

Output Lens reads a user-selected local JSON report and exposes bounded report views through a registered tool. Revalidation checks report integrity, not whether current source files were tested. It neither executes tests nor observes the runner's exit code, stdout, or stderr. Source reports remain local until requested content enters model context. Paths and diagnostics can contain sensitive data; inspect them before sharing.

Retry Map observes Bash errors and successful file-tool calls. It retains bounded command/error samples in session memory, displays them on request, and writes one local UI note when a repeat threshold is reached. It does not read files, intercept prompts, change tool results, retry commands, approve tools, persist history, or make model/network calls. Repetition is advisory: external and shell-driven changes may not be visible to it.

Instruction Workbench reads only explicitly selected project instruction paths (including private `CLAUDE.local.md` when selected). It retains their text in memory until cleared or session end, and returns bounded audit evidence on explicit commands. Review its output before sharing; instruction text may contain private information. Directory scope is inferred from location, not verified against settings or actual loading. It does not follow imports, access ancestor/user/managed instructions, create skills, apply edits, or modify prompts. Files can change after verification; fingerprints are point-in-time evidence, not a filesystem lock.
