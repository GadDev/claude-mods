# Retry Map

<img src="assets/icon.png" width="112" alt="Retry Map: a looping path with a breakout arrow" />

**Experimental 0.1.0.** Inspect repeated Bash tool failures before spending another attempt. The mod observes tool outcomes and leaves their original results and permission checks unchanged.

## Install and use

```text
/plugin marketplace add GadDev/claude-mods
/plugin install retry-map@gaddev-mods
```

Reload plugins or restart Claude Code. Run `/retry-map` to open the pane, `/retry-map show` for a text overview, and `/retry-map clear` to clear its history.

When the same agent receives the exact same error for the exact same Bash command three times, a local transcript note suggests inspecting Retry Map. The pane shows counts and status, with an **Inspect failure** button for the command and error sample. No prompt is sent to Claude, no model is called, and no tool is blocked or retried automatically. You decide whether to interrupt or redirect the work.

## Grouping rules

- Grouping uses exact command and full error fingerprints, separately for each agent. Different commands, errors, or agents create different groups. It does not infer that semantically similar failures are identical.
- A successful, non-staged `Edit`, `Write`, or `NotebookEdit` begins a new comparison period. Shell and external edits are not detected. A command overlapping an observed edit is not comparable.
- A later successful foreground Bash tool outcome closes that command's active group. This says the tool later succeeded; it does not prove tests passed or the underlying problem was fixed.
- Refused tool calls are not execution failures. Background starts and interrupted successful-tool payloads do not close a failure group. Final outcomes of background processes are not tracked in this MVP.
- At most 30 groups are retained in session memory. Displayed commands are capped at 16,000 characters, errors at 8,000. Error signatures use up to 64,000 complete characters; missing or larger evidence never forms an identical-failure group. Truncated displays are labeled, and the original tool result stays in Claude Code's ordinary history.
- Clear, session end, resume, branch, or reload removes the history. Pending observations from a previous lifecycle are ignored.

Repeated failure can be legitimate: waiting for a service, testing a changed environment, or checking an external fix. **The count is advisory, not proof of wasted tokens.** There is no dollar or token-savings counter.

## Permissions and privacy

The mod uses `command.register` and UI APIs. It watches Bash results and successful file-tool calls. It reads no filesystem paths or prompts, changes no results, and performs no subprocesses, network calls, model calls, persistent storage, or permission approvals. Commands and errors can contain sensitive data; the bounded samples stay in the session's local mod memory. The threshold note is a UI log line that Claude does not read as new context.

Observation failures use the engine's normal fallback so the original tool behavior can continue; no recovery path calls the underlying command a second time.

## Development

`npm run check` covers core grouping rules, native tool result preservation, command inspection, and pane contracts on terminal, Desktop, and VS Code. CLI 2.1.287+ is the documented baseline; native checks use 2.1.308. A live application smoke test remains useful for actual layout and keyboard behavior.
