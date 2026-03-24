/**
 * SHA1-based UUID generation for content-addressable blocks.
 *
 * Browser-compatible: uses crypto.subtle.digest (Web Crypto API).
 */

/**
 * Generate a SHA1-based UUID (v5-like) from the given content string.
 * The result is a lowercase hex string of the SHA1 hash (40 characters).
 */
export async function sha1Uuid(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-1", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return hexFromBytes(hashArray);
}

/**
 * Generate a SHA1 hash from raw bytes.
 */
export async function sha1Bytes(
  data: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = new Uint8Array(hashBuffer);
  return hexFromBytes(hashArray);
}

function hexFromBytes(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
