# Symbol Navigator: first test drive

Find out how checkout discounts are calculated without sending entire files. This small project deliberately includes two `quoteTotal` declarations, a renamed export/import, a path alias, and enough references for a second page.

The demo is source material for indexing. It needs no application server, package install of its own, API key, or executed checkout code.

## 1. Prepare a disposable workspace

From the root of a checkout of GadDev/claude-mods, with Node 24+:

```sh
npm ci
npm run symbols:demo
```

The command copies only this project's tsconfig and four source files into a **new temporary directory**, generates `symbol-index.json`, and prints exact launch and rebuild commands. It never changes this template or an existing project. Running it again creates another fresh workspace. The generated index stays outside the repository; it contains symbol names, locations, and hashes, not source text.

## 2. Launch and load

Copy the printed `cd` and `claude --plugin-dir ...` commands into a macOS/Linux terminal. They start Claude Code in the temporary directory and load the plugin directly from your checkout, so a marketplace update is unnecessary. Use a Claude build that supports mods (the repository tests use 2.1.308); an actual interactive session uses your normal Claude setup.

In that session:

```text
/symbol-navigator load symbol-index.json
/symbol-navigator find quoteTotal
/symbol-navigator
```

Expected: two definition choices, one at `src/pricing.ts` and one at `src/legacy.ts`. Choose **src/pricing.ts**, using the printed ID or its pane button. Symbol IDs can change after regeneration; choose by location rather than memorizing an ID.

The demo task is: **Explain which checkout paths use the pricing discount.** The legacy function is a separate symbol, not another implementation to include automatically.

## 3. Select and preview

The pricing definition is always included in the packet. References are optional. Select a reference in `src/checkout.ts` pointing to a `priceCart(...)` call. Those calls resolve through `calculateTotal` back to `quoteTotal`; import/export identifiers also appear in the list.

Use **Next references** and **Previous references**. Selections survive paging. Choose **Verify and preview selected source**. The packet should contain the pricing definition, selected reference excerpts, line numbers, and full-file hashes. The legacy function should be absent. Preview inserts nothing into your prompt.

If a packet spans multiple pages, use **Next packet page** and **Previous packet page**. To retrieve it as a command reply, use `/symbol-navigator preview`. Only choose **Append verified source to draft** when ready; inspect the draft before sending it yourself.

A new search clears the previous definition and selections. Searching an import alias such as `priceCart` may return no declarations: search its original declaration name, `quoteTotal`.

## 4. Trigger a stale-source refusal and recover

In **the temporary copy**, open `src/pricing.ts` in your editor and change `discount = 0` to `discount = 0.05`. Preview again.

Expected: retrieval refuses stale evidence, clears the old selection/packet, and keeps the prior index path available for reloading. A draft already inserted earlier is not automatically retracted or refreshed.

Run the exact rebuild command printed by `npm run symbols:demo` in the repository terminal. It writes a new `symbol-index-rebuilt.json`; the ordinary generator refuses to overwrite an existing output. In the demo session:

```text
/symbol-navigator load symbol-index-rebuilt.json
/symbol-navigator find quoteTotal
```

Choose the pricing definition again and preview it. Expected: the definition now shows `discount = 0.05`. If you repeat this experiment, choose another new output filename or explicitly remove only the old generated JSON.

When finished, close the demo session and delete the exact temporary workspace printed by the setup command. It is retained for interactive use, not automatically removed while you work.

## Automated rehearsal

```sh
npm run symbols:demo -- --check
```

This prepares another temporary copy, generates a real compiler index, verifies same-name separation and alias references, pages references, retrieves a selected packet, changes the copy, verifies stale refusal, rebuilds/reloads, and removes its temporary workspace. It neither launches Claude nor uses a model. The same check runs in the existing Node test suite; no extra workflow is required.

Automated native tests exercise pane controls on terminal, desktop, and VS Code, including complete packet paging at a 40-column frame. They validate element trees and interactions, not actual rendered pixels, focus comfort, or measured token savings. On your own surface, check keyboard navigation, scrolling, wrapping, and error recovery while following this guide.

For a real project, keep the standalone tsconfig and freshness limitations in [Symbol Navigator's usage guide](../../mods/symbol-navigator/README.md#generate-an-index) in view. Newly added glob-matched files and unrecorded dependency changes require regeneration.
