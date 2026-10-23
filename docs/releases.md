# Releases and PR labels

## Helper and versioning

[Release Please](https://github.com/googleapis/release-please) manages one release component per implemented mod. It reads Conventional Commits, opens a version PR, updates the component changelog, and creates a GitHub tag and release after that PR is merged. It does not publish these private npm workspaces to npm.

The [skills repository](https://github.com/GadDev/skills/tree/main/.github) inspired the label names, CODEOWNERS, and PR template. It uses Changesets. This collection uses Release Please to update plugin metadata alongside package versions without adding a contributor changeset step.

Each implemented mod's component updates its `package.json`, `.claude-plugin/plugin.json`, workspace version in the root lockfile, changelog, and release manifest. Tags use `context-studio-vX.Y.Z`, `output-lens-vX.Y.Z`, `retry-map-vX.Y.Z`, `instruction-workbench-vX.Y.Z`, `task-capsules-vX.Y.Z`, or `agent-budget-board-vX.Y.Z`. Each mod has its own component and version PR. The root development workspace is not a separately released product.

Context Studio's current version and release manifest baseline are `1.0.0`. Output Lens, Retry Map, Instruction Workbench, Task Capsules, and Agent Budget Board use `0.0.0` as their release manifest bootstrap baseline and `0.1.0` in the working prototypes. Review each new component's first release PR before merging. Below 1.0, breaking changes bump the minor version; those APIs remain experimental. Preserve existing release versions, manifest entries, and generated changelogs when integrating branches.

## Normal flow

1. Use a Conventional Commit PR title, such as `feat(context-studio): add preview` or `fix(context-studio): reject stale sources`.
2. Review and squash merge the feature PR with that title.
3. The Release workflow verifies main and lets Release Please create or update the component's version PR.
4. Review its versions, changelog, lockfile, plugin metadata, and native smoke-test evidence.
5. Merge the version PR when ready to publish. The next main run verifies the revision and creates the GitHub release and tag.

Intent and area labels organize PRs. They do not replace Conventional Commit messages or directly choose the version bump. Do not manually change versions in ordinary feature PRs.

## Repository setup

Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** if you use `GITHUB_TOKEN` for Release Please. The workflow verifies the exact triggering main commit in a read-only job. Only the dependent Release Please job receives write access; it runs on a fresh runner with no project checkout, dependency installation, or tests. Recommended branch protection: require the **`Check`** status from GitHub Actions, review changes before merging, and use squash merges with Conventional Commit titles. These are setup instructions, not settings automatically changed by this repository.

The release workflow uses optional `GH_TOKEN`, falling back to `GITHUB_TOKEN`. If your organization blocks bot PR creation or you want CI to trigger automatically on release PRs, configure a narrowly scoped GitHub App token or a fine-grained PAT as `GH_TOKEN`, with repository contents, pull requests, and issues write access. Never commit the token. The existing skills repository's secret is not automatically shared with this repository.

GitHub generally suppresses follow-on workflow triggers from actions performed with `GITHUB_TOKEN`. With the fallback token, manually run **CI → Run workflow** against the release PR branch and verify its `Check` result before merging. With an appropriate App/PAT, normal release-PR CI can trigger. The release workflow reruns all repository checks on main before performing release operations in either mode.

## Labels

`.github/labels.json` defines the managed labels. Label sync creates or updates them on main without deleting other labels. The labeler reads trusted base-branch configuration and applies area labels from changed paths. It never executes pull-request code.

Maintainers may add `bug`, `enhancement`, `security`, `accessibility`, priorities, and review status manually. On initial setup, labels and the labeler become active after the foundation lands on main; the first PR may need manual labels.

## Recovery

If release automation fails, inspect the workflow error, fix configuration or permissions in a PR, and rerun **Release** on main. Check existing tags and releases before retrying; do not delete published versions to restart the process. An unsuccessful release operation does not imply npm publication or plugin rollback.

References: [Release Please action](https://github.com/googleapis/release-please-action), [manifest configuration](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md), and [custom JSON version updates](https://github.com/googleapis/release-please/blob/main/docs/customizing.md).
