/**
 * Compute a hex SHA-256 hash of the given string. Uses Web Crypto when available
 * (Node 19+, all modern browsers).
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SubtleCrypto is not available");
  }
  const buf = new TextEncoder().encode(text);
  const digest = await subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}
