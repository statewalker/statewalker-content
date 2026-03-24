import { collectText } from "../collect-bytes.js";
import type { ContentExtractor } from "../types.js";

/**
 * Identity extractor for plain text -- no conversion needed, just
 * decode bytes to a string. Exists as a distinct entry so `.txt` files
 * route through the same pipeline as every other format.
 */
export const textExtractor: ContentExtractor = async (content) => {
  return collectText(content);
};
