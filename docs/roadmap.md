# Roadmap

Only Context Studio is implemented. This roadmap is a sequence of hypotheses to validate, not a promise to ship every mod.

| Mod | User action | Next useful milestone |
| --- | --- | --- |
| Context Studio | Select source excerpts and prepare a reviewed task packet | Native CLI validation, surface smoke tests, then paired usage trials |
| Output Lens | Expand a concise test result into complete diagnostics | Vitest parser preserving exit status, crashes, and full local evidence |
| Retry Map | Inspect repeated failures and what changed between attempts | Exact command/error signatures with advisory warnings |
| Instruction Workbench | Review instruction duplication and scope | Read-only audit with source references and proposed edits |
| Task Capsules | Prepare a small handoff for a separate task | Explicit save/load with reviewed decisions and source freshness |
| Agent Budget Board | Review worker scope and resource choices | Advisory agent-start preview without automatic model changes |
| Symbol Navigator | Select definitions and references precisely | TypeScript symbol index with provenance and bounded retrieval |

## Context Studio progression

1. **Prototype:** source ranges, metadata, conservative freshness checks, native pane, and explicit draft preparation.
2. **Validate:** native engine checks, terminal/desktop/VS Code usability, failure-mode testing, and measured task comparisons.
3. **Improve selection:** source discovery or symbols only if manual selection proves useful.
4. **Browser companion:** explicit packet import/export first; design a live bridge separately if needed.

Shared packages appear when a second implementation needs them. Planned mods stay out of the marketplace until independently usable and documented.
