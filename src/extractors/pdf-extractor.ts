import { extractText } from "unpdf";
import { collectBytes } from "../collect-bytes.js";
import type { ContentExtractor } from "../types.js";

/**
 * Makes PDF content searchable and consumable by text-based pipelines.
 * Uses unpdf which wraps pdf.js with a simpler API and runs in both
 * Node.js and serverless environments without worker configuration.
 */
export const pdfExtractor: ContentExtractor = async (content) => {
  const bytes = await collectBytes(content);
  const { text } = await extractText(bytes, { mergePages: true });
  return text.trim();
};
