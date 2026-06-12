/**
 * The lowest-level extraction contract: raw bytes in, text out.
 * Individual format handlers (PDF, DOCX, HTML, etc.) implement this type
 * so the registry can treat every file format uniformly without knowing
 * the parsing details.
 */
export type ContentExtractor = (
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
) => Promise<string | unknown>;

/**
 * Decouples post-processing from extraction so callers stay free of
 * LLM or AI dependencies. Consumers can inject an LLM-backed normalizer
 * to clean up, restructure, or enrich extracted markdown without the
 * core package ever knowing about the LLM.
 */
export interface ContentNormalizer {
  /**
   * Refines raw extracted markdown -- fixing formatting artifacts, improving
   * structure, or enriching content. The optional context hint lets the
   * normalizer tailor its output (e.g. summarize for a specific audience).
   */
  normalize(params: { markdown: string; context?: string }): Promise<{ markdown: string }>;
}
