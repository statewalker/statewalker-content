/**
 * Bridges the streaming world (chunked iterables from fetch, file reads,
 * etc.) with libraries that require a single contiguous buffer (pdfjs-dist,
 * mammoth). Returns the original chunk when only one arrives, avoiding
 * an extra copy in the common single-read case.
 */
export async function collectBytes(
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for await (const chunk of content) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }
  const first = chunks[0];
  if (chunks.length === 1 && first) {
    return first;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Shorthand for text-based extractors (plain text, markdown, HTML) that
 * need the full content as a string. Avoids duplicating the
 * collect-then-decode pattern across every text extractor.
 */
export async function collectText(
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<string> {
  const bytes = await collectBytes(content);
  return new TextDecoder().decode(bytes);
}
