import type { ContentBlock, ContentDocument } from "@repo/content-blocks";
import { parseDocument } from "@repo/content-blocks/parser";

export interface NormalizationPipelineOptions {
  normalize?: (content: string) => Promise<string>;
}

export interface ParsedBlocks {
  normalized: string;
  doc: ContentDocument;
  blocks: Array<{ title?: string; content: string }>;
}

/** Flatten a ContentDocument tree into a list of {title, content} pairs. */
function flattenBlocks(
  doc: ContentDocument,
): Array<{ title?: string; content: string }> {
  const result: Array<{ title?: string; content: string }> = [];

  function walkBlock(block: ContentBlock): void {
    if (block.content.trim() || block.title) {
      result.push({ title: block.title, content: block.content });
    }
    if (block.children) {
      for (const child of block.children) {
        walkBlock(child);
      }
    }
  }

  for (const section of doc.content) {
    for (const block of section.blocks) {
      walkBlock(block);
    }
  }

  return result;
}

export class NormalizationPipeline {
  private readonly normalizeFn?: (content: string) => Promise<string>;

  constructor(options: NormalizationPipelineOptions) {
    this.normalizeFn = options.normalize;
  }

  async process(content: string): Promise<ParsedBlocks> {
    const normalized = this.normalizeFn
      ? await this.normalizeFn(content)
      : content;

    const doc = parseDocument(normalized);
    const blocks = flattenBlocks(doc);

    return { normalized, doc, blocks };
  }
}
