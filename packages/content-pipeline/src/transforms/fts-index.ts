import type { DocumentPath, Index, IndexedBlock } from "@statewalker/indexer-api";
import type { ChunksEntry, ReceiptEntry, Transform } from "../types.js";
import { uriToDocPath } from "./util.js";

/**
 * Full-replace indexer: deletes the document then adds one block per chunk.
 * Block IDs follow `{uri}:{i}` so FTS and vector sub-indexes stay correlated.
 * Receipt carries no meta — it exists purely so downstream listeners can subscribe.
 */
export function ftsIndex(index: Index): Transform<ChunksEntry, ReceiptEntry> {
  return async (up) => {
    const path = uriToDocPath(up.uri);
    await index.deleteDocuments([{ path }]);
    const chunks = up.meta?.chunks ?? [];
    if (chunks.length > 0) {
      const blocks: IndexedBlock[] = chunks.map((c) => ({
        path,
        blockId: `${path}:${c.i}`,
        content: c.text,
      }));
      await index.addDocument(blocks);
    }
    return { uri: up.uri, meta: {} as Record<string, never> };
  };
}

/** Cascade-remove the document from the index when a chunks-layer tombstone arrives. */
export async function ftsIndexRemove(index: Index, uri: string): Promise<void> {
  const path: DocumentPath = uriToDocPath(uri);
  await index.deleteDocuments([{ path }]);
}
