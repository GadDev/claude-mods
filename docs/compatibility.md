# Compatibility and troubleshooting

Documentation verified against official Anthropic pages on **22 October 2026**. Native marketplace/plugin validation and testing-kit checks pass on **2.1.308**. Test your own installed build before treating this prototype as production-ready.

| Surface | Expectation |
| --- | --- |
| CLI terminal, 2.1.287+ | Native pane and commands; primary target |
| Claude Desktop Code tab | Native elements when its bundled engine supports mods; needs local smoke testing |
| VS Code extension, 2.1.299+ | Standard pane elements, with some styling props ignored; needs local smoke testing |
| Remote Control | Mod drawing stays in the terminal on your machine |
| Cloud sessions | Hooks may run if installed; native mod drawings do not appear |
| Headless / Agent SDK | Text command replies; no interactive pane or draft editor |

Source: [where mods run](https://code.claude.com/docs/en/plugins/mods/overview#where-mods-run) and [elements by surface](https://code.claude.com/docs/en/plugins/mods/reference). The documented minimum is not a record of a successful live smoke test. Current test evidence is recorded in PRs and releases.

## Nothing appears

Check `claude --version`, `/plugin`, and `/reload-plugins`. Mods may be blocked by organization policy, `--safe-mode`, or disabled hooks. Run `claude plugin validate ./mods/context-studio` from a checkout and inspect the engine's reported API or drawing errors. Narrow terminals may place the pane above the prompt.

## Source rejected

Use a relative path with forward slashes and an inclusive line range. Hidden paths, unsupported extensions, ranges over 200 lines, files over 256 KiB, and sources resolving outside the working directory are rejected. Source files can still contain secrets: inspect them yourself.

## Stale excerpt

Remove it and add the current range. Any full-file content change invalidates a snapshot, even outside the selected lines. Drafts already inserted are not automatically refreshed.

## Draft editor unavailable

Use `/context-studio preview` and copy the text manually. The mod never silently submits a prompt as a fallback.

## Token count seems inaccurate

The pane uses a character heuristic. Code, Unicode, paths, and formatting tokenize differently. Use provider-reported usage for experiments; the estimate is useful only for comparing packet sizes.
