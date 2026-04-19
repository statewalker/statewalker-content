# @statewalker/content-manager

Content manager: orchestrates scanning, extraction, chunking, and indexing over a `@statewalker/webrun-files` tree.

## Installation

```sh
pnpm add @statewalker/content-manager
```

## Usage

```ts
import { createContentManager } from "@statewalker/content-manager";

const mgr = createContentManager({ fs, indexer, chunker });
await mgr.sync(rootPath);
```

## API

- `createContentManager(options)` — high-level scan + index driver.

## Related

- `@statewalker/content-scanner`, `@statewalker/content-extractors`, `@statewalker/indexer-api`.
