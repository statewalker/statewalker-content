import type { ContentMessage, ContentMessageProps } from "@repo/content-blocks";

/**
 * The lowest-level extraction contract: raw bytes in, text out.
 * Individual format handlers (PDF, DOCX, HTML, etc.) implement this type
 * so the pipeline can treat every file format uniformly without knowing
 * the parsing details.
 */
export type ContentExtractor = (
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
) => Promise<string | unknown>;

/**
 * Decouples post-processing from extraction so the pipeline stays free of
 * LLM or AI dependencies. Consumers can inject an LLM-backed normalizer
 * at call time to clean up, restructure, or enrich extracted markdown
 * without the core package ever knowing about the LLM.
 */
export interface ContentNormalizer {
  /**
   * Refines raw extracted markdown -- fixing formatting artifacts, improving
   * structure, or enriching content. The optional context hint lets the
   * normalizer tailor its output (e.g. summarize for a specific audience).
   */
  normalize(params: {
    markdown: string;
    context?: string;
  }): Promise<{ markdown: string }>;
}

/**
 * Groups every decision the caller needs to make before running the
 * extraction pipeline: which file to process, how to resolve its format,
 * and whether to apply post-processing.
 */
export interface ExtractionOptions {
  /** Drives extractor lookup -- the registry matches suffix patterns against this path. */
  path: string;

  /** Fallback for files whose path has no recognizable extension (e.g. temp files, URLs). */
  mimeType?: string;

  /**
   * When present, the pipeline adds a normalization stage after extraction.
   * Omitting it keeps the pipeline lightweight -- just extract and parse.
   */
  normalizer?: ContentNormalizer;

  /** Extra guidance forwarded to the normalizer (e.g. a topic or audience hint). */
  context?: string;

  /**
   * Tags every emitted message so consumers can filter pipeline output
   * from other message sources in a shared stream.
   * @defaultValue `"tool:content-extractor"`
   */
  role?: string;
}

// --------------------------------------------------------------
// Typed extraction messages — so consumers get compile-time
// guarantees on the shape of every event the pipeline emits.
// --------------------------------------------------------------

/**
 * The three processing phases the extraction pipeline passes through.
 * `"extracting"` and `"normalizing"` are progress indicators (empty blocks);
 * `"done"` carries the final parsed block tree.
 */
export type ExtractionStage = "extracting" | "normalizing" | "done";

/**
 * Distinguishes progress notifications from the final result so consumers
 * can route messages differently (e.g. show a spinner for progress, render
 * blocks for the result) without inspecting `stage`.
 */
export type ExtractionEventType = "extraction-progress" | "extraction-done";

/**
 * Narrows `ContentMessageProps` to the exact fields every extraction event carries.
 * Consumers can destructure `props` without casting or null-checking `stage`/`type`,
 * and TypeScript will catch mismatches if the pipeline's output format changes.
 */
export interface ExtractionMessageProps extends ContentMessageProps {
  /** Identifies this message source in a mixed-message stream. Defaults to `"tool:content-extractor"` but callers can override via `ExtractionOptions.role`. */
  role: string;
  /** Which pipeline phase produced this message — drives UI decisions like "show spinner" vs "render content". */
  stage: ExtractionStage;
  /** Coarser than `stage`: separates intermediate progress from the final deliverable. */
  type: ExtractionEventType;
}

/**
 * The concrete message type yielded by `extractContent()`.
 * Extends `ContentMessage` with a narrowed `props` so callers get full type safety
 * on the event shape without downcasting. Only the `"done"` message carries
 * populated `blocks`; progress messages have `blocks: []`.
 */
export interface ExtractionMessage extends ContentMessage {
  props: ExtractionMessageProps;
}
