import type { ContentExtractor } from "./types.js";

/**
 * Central routing table that decouples file-format knowledge from the
 * extraction pipeline. New formats can be added without touching pipeline
 * code. Longest-suffix matching ensures compound extensions (e.g.
 * `*.tar.gz`) win over shorter ones, and MIME-type fallback handles
 * files that arrive without a recognizable extension.
 */
export class ExtractorRegistry {
  private patternMap = new Map<string, ContentExtractor>();
  private mimeMap = new Map<string, ContentExtractor>();

  /**
   * Associates a suffix pattern with an extractor so the registry can
   * route files to the right handler based on their filename.
   */
  registerByPattern(pattern: string, extractor: ContentExtractor): void {
    this.patternMap.set(pattern, extractor);
  }

  /**
   * Provides a fallback route for files that lack a recognizable extension
   * (e.g. temp files or HTTP responses identified only by Content-Type).
   */
  registerByMime(mimeType: string, extractor: ContentExtractor): void {
    this.mimeMap.set(mimeType, extractor);
  }

  /**
   * Resolves by filename suffix, preferring the most specific match so
   * compound extensions like `*.test.html` beat `*.html` when both exist.
   */
  getByPath(path: string): ContentExtractor | undefined {
    const filename = path.includes("/")
      ? path.slice(path.lastIndexOf("/") + 1)
      : path;
    const lowerFilename = filename.toLowerCase();

    let bestMatch: ContentExtractor | undefined;
    let bestLength = 0;

    for (const [pattern, extractor] of this.patternMap) {
      // Pattern format: *.ext or *.compound.ext
      const suffix = pattern.startsWith("*") ? pattern.slice(1) : pattern;
      if (lowerFilename.endsWith(suffix) && suffix.length > bestLength) {
        bestMatch = extractor;
        bestLength = suffix.length;
      }
    }

    return bestMatch;
  }

  /** Direct MIME lookup -- used internally by `get` as the fallback path. */
  getByMime(mimeType: string): ContentExtractor | undefined {
    return this.mimeMap.get(mimeType);
  }

  /**
   * Single entry point for the pipeline -- tries the most reliable signal
   * (file extension) first, then falls back to MIME type so callers never
   * need to worry about the resolution strategy.
   */
  get(path: string, mimeType?: string): ContentExtractor | undefined {
    const byPath = this.getByPath(path);
    if (byPath) return byPath;
    if (mimeType) return this.getByMime(mimeType);
    return undefined;
  }
}
