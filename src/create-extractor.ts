import { extractContent } from "./extraction-pipeline.js";
import type { ExtractorRegistry } from "./extractor-registry.js";
import { createDefaultRegistry } from "./extractors/index.js";
import type { ExtractionMessage, ExtractionOptions } from "./types.js";

/**
 * Lets consumers set up registry configuration once at startup and then
 * call the returned function throughout the app without threading the
 * registry through every call site. Defaults to the built-in registry
 * so zero-config usage works out of the box.
 */
export function createContentExtractor(registry?: ExtractorRegistry) {
  const reg = registry ?? createDefaultRegistry();
  return function extract(
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options: ExtractionOptions,
  ): AsyncGenerator<ExtractionMessage> {
    return extractContent(content, options, reg);
  };
}
