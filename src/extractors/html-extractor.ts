import { collectText } from "../collect-bytes.js";
import { htmlToMarkdown } from "../html-to-markdown.js";
import type { ContentExtractor } from "../types.js";

/**
 * Converts HTML files to markdown so the pipeline outputs a uniform
 * text format. Delegates to `htmlToMarkdown` for the actual conversion,
 * keeping this extractor focused on the bytes-to-string bridging step.
 */
export const htmlExtractor: ContentExtractor = async (content) => {
  const html = await collectText(content);
  return htmlToMarkdown(html);
};
