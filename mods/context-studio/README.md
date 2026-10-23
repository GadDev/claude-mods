# Context Studio

<img src="assets/icon.png" width="112" alt="Context Studio: an open folio gathering selected source tabs" />

**Version 1.0.0.** A small task-packet builder for Claude Code. Select exact source ranges, inspect the result, and append it to a prompt draft for human review.

## Install

```text
/plugin marketplace add GadDev/claude-mods
/plugin install context-studio@gaddev-mods
```

Reload plugins or restart Claude Code, then run `/context-studio`. CLI 2.1.287+ is the baseline. See [surface compatibility](../../docs/compatibility.md).

## Use the pane

Set a task such as **Explain how category pagination should preserve French labels**. Add ranges in `path:start-end` form, for example `src/pagination.ts:1-25`. Press Enter in either field to commit its value. Remove unneeded sources, choose **Verify and preview**, then **Append verified packet to draft**. The action appends to your existing draft; it does not overwrite or send it. Press Enter yourself after reviewing it.

Each excerpt carries its path, 1-based line range, and a SHA-256 fingerprint of the complete source file. Preview and draft preparation re-read sources. Missing files, changed content, or changed resolved paths refuse the operation rather than returning a partial packet. Remove a stale excerpt and add its current line range again.

The pane shows a character count and a **rough characters ÷ 4 token estimate** for the complete packet, including headers. This is not Claude tokenization, billed usage, or measured savings.

## Commands

| Command                                          | Action                                            |
| ------------------------------------------------ | ------------------------------------------------- |
| `/context-studio`                                | Open the pane                                     |
| `/context-studio goal Fix pagination boundaries` | Set the task                                      |
| `/context-studio add src/pagination.ts:1-25`     | Add a source excerpt                              |
| `/context-studio remove 1`                       | Remove the first excerpt                          |
| `/context-studio preview`                        | Verify sources and print the packet               |
| `/context-studio draft`                          | Verify and append the packet to the prompt editor |
| `/context-studio clear`                          | Clear task and excerpts                           |

Paths may contain spaces. They must be relative to the current working directory, use forward slashes, and name supported text files. Ranges are inclusive. Empty files cannot provide an excerpt.

## Limits and behavior

- At most 12 excerpts, 200 lines per excerpt, 256 KiB per file, and 24,000 characters per packet.
- Hidden paths, parent traversal, absolute paths, binary files, and obvious secret filenames are excluded. This is not comprehensive secret detection.
- Files resolving outside the working directory are rejected, including outward symlinks.
- Whole-file hashes are conservative: a change outside the selected range also makes the excerpt stale.
- Source selection remains in session memory; clear, resume, branch, session end, or reload removes it. Changing working directories clears the packet on the next action.
- Snapshots are verified when preparing a preview or draft. Edits after insertion do not automatically update the draft. Remove the old packet and regenerate it before sending.
- Existing Claude instructions stay in force through the ordinary session. The packet neither collects every instruction file nor proves the model followed them.

## Permissions and scope

The runtime uses `session.cwd`, `fs.stat`, `fs.read`, `command.register`, `ui.resolve`, `ui.open`, `ui.invalidate`, and `prompt.fill`. It makes no model calls, HTTP requests, file writes, subprocesses, or tool approvals. Sending the prepared prompt has ordinary model usage and data-handling consequences.

This first version has no automatic file discovery, symbol graph, persistent packet storage, browser companion, or background monitoring. Those are future possibilities, not installed features.

## Development

From the repository root, run `npm ci`, `npm run types:fetch`, and `npm run check`. Try `claude --plugin-dir ./mods/context-studio`, then validate with `claude plugin validate ./mods/context-studio`. See [testing](../../docs/development.md) and [measurement](../../docs/measurement.md).
