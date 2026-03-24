import type { LanguageModel } from "ai";
import { generateText } from "ai";
import type { MarkdownNormalizer } from "./types.js";

export function createMarkdownNormalizer(options: {
  model: LanguageModel;
}): MarkdownNormalizer {
  return {
    async normalize(markdown, _context) {
      const { text } = await generateText({
        model: options.model,
        system: `You are a markdown formatter. Your task is to normalize and improve the structure of markdown content.

Rules:
- Fix or add structural headers based on semantic content
- Fix header hierarchy (no jumps from h1 to h4)
- Split content into semantic blocks using horizontal rules (---)
- Fix markdown formatting issues (broken lists, malformed links)
- Preserve ALL original content — reformat only, never remove
- Return ONLY the formatted markdown, no explanations`,
        prompt: markdown,
      });
      return text;
    },
  };
}
