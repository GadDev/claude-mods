# Instruction Workbench

<img src="assets/icon.png" width="128" alt="Instruction Workbench: instruction cards on a drafting workbench" />

**Experimental 0.1.0.** A local review pane for explicitly selected instruction sources. Inspect source locations, character counts, fingerprints, and exact repeated guidance with line references. Nothing is edited or sent to a model automatically.

## Install

```text
/plugin marketplace add GadDev/claude-mods
/plugin install instruction-workbench@gaddev-mods
/reload-plugins
/instruction-workbench
```

Use the pane to add a relative path, then choose **Verify sources and audit duplicates**. Opening or rendering the pane does not read source files. Native element contracts are tested on terminal, Desktop, and VS Code; see repository compatibility guidance for engine requirements. This is not a claude.ai browser integration.

## Commands

```text
/instruction-workbench add CLAUDE.md
/instruction-workbench add src/CLAUDE.md
/instruction-workbench add .claude/rules/testing.md
/instruction-workbench audit
/instruction-workbench page 5000
/instruction-workbench remove 2
/instruction-workbench clear
```

Paths may contain spaces. Select `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, or Markdown files under a `.claude/rules/` directory. All paths resolve inside the current working directory. Other hidden paths, traversal, binary content, outward symlinks, and duplicate physical sources are rejected. Files are limited to 64 KiB each, 12 selections, and 256 KiB total. Sources and reports live in memory and clear with the session.

`audit` and `page` re-read every selected source, verify its complete SHA-256 fingerprint and resolved location, and reject stale evidence, even if modification times are unchanged. Source changes, deletion, or workspace changes clear the selection. This is best-effort stat/read/stat verification, not an atomic filesystem snapshot. `add` and `remove` invalidate the old report. Pages contain at most 5,000 report characters plus an offset footer; use the next offset in the pane or command to continue.

## What the audit means

- Duplicate groups match whole trimmed lines with whitespace collapsed, while retaining case, punctuation, and bullet structure. Candidate lines are 32–1,000 characters long.
- Fenced code, recognized YAML frontmatter, comment-bearing lines, headings, tables, quotes, and short boilerplate are excluded. This conservative scanner is not a complete Markdown parser; indented code and complex markup may still produce candidates requiring review.
- Findings include original file/line references. Same-file repetitions receive a consolidation review proposal. Cross-file repetitions explicitly require scope comparison: identical wording in different locations can be intentional.
- Reports show up to 20 duplicate groups and 12 occurrences per group, with omitted counts. A small page may not contain all findings; pagination is explicit.
- Scope labels describe directory location or the presence of a `paths` frontmatter key. They do not evaluate glob patterns or prove that an instruction is loaded.

There is no recursive discovery, import expansion, home/ancestor/managed-file access, settings inspection, semantic contradiction detection, tool registration, automatic prompt modification, file editing, or model call. The audit covers only sources the user selects. It cannot show the engine's complete instruction set. Use Claude's `/context` or `/memory` to inspect actual loading.

## Alongside Claude's built-in audit

Claude already offers [`/doctor prompt-audit`](https://code.claude.com/docs/en/memory#audit-your-instruction-files) for a model-assisted review of outdated or conflicting instructions. Instruction Workbench provides deterministic, bounded, selected-file evidence in a local pane; it does not replace that audit.

Moving task-specific procedures into [skills](https://code.claude.com/docs/en/skills) may reduce always-loaded guidance, but requires a separate human decision. Keep safety and project invariants where they are needed. Merely importing a separate instruction file organizes text without reducing what is loaded. This mod creates no skill files and applies no suggested changes. Source character counts are not loaded-context measurements or proven token savings.
