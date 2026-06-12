# @statewalker/content-extractors

Content extractors: turn PDF, DOCX, XLSX, Markdown, and HTML into markdown **text** via a mime-aware registry.

## Installation

```sh
pnpm add @statewalker/content-extractors
```

## Usage

```ts
import { createDefaultRegistry } from "@statewalker/content-extractors";

const registry = createDefaultRegistry();
const extractor = registry.get("report.pdf");
const markdown = await extractor?.(pdfBytes); // string
```

## API

- `ContentExtractor` — the core contract: `bytes → Promise<string>`.
- `ExtractorRegistry` / `createDefaultRegistry` — resolve an extractor by path or MIME type.
- Format handlers under `./extractors` (PDF, DOCX, XLSX, Markdown, HTML).
- `html-to-markdown`, `markdown-to-html`, `mime-utils`, `collect-bytes` helpers.
