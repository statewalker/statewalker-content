import type { ContentBlock } from "../types.js";

const HEADER_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Parse markdown into a hierarchical content block tree based on headers.
 *
 * - Content before the first header goes into the root block's content.
 * - Each header creates a new block; deeper headers become children.
 * - Non-header lines between headers go into the nearest parent block's content.
 */
export function buildBlockTree(markdown: string): ContentBlock {
  const lines = markdown.split("\n");

  const root: ContentBlock = { content: "", children: [] };

  const stack: Array<{ block: ContentBlock; level: number }> = [{ block: root, level: 0 }];

  const contentLines: string[] = [];

  function flushContent(): void {
    const text = contentLines.join("\n").trim();
    if (text) {
      const top = stack[stack.length - 1];
      if (top) {
        if (top.block.content) {
          top.block.content += `\n\n${text}`;
        } else {
          top.block.content = text;
        }
      }
    }
    contentLines.length = 0;
  }

  for (const line of lines) {
    const match = HEADER_RE.exec(line);
    if (match) {
      flushContent();

      const level = (match[1] as string).length;
      const title = match[2] as string;
      const block: ContentBlock = { title, content: "", children: [] };

      while (stack.length > 1) {
        const top = stack[stack.length - 1];
        if (top && top.level >= level) {
          stack.pop();
        } else {
          break;
        }
      }

      const parent = stack[stack.length - 1];
      if (parent) {
        if (!parent.block.children) {
          parent.block.children = [];
        }
        parent.block.children.push(block);
      }
      stack.push({ block, level });
    } else {
      contentLines.push(line);
    }
  }

  flushContent();

  return root;
}
