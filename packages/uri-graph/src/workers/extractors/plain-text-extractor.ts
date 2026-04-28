import type { ExtractorOptions } from "./base.js";
import { createExtractor } from "./base.js";

export function createPlainTextExtractor(opts: ExtractorOptions) {
  return createExtractor({
    ...opts,
    defaultName: "extract-plain-text",
    defaultVersion: "v1",
    uriLike: "file:///%.txt",
    pathPattern: /\.txt$/i,
    mime: "text/plain",
    transform: (raw) => raw,
  });
}
