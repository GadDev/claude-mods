# Working on Claude Mods

- Read the affected mod's README and `docs/architecture.md` before editing.
- Runtime code is TypeScript ESM inside a Claude Code hooks module, with no Node or DOM APIs. Use the official declarations fetched by `npm run types:fetch`; do not invent API fields or replace them with permissive ambient types.
- Keep each installed plugin self-contained. Do not import a sibling workspace at runtime.
- Run `npm run check`. If Claude CLI is available, also run `claude plugin validate` for each changed plugin and the root marketplace. Report unavailable native checks clearly.
- Preserve explicit user actions for source reading and draft insertion. Do not automatically submit prompts, start agents, approve tools, or add model calls.
- A character heuristic is a token estimate, not measured usage or subscription savings.
- Keep planned mods in the roadmap until implemented and tested.
- Use Conventional Commit PR titles. Release Please owns released version changes and changelogs; do not hand-edit them for ordinary changes.
