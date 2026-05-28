import type { DocumentPath } from "@statewalker/indexer-api";
import type { VectorBlock, VectorIndex } from "@statewalker/indexer-vector";
import type { ReceiptEntry, Transform, VecsEntry } from "../types.js";
import { uriToDocPath } from "./util.js";

/**
 * Full-replace vector ingester. Block IDs match `ftsIndex` so search can
 * correlate FTS and vector hits for the same chunk.
 *
 * Takes the vector sub-index directly (obtained by the caller via
 * `newVectorAccess(name).get(index)`).
 */
export function vecIndex(vec: VectorIndex): Transform<VecsEntry, ReceiptEntry> {
  return async (up) => {
    const path = uriToDocPath(up.uri);
    await vec.deleteDocuments([{ path }]);
    const vecs = up.meta?.vecs ?? [];
    if (vecs.length > 0) {
      const blocks: VectorBlock[] = vecs.map((embedding, i) => ({
        path,
        blockId: `${path}:${i}`,
        embedding,
      }));
      await vec.addDocument(blocks);
    }
    return { uri: up.uri, meta: {} as Record<string, never> };
  };
}

export async function vecIndexRemove(vec: VectorIndex, uri: string): Promise<void> {
  const path: DocumentPath = uriToDocPath(uri);
  await vec.deleteDocuments([{ path }]);
}
