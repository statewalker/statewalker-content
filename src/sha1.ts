/** Compute SHA-1 hash of binary data using the Web Crypto API (browser-compatible). */
export async function computeSha1(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-1",
    data as Uint8Array<ArrayBuffer>,
  );
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
