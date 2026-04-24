import type { ChunksEntry, Transform, VecsEntry } from "../types.js";

export type EmbedFn = (text: string) => Promise<Float32Array>;

/**
 * Produce one embedding per chunk by sequentially awaiting `embedFn` — preserves
 * chunk ordering in the resulting `vecs` array. Returns null if the upstream
 * entry carries no chunks.
 */
export function embed(embedFn: EmbedFn): Transform<ChunksEntry, VecsEntry> {
  return async (up) => {
    if (!up.meta || up.meta.chunks.length === 0) return null;
    const vecs: Float32Array[] = [];
    for (const c of up.meta.chunks) vecs.push(await embedFn(c.text));
    return { uri: up.uri, meta: { vecs } };
  };
}
