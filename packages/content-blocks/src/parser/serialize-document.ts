import type { ContentBlock, ContentDocument, ContentSection } from "../types.js";
import { escapeBlockSeparators } from "./escape.js";
import { serializeProperties } from "./parse-properties.js";

/**
 * Serialize a content block tree back to markdown text.
 * This is the inverse of `buildBlockTree`.
 */
export function serializeBlockTree(blocks: ContentBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    if (block.title) {
      serializeBlockLines(block, 1, lines);
    } else {
      if (block.content) {
        lines.push(block.content);
      }
      if (block.children) {
        for (const child of block.children) {
          serializeBlockLines(child, 1, lines);
        }
      }
    }
  }

  return lines.join("\n");
}

function serializeBlockLines(block: ContentBlock, level: number, lines: string[]): void {
  const hashes = "#".repeat(level);
  lines.push(`${hashes} ${block.title}`);
  if (block.content) {
    lines.push(block.content);
  }
  if (block.children) {
    for (const child of block.children) {
      serializeBlockLines(child, level + 1, lines);
    }
  }
}

/**
 * Serialize a section to its markdown representation.
 */
export function serializeSection(section: ContentSection): string {
  const lines: string[] = [];

  if (section.props && Object.keys(section.props).length > 0) {
    lines.push(serializeProperties(section.props));
  }

  const contentStr = serializeBlockTree(section.blocks);
  if (contentStr) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(escapeBlockSeparators(contentStr));
  }

  return lines.join("\n");
}

/**
 * Serialize a document (props + sections) to its markdown representation.
 *
 * Format:
 * ```
 * ---
 * <document properties>
 * ---
 * <section properties>
 *
 * <section content>
 *
 * ---
 * <section properties>
 *
 * <section content>
 *
 * ```
 */
export function serializeDocument(doc: ContentDocument): string {
  const parts: string[] = [];

  if (doc.props && Object.keys(doc.props).length > 0) {
    parts.push("---");
    parts.push(serializeProperties(doc.props));
  }

  for (const section of doc.content) {
    parts.push("---");
    parts.push(serializeSection(section));
    parts.push("");
  }

  return `${parts.join("\n")}\n`;
}
