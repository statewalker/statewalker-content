import type { ExtractorOptions } from "./base.js";
import { createExtractor } from "./base.js";

/**
 * Markdown extractor: matches `*.md` files. Currently passes raw markdown through
 * unchanged (the indexer treats it as text). Replace `transform` if a structured
 * markdown → plain conversion is needed downstream.
 */
export function createMarkdownExtractor(opts: ExtractorOptions) {
  return createExtractor({
    ...opts,
    defaultName: "extract-markdown",
    defaultVersion: "v1",
    uriLike: "file:///%.md",
    pathPattern: /\.md$/i,
    mime: "text/markdown",
    transform: (raw) => raw,
  });
}
