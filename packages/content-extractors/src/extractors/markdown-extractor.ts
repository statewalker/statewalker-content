import { collectText } from "../collect-bytes.js";
import type { ContentExtractor } from "../types.js";

/**
 * Passthrough extractor for markdown files. Functionally identical to
 * `textExtractor` but registered under its own extension patterns so
 * the registry can distinguish `.md` from `.txt` -- allowing future
 * markdown-specific processing without breaking existing registrations.
 */
export const markdownExtractor: ContentExtractor = async (content) => {
  return collectText(content);
};
