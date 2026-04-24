import type { ChunkOptions } from "@statewalker/indexer-chunker";
import { chunkMarkdown } from "@statewalker/indexer-chunker";
import type { ChunksEntry, ContentEntry, Transform } from "../types.js";

/**
 * Split extracted text into markdown chunks. Returns null for missing or empty
 * text so the driver skips the URI without writing a downstream entry.
 */
export function split(opts: ChunkOptions): Transform<ContentEntry, ChunksEntry> {
  return async (up) => {
    if (!up.meta?.text) return null;
    const chunks = chunkMarkdown(up.meta.text, opts).map((c) => ({
      i: c.index,
      text: c.content,
    }));
    if (chunks.length === 0) return null;
    return { uri: up.uri, meta: { chunks } };
  };
}
