# @statewalker/content-blocks

Content block types: document/section/paragraph/list/table/etc. The unit passed between extractors, scanners, and indexers.

## Installation

```sh
pnpm add @statewalker/content-blocks
```

## Usage

```ts
import type { Block, DocumentBlock } from "@statewalker/content-blocks";
```

## API

- `Block`, `DocumentBlock`, `SectionBlock`, `ParagraphBlock`, `TableBlock`, … — block types.
- `./parser` sub-export — convert markdown/HTML into blocks.

For stable block ID generation use `@statewalker/shared-ids` directly.

## Related

- `@statewalker/content-extractors`, `@statewalker/content-pipeline`.
