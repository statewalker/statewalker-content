import type { ContentProps } from "../types.js";
import { unescapeBlockSeparators } from "./escape.js";
import { parseProperties } from "./parse-properties.js";

/**
 * Heuristic: text is content (not properties) when most lines don't look
 * like `key: value` pairs. A property line has a colon within the first
 * ~60 chars. If fewer than half the lines match, or the text has a single
 * line longer than 200 chars, treat it as plain content.
 */
function looksLikeContent(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return false;
  // Single long line is almost certainly content, not a property
  if (lines.length === 1 && (lines[0]?.length ?? 0) > 200) return true;
  // Check if majority of lines look like key: value
  let propLikeCount = 0;
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx < 60) propLikeCount++;
  }
  return propLikeCount < lines.length / 2;
}

/**
 * Raw parsed segment: properties + raw content string.
 * Internal helper used by higher-level parsers.
 */
export interface RawSegment {
  props: ContentProps;
  content: string;
}

/**
 * Parse a single raw segment (text between `---` separators).
 *
 * A segment has the form:
 *   PROPERTIES_BLOCK (EMPTY_LINE | end) CONTENT
 *
 * Properties are terminated by the first empty line or end of text.
 * Content follows after the empty line, with `\---` unescaped to `---`.
 *
 * If the first non-whitespace line looks like markdown content (starts
 * with `#`), the entire segment is treated as content with no properties.
 */
export function parseSegment(segment: string): RawSegment {
  const trimmed = segment.replace(/^\s*\n/, "");

  // If the first line is a markdown header, treat everything as content
  if (/^#/.test(trimmed)) {
    return {
      props: {},
      content: unescapeBlockSeparators(trimmed.replace(/\s+$/, "")),
    };
  }

  const emptyLineIndex = trimmed.search(/\n\s*\n/);

  if (emptyLineIndex === -1) {
    if (looksLikeContent(trimmed)) {
      return {
        props: {},
        content: unescapeBlockSeparators(trimmed.replace(/\s+$/, "")),
      };
    }
    return {
      props: parseProperties(trimmed),
      content: "",
    };
  }

  const propertiesStr = trimmed.slice(0, emptyLineIndex);
  const contentRaw = trimmed.slice(
    trimmed.indexOf("\n", emptyLineIndex + 1) + 1,
  );
  const content = unescapeBlockSeparators(contentRaw.replace(/\s+$/, ""));

  // If the "properties" portion looks like content (e.g. a long line of text
  // followed by a trailing empty line), merge it into the content field.
  if (looksLikeContent(propertiesStr)) {
    const merged = content ? `${propertiesStr}\n\n${content}` : propertiesStr;
    return {
      props: {},
      content: unescapeBlockSeparators(merged.replace(/\s+$/, "")),
    };
  }

  return {
    props: parseProperties(propertiesStr),
    content,
  };
}
