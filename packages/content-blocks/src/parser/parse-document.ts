import type { ContentBlock, ContentDocument, ContentProps, ContentSection } from "../types.js";
import { buildBlockTree } from "./build-section-tree.js";
import { parseProperties } from "./parse-properties.js";
import { parseSegment } from "./parse-segment.js";

/**
 * Parse a document (markdown file) into a ContentDocument.
 *
 * Supports two document header formats:
 *
 * 1. Frontmatter (starts with `---`):
 *    ```
 *    ---
 *    title: Test
 *    ---
 *    <sections...>
 *    ```
 *
 * 2. Plain header (no leading `---`):
 *    ```
 *    title: Test
 *    ---
 *    <sections...>
 *    ```
 *
 * When the text contains no `---` separator at all, the entire text is
 * treated as content (a single section with no properties). Properties
 * are only extracted from sections when the document has frontmatter or
 * `---` separators.
 *
 * Sections are separated by `---`. Each section has optional properties
 * and content parsed into a block tree (from markdown headers).
 */
export function parseDocument(text: string): ContentDocument {
  const segments = text.split(/^-{3,}\s*$/m);

  // No --- separator at all → treat entire text as pure content
  if (segments.length === 1) {
    return buildSingleContentDocument(text);
  }

  const hasFrontmatter = segments[0]?.trim() === "";

  let docProps: ContentProps;
  let sectionStart: number;

  if (hasFrontmatter) {
    docProps = parseProperties(segments[1] ?? "");
    sectionStart = 2;
  } else {
    const docSegment = parseSegment(segments[0] ?? "");
    docProps = docSegment.props;
    sectionStart = 1;
  }

  const sections: ContentSection[] = [];
  for (let i = sectionStart; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined) continue;

    const trimmed = segment.trim();
    if (trimmed === "") continue;

    const raw = parseSegment(segment);
    const rootBlock = buildBlockTree(raw.content);

    const blocks: ContentBlock[] = [];
    if (rootBlock.content || !rootBlock.children?.length) {
      blocks.push({ content: rootBlock.content });
    }
    if (rootBlock.children) {
      blocks.push(...rootBlock.children);
    }

    const section: ContentSection = { blocks };
    if (Object.keys(raw.props).length > 0) {
      section.props = raw.props;
    }
    sections.push(section);
  }

  const result: ContentDocument = { content: sections };
  if (Object.keys(docProps).length > 0) {
    result.props = docProps;
  }
  return result;
}

function buildSingleContentDocument(text: string): ContentDocument {
  const trimmed = text.trim();
  if (!trimmed) return { content: [] };

  const rootBlock = buildBlockTree(trimmed);
  const blocks: ContentBlock[] = [];
  if (rootBlock.content || !rootBlock.children?.length) {
    blocks.push({ content: rootBlock.content });
  }
  if (rootBlock.children) {
    blocks.push(...rootBlock.children);
  }
  return { content: [{ blocks }] };
}
