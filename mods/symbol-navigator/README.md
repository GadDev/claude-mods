# Symbol Navigator

<img src="assets/icon.png" width="128" alt="Symbol Navigator: code braces around a compass" />

**Experimental workflow.** Search a local TypeScript symbol index, distinguish definitions by location, and retrieve a definition plus selected identifier references. Every retrieval rechecks recorded input hashes. Source packets are bounded and inserted only through an explicit append action.

## First run: use the demo

From a checkout of GadDev/claude-mods with Node 24+:

```sh
npm ci
npm run symbols:demo
```

Follow the printed launch commands. Setup creates a fresh temporary TypeScript project and a generated index; it does not start Claude or edit the committed demo. Load `symbol-index.json`, search `quoteTotal`, choose `src/pricing.ts`, select a checkout reference, and preview. The [guided test drive](../../examples/symbol-navigator/README.md) includes expected results and a deliberate stale-source/rebuild exercise. `npm run symbols:demo -- --check` rehearses it without Claude or model calls and cleans up its temporary copy.

In the pane, **Quick start and demo instructions** (or `/symbol-navigator help`) shows the setup steps without reading files. Use Previous/Next buttons for matches, references, and packet pages. A new search clears the previous definition/reference selection so a draft cannot accidentally use the old result. Draft insertion remains an explicit append action.

## Generate an index

Generation is a separate, explicit Node operation from a checkout of this repository. It does not run inside Claude Code's mod sandbox. Use Node 24+, install this repository's committed dependencies, and select a project's tsconfig:

```sh
npm ci
npm run symbols:index -- --project /absolute/project/tsconfig.json --output /absolute/project/symbol-index.json
```

The **directory containing the selected tsconfig is the workspace root**. Start Claude Code in that directory. Use a root-level standalone config if its sources span subdirectories. The output parent must already exist inside this directory. The generator creates a new JSON file with exclusive creation and mode `0600`; it refuses to overwrite existing files or project inputs. To rebuild, explicitly remove the previous generated index or choose a new filename. Keep generated indexes local and out of version control: they contain project paths and symbol names, even though they contain no source text.

The tool reads tsconfig JSON (including local `extends`), resolves imports and path aliases through a pinned **TypeScript 6.0.3 compiler API**, and records named identifier declarations and their resolved identifier references. Renamed imports/re-exports follow their local target symbol; shorthand object values are connected to the underlying variable. Distinct same-name symbols retain separate IDs and definition locations. IDs are deterministic for unchanged inputs but may change on rebuild.

Repository checks continue using TypeScript 7. The older API is an isolated development dependency named `typescript-compiler-api`; it is not installed or loaded by the native reader. Projects must pass this compiler's diagnostics. TypeScript 7-only syntax/options need a future compiler adapter; do not assume this tool matches your editor's language service exactly.

Generation emits no JavaScript, executes no project modules, tsconfig plugins, npm scripts, commands, or model calls. Only the explicitly chosen JSON output is written. This tool is not an isolation boundary for hostile projects; it uses TypeScript's filesystem resolution and reads dependency declarations for analysis.

## Install and retrieve

```text
/plugin marketplace add GadDev/claude-mods
/plugin install symbol-navigator@gaddev-mods
/reload-plugins
/symbol-navigator load symbol-index.json
/symbol-navigator find createSession
```

Choose the ID matching the definition location in your actual search results. The IDs and reference numbers below are examples, not fixed demo IDs:

```text
/symbol-navigator show s12
/symbol-navigator select 2
/symbol-navigator select 5
/symbol-navigator preview
/symbol-navigator draft
```

Open `/symbol-navigator` for the native pane. It provides index loading, search results, definition locations, reference toggles, pagination, and preview/draft controls. Definition source is included in the packet; only explicitly selected reference excerpts are added. `select` toggles the numbered reference. Choosing another symbol resets reference selection. Fields take effect on submission.

| Command               | Behavior                                                                        |
| --------------------- | ------------------------------------------------------------------------------- |
| `help`                | Show first-run instructions without reading files                               |
| `load <path.json>`    | Validate the selected index; read no referenced source yet                      |
| `find <name>`         | Case-insensitive substring search, eight results at a time                      |
| `results <offset>`    | Search page using a zero-based row offset                                       |
| `show <id>`           | Choose a definition and list reference locations                                |
| `references <offset>` | Reference page using a zero-based row offset                                    |
| `select <number>`     | Toggle a one-based reference number, up to eight                                |
| `preview`             | Verify and retrieve a complete bounded packet                                   |
| `page <offset>`       | Rebuild/verify the packet and retrieve 4000 characters from a zero-based offset |
| `draft`               | Verify again and append to the existing prompt draft; never send                |
| `clear`               | Forget the index and all selections                                             |

Command replies provide the complete packet up to its limit. Each pane packet page contains up to 4000 source-packet characters, with the page range shown separately so headers cannot hide source text. Previous/Next controls reverify inputs on every page. Numeric offset commands remain available for direct navigation. Search/reference report previews are bounded; their complete location lists are accessible through the paged controls. Missing editors leave the selection available for preview and copying. Session lifecycle events clear memory. No discovery, indexing, reads, writes, model calls, tool registration, or agent starts occur during rendering. The native reader makes no filesystem writes at all.

## Freshness and provenance

Before search, results, symbol/reference selection, packet pages, or draft insertion, the mod verifies the loaded index file and **every recorded local source/config input**. It checks workspace containment, excluded resolved targets, regular-file size, read races, and full decoded-text SHA-256 hashes. A mismatch, missing file, changed workspace, or unsafe link clears the index and selections. Rebuild and reload; stale locations are never silently refreshed. Invalid replacement JSON preserves the prior selection, which still must pass verification before use.

This is point-in-time evidence that recorded text matches, **not proof of a complete or trusted graph**. New files matching an unchanged glob, changed external/dependency declarations, package files outside the selected root, and editor/compiler-version differences are not continuously observed. Rebuild after file additions/deletions, dependency installs, or compiler upgrades. Local tsconfig and read package metadata are hashed; root package/lock files are recorded when present. No absolute workspace path, source text, approval, or execution state is exported. A manually authored index can contain incorrect locations: hashes do not authenticate its author or semantic claims.

Packets identify paths, source lines/columns, and whole-file hashes. Definitions longer than 60 lines show an explicitly labeled first-60-line excerpt; each selected reference includes its line and one context line on either side. Reference matches cover resolved identifiers, including import/export identifiers; they are not a complete call graph, rename engine, editor reference search, or dynamic/string-property analysis. Source control characters are stripped from display and source fences are escaped structurally. Review source yourself before sending: ordinary code can contain secrets or misleading text.

## Supported scope and limits

- One standalone tsconfig; **project references are rejected**, as are config inheritance/application imports outside its directory and package-based `extends` through excluded dependency paths.
- TS, TSX, MTS, CTS, and local declaration files; JavaScript projects are unsupported. Configured `outDir`/`exclude` follow TypeScript selection, but an imported excluded file still enters the program and is checked. Hidden paths, `node_modules`, `dist`, `coverage`, obvious secret paths, traversal, and outward symlinks cannot become indexed sources. Other generated files are included if the selected config/imports include them; review your config.
- 96 recorded inputs, 256 KiB per input, 8 MiB total; 2000 symbols, eight declarations and 200 references per symbol, 20,000 locations total; 2 MiB JSON. Generation fails instead of silently truncating the index.
- Compiler dependency reads: at most 512 reads, 8 MiB per file, 32 MiB combined; AST traversal at most 500,000 nodes. These are size/work bounds, not a wall-clock or memory guarantee.
- Eight selected references; packets at most 16,000 characters. Oversized packets fail without inserting partial source. Search/reference lists are paged, not truncated permanently.

Node tests cover actual tsconfig resolution, aliases, same-name definitions, CLI generation plus reader retrieval, refusal cases, strict JSON, source/config/index freshness, filesystem boundaries, selection, and packet limits. Native testing-kit tests exercise commands and actual pane controls on terminal, desktop, and VS Code. The runnable demo also rehearses indexing, selection, stale refusal, and rebuild/reload on real temporary files. A live interactive visual smoke test and measured context savings remain unverified. See [development](../../docs/development.md).

Compiler references: [official compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) and [project references](https://www.typescriptlang.org/docs/handbook/project-references), checked 23 October 2026.
