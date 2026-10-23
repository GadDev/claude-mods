# Roadmap

Context Studio, Output Lens, Retry Map, and Instruction Workbench have working implementations. Instruction Workbench is an experimental selected-source audit, not a complete instruction-loader simulation. This roadmap is a sequence of hypotheses to validate, not a promise to ship every mod.

| Mod                   | User action                                                                  | Next useful milestone                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context Studio        | Select source excerpts and prepare a reviewed task packet                    | Native CLI validation, surface smoke tests, then paired usage trials                                                                                                    |
| Output Lens           | Inspect a selected Vitest JSON report, then retrieve individual diagnostics  | Compare against Vitest's built-in agent reporter; add observed process exit provenance only through a separately designed runner                                        |
| Retry Map             | Inspect identical Bash failures per agent and observed file-tool edit period | Live smoke tests and evaluate warning usefulness; shell/external changes remain outside its observations                                                                |
| Instruction Workbench | Review selected-source duplication and directory scope                       | Implemented: exact duplicate lines, provenance, conservative scope labels, review-only consolidation proposals; validate usefulness alongside the built-in prompt audit |
| Task Capsules         | Prepare a small handoff for a separate task                                  | Explicit save/load with reviewed decisions and source freshness                                                                                                         |
| Agent Budget Board    | Review worker scope and resource choices                                     | Advisory agent-start preview without automatic model changes                                                                                                            |
| Symbol Navigator      | Select definitions and references precisely                                  | TypeScript symbol index with provenance and bounded retrieval                                                                                                           |

## Context Studio progression

1. **Prototype:** source ranges, metadata, conservative freshness checks, native pane, and explicit draft preparation.
2. **Validate:** native engine checks, terminal/desktop/VS Code usability, failure-mode testing, and measured task comparisons.
3. **Improve selection:** source discovery or symbols only if manual selection proves useful.
4. **Browser companion:** explicit packet import/export first; design a live bridge separately if needed.

Shared packages appear when a second implementation needs them. Planned mods stay out of the marketplace until independently usable and documented.

## Next implementation sequence

Finish one reviewable mod at a time. Each must ship its own icon, manifest, docs, release component, core tests, native pane checks on all supported surfaces, and a narrow manual smoke scenario. Keep the remaining concepts out of the marketplace until those checks pass.

| Order | Mod                   | First useful slice                                                                                                             | Explicit boundary                                                                                                              | Evidence before expansion                                                                                               |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1     | Instruction Workbench | Implemented selected-file review with hashes, duplicate references, and conservative proposals                                 | No import expansion, semantic judgments, effective-load simulation, or applied edits                                           | Review a real project's instruction set; compare usefulness with `/doctor prompt-audit`                                 |
| 2     | Task Capsules         | Human-edited goal, decisions, selected file references, unresolved checks; explicit export/import of a small versioned handoff | No automatic conversation capture, hidden memory, session launch, or assertion that unresolved checks passed                   | Round-trip a capsule into a fresh session; reject malformed/oversized data and clearly flag stale file references       |
| 3     | Agent Budget Board    | User-authored plan listing roles, scope, model choice, and concurrency; advisory overlap warnings and review                   | Approval of the plan is not an automatic agent start, model change, token reservation, or billing limit                        | Show distinct versus overlapping scope, validate limits, and verify that review starts no workers                       |
| 4     | Symbol Navigator      | Explicit local TypeScript indexing, followed by definition and selected-reference retrieval with source hashes                 | TypeScript's compiler runs in Node tooling, not the native plugin sandbox; no automatic code execution or broad file injection | Resolve a real tsconfig, bound indexing and result size, detect stale files, and package the index reader independently |

Task Capsules comes next because a reviewed handoff is useful on its own and needs no model call. Agent Budget Board follows with an explicit planning interface before any engine interception is considered. Symbol Navigator comes last: module resolution, project references, generated files, and index freshness need a separate design and realistic fixtures. A possible first adapter reads an explicitly generated local index; that is a proposal, not an implemented capability.

None of these milestones establishes token savings. Evaluate task success, completeness, and measured usage against normal Claude workflows before making that claim.
