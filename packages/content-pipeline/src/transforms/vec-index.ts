import type { DocumentPath, Index, IndexedBlock } from "@statewalker/indexer-api";
import type { ReceiptEntry, Transform, VecsEntry } from "../types.js";
import { uriToDocPath } from "./util.js";

/**
 * Full-replace vector indexer. Block IDs match `ftsIndex` so hybrid search can
 * correlate FTS and vector hits for the same chunk.
 */
export function vecIndex(index: Index): Transform<VecsEntry, ReceiptEntry> {
  return async (up) => {
    const path = uriToDocPath(up.uri);
    await index.deleteDocuments([{ path }]);
    const vecs = up.meta?.vecs ?? [];
    if (vecs.length > 0) {
      const blocks: IndexedBlock[] = vecs.map((embedding, i) => ({
        path,
        blockId: `${path}:${i}`,
        embedding,
      }));
      await index.addDocument(blocks);
    }
    return { uri: up.uri, meta: {} as Record<string, never> };
  };
}

export async function vecIndexRemove(index: Index, uri: string): Promise<void> {
  const path: DocumentPath = uriToDocPath(uri);
  await index.deleteDocuments([{ path }]);
}
