# @statewalker/content-pipeline

Layered trackers that cascade file-system changes through extract, split, embed, and index stages. Each layer owns a `Store<E>`, pulls entries from its upstream store since a per-listener cursor, processes them in batched + paced drains, and notifies downstream listeners when the batch completes.

## Installation

```sh
pnpm add @statewalker/content-pipeline
```

## Usage

```ts
import { createPipeline, scanFiles } from "@statewalker/content-pipeline";

const pipeline = createPipeline({
  files, root, extractors, chunkOpts,
  ftsIndex,             // optional
  embed, vecIndex,      // optional — both or neither
  stores,               // built from the default wiring helper
});

await pipeline.scanFiles();
await pipeline.catchUpAll();
```

## API

- `Entry<M>` / `Store<E>` / `Transform<U, D>` — core types.
- `runTracker(upstream, own, transform, opts)` — driver.
- `JsonManifestStore`, `BlobStore` (msgpack + Float32 codecs), optional `SqlStore` — store backends.
- `scanFiles`, `extract`, `split`, `embed`, `ftsIndex`, `vecIndex` — concrete transforms.
- `createPipeline`, `ContentManager` — wiring + public surface.

## Related

- `@statewalker/content-blocks`, `@statewalker/content-extractors`, `@statewalker/indexer-api`, `@statewalker/indexer-chunker`.
