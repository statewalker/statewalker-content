const MIME_MAP: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".docm": "application/vnd.ms-word.document.macroEnabled.12",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Lightweight alternative to a full MIME-sniffing library -- covers only
 * the extensions this package can actually extract, keeping the dependency
 * footprint small. Used by callers who have a filename but no
 * Content-Type header and need a MIME type for the registry fallback path.
 */
export function getMimeType(path: string): string | undefined {
  const dotIndex = path.lastIndexOf(".");
  if (dotIndex === -1) return undefined;
  const ext = path.slice(dotIndex).toLowerCase();
  return MIME_MAP[ext];
}
