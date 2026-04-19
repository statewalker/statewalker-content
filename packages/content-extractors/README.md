# @statewalker/content-extractors

Content extractors: turn PDF, DOCX, XLSX, Markdown, and HTML into `@statewalker/content-blocks`.

## Installation

```sh
pnpm add @statewalker/content-extractors
```

## Usage

```ts
import { extractFromPdf } from "@statewalker/content-extractors";

const blocks = await extractFromPdf(pdfBytes);
```

## API

- `extractFromPdf`, `extractFromDocx`, `extractFromXlsx`, `extractFromMarkdown`, `extractFromHtml`.
- `./extractors` — registry keyed by MIME type.

## Related

- `@statewalker/content-blocks` — output type.
