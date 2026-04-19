import mammoth from "mammoth";
import { collectBytes } from "../collect-bytes.js";
import { htmlToMarkdown } from "../html-to-markdown.js";
import type { ContentExtractor } from "../types.js";

/**
 * Unlocks Word document content for text-based pipelines via a two-stage
 * conversion (DOCX -> HTML -> markdown). Supplies both `buffer` and
 * `arrayBuffer` to mammoth so the same code runs in Node.js and browsers
 * without environment detection.
 */
export const docxExtractor: ContentExtractor = async (content) => {
  const bytes = await collectBytes(content);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  // mammoth uses "buffer" in Node.js and "arrayBuffer" in browsers
  const result = await mammoth.convertToHtml({
    buffer: arrayBuffer,
    arrayBuffer,
  } as Parameters<typeof mammoth.convertToHtml>[0]);
  return htmlToMarkdown(result.value);
};
