import type { ContentProps } from "../types.js";
import { escapeBlockSeparators } from "./escape.js";
import { serializeProperties } from "./parse-properties.js";

/**
 * Produce the normalized content string for SHA1-based content-addressable ID generation.
 *
 * Normalized content:
 * - Properties excluding `id`, ordered alphabetically, serialized as YAML
 * - Empty line
 * - Content with separators escaped as `\---`
 * - Empty line
 */
export function normalizeForContentHash(properties: ContentProps, content: string): string {
  const filtered: ContentProps = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key !== "id" && value !== undefined) {
      filtered[key] = value;
    }
  }

  const props = serializeProperties(filtered);
  const escapedContent = escapeBlockSeparators(content);

  return `${props}\n\n${escapedContent}\n`;
}
