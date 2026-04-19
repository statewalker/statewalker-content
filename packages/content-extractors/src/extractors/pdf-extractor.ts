import { extractText } from "unpdf";
import { collectBytes } from "../collect-bytes.js";
import type { ContentExtractor } from "../types.js";

/**
 * Extracts PDF content page-by-page, formatting each page as a markdown
 * section with a `## Page N` header. This preserves page boundaries in
 * the indexed content, making search results more precise.
 */
export const pdfExtractor: ContentExtractor = async (content) => {
  const bytes = await collectBytes(content);
  const { text: pages } = await extractText(bytes);

  const sections: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i]?.trim();
    if (pageText) {
      sections.push(`## Page ${i + 1}\n\n${pageText}`);
    }
  }

  return sections.join("\n\n");
};
