import type { ExtractorRegistry } from "@statewalker/content-extractors";
import type { FilesApi } from "@statewalker/webrun-files";
import { extname } from "@statewalker/webrun-files";
import type { ContentEntry, FileEntry, Transform } from "../types.js";

const EXT_FORMAT: Record<string, string> = {
  ".md": "markdown",
  ".txt": "text",
  ".pdf": "pdf",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".html": "html",
  ".htm": "html",
};

/** Map a URI to its content format using path extension (registry-agnostic). */
function detectFormat(uri: string): string {
  const ext = extname(uri).toLowerCase();
  return EXT_FORMAT[ext] ?? "unknown";
}

/**
 * Read the file via `FilesApi`, pick an extractor from the registry by URI,
 * and produce `{text, format}`. Returns null if no extractor matches — the
 * driver advances the cursor past unknown formats without writing a downstream entry.
 */
export function extract(
  files: FilesApi,
  extractors: ExtractorRegistry,
): Transform<FileEntry, ContentEntry> {
  return async (up) => {
    const ex = extractors.get(up.uri);
    if (!ex) return null;
    const bytes = files.read(up.uri);
    const result = await ex(bytes);
    const text = typeof result === "string" ? result : String(result);
    return { uri: up.uri, meta: { text, format: detectFormat(up.uri) } };
  };
}
