import type { ExtractorOptions } from "./base.js";
import { createExtractor } from "./base.js";

/**
 * Strip every HTML tag and collapse whitespace. Sufficient for indexing plain
 * text content; not a structural HTML parser.
 */
function stripTags(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createHtmlExtractor(opts: ExtractorOptions) {
  return createExtractor({
    ...opts,
    defaultName: "extract-html",
    defaultVersion: "v1",
    uriLike: "file:///%.html",
    pathPattern: /\.html?$/i,
    mime: "text/html",
    transform: stripTags,
  });
}
