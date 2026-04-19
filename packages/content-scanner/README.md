# @statewalker/content-scanner

Content scanner: walks a `@statewalker/webrun-files` tree and streams `@statewalker/content-blocks` through extractors into an indexer.

## Installation

```sh
pnpm add @statewalker/content-scanner
```

## Usage

```ts
import { scanFileTree } from "@statewalker/content-scanner";

for await (const block of scanFileTree(root, { extractors, chunker })) {
  await indexer.add(block);
}
```

## API

- `scanFileTree(root, options)` — async-iterable of blocks.

## Related

- `@statewalker/content-extractors`, `@statewalker/content-manager`, `@statewalker/indexer-api`.
