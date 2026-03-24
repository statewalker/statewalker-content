export { docxExtractor } from "./docx-extractor.js";
export { htmlExtractor } from "./html-extractor.js";
export { markdownExtractor } from "./markdown-extractor.js";
export { pdfExtractor } from "./pdf-extractor.js";
export { textExtractor } from "./text-extractor.js";
export { xlsxExtractor } from "./xlsx-extractor.js";

import { ExtractorRegistry } from "../extractor-registry.js";
import { docxExtractor } from "./docx-extractor.js";
import { htmlExtractor } from "./html-extractor.js";
import { markdownExtractor } from "./markdown-extractor.js";
import { pdfExtractor } from "./pdf-extractor.js";
import { textExtractor } from "./text-extractor.js";
import { xlsxExtractor } from "./xlsx-extractor.js";

/**
 * Provides a batteries-included registry so most consumers can start
 * extracting immediately without manual format registration. Custom
 * registries are still supported for apps that need to override or
 * limit the built-in set.
 */
export function createDefaultRegistry(): ExtractorRegistry {
  const registry = new ExtractorRegistry();
  registry.registerByPattern("*.md", markdownExtractor);
  registry.registerByPattern("*.markdown", markdownExtractor);
  registry.registerByPattern("*.txt", textExtractor);
  registry.registerByPattern("*.html", htmlExtractor);
  registry.registerByPattern("*.htm", htmlExtractor);
  registry.registerByPattern("*.pdf", pdfExtractor);
  registry.registerByPattern("*.docx", docxExtractor);
  registry.registerByPattern("*.docm", docxExtractor);
  registry.registerByPattern("*.xlsx", xlsxExtractor);
  return registry;
}
