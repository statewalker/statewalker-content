/**
 * Encode a collection ID and path into a URI string.
 * Format: "{collectionId}:{path}"
 */
export function encodeUri(collectionId: string, path: string): string {
  return `${collectionId}:${path}`;
}

/**
 * Parse a URI string into its collection ID and path components.
 * Splits on the first colon only, so paths may contain colons.
 */
export function parseUri(uri: string): { collectionId: string; path: string } {
  const idx = uri.indexOf(":");
  if (idx === -1) {
    throw new Error(`Invalid file URI (no colon): ${uri}`);
  }
  return {
    collectionId: uri.slice(0, idx),
    path: uri.slice(idx + 1),
  };
}
