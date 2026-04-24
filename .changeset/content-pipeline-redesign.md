---
"@statewalker/content-pipeline": minor
"@statewalker/content-cli": patch
---

**BREAKING:** removed `@statewalker/content-scanner` and `@statewalker/content-manager`, replaced by a single new package `@statewalker/content-pipeline`.

The new package implements the same cascade (files → extract → split → embed → fts/vec index) as a set of layered Trackers — each with a persisted cursor, monotonic integer stamps, batched pacing, runtime cascade via `onStampUpdate`, and tombstone propagation — wiring ~2450 LOC of scanner + manager infrastructure down to ~585 LOC. Three interchangeable `Store<E>` backends (`JsonManifestStore`, `BlobStore` with pluggable codecs including a raw Float32 fast-path for embeddings, and an optional day-2 `SqlStore`) let each layer pick the right persistence for its payload profile.

**Migration:**
- Replace `@statewalker/content-manager` / `@statewalker/content-scanner` imports with `@statewalker/content-pipeline`.
- `createContentManager` options change: drop `registry: FilesScanRegistry`, add `statePrefix: string` (directory under which the pipeline stores its state). Everything else (`indexer`, `files`, `extractors`, `chunkOptions`, `embed`, `root`, `filter`) is unchanged. The `sync` / `search` / `status` / `clear` / `close` public surface is preserved.
- First run after upgrading rebuilds state from scratch; the on-disk store layout is not compatible with the old one.

See `openspec/changes/content-pipeline-redesign/` in the umbrella for the full proposal, design notes, and spec deltas.
