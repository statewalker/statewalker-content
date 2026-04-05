import type { ExtractorRegistry } from "@repo/content-extractors";
import type { FilesApi } from "@statewalker/webrun-files";
import type { ScanStore, Update } from "./scan-store.js";
import type { ScannerOptions } from "./scanner.js";
import { Scanner } from "./scanner.js";

export type ContentExtractorScannerOptions = ScannerOptions & {
  /** FilesApi to read raw file bytes from. */
  files: FilesApi;
  /** Registry of content extractors (PDF, docx, markdown, txt, etc.). */
  extractors: ExtractorRegistry;
};

/**
 * Scanner that extracts text content from files.
 *
 * Reads file URIs from the upstream "files" store, reads file bytes
 * from `FilesApi`, extracts text using `ExtractorRegistry`, and stores
 * the extracted text as binary content in the "content" store.
 */
export class ContentExtractorScanner extends Scanner {
  private readonly files: FilesApi;
  private readonly extractors: ExtractorRegistry;

  constructor(store: ScanStore, options: ContentExtractorScannerOptions) {
    super(store, options);
    this.files = options.files;
    this.extractors = options.extractors;
  }

  async processEntry(upstream: Update): Promise<Update | null> {
    const uri = upstream.uri;
    const extractor = this.extractors.get(uri);
    if (!extractor) return null; // no extractor for this file type

    const bytes = this.files.read(uri);
    const result = await extractor(bytes);
    const text = typeof result === "string" ? result : String(result);
    const encoded = new TextEncoder().encode(text);

    return {
      uri,
      stamp: upstream.stamp,
      meta: { format: detectFormat(uri) },
      async *content() {
        yield encoded;
      },
    };
  }

  async removeEntry(_uri: string): Promise<void> {
    // Store soft-delete handles cleanup
  }
}

function detectFormat(path: string): string {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".txt")) return "text";
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".docx")) return "docx";
  return "unknown";
}
