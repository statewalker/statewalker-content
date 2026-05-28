import type { DocumentPath } from "@statewalker/indexer-api";
import type { FullTextBlock, FullTextIndex } from "@statewalker/indexer-fulltext";
import type { ChunksEntry, ReceiptEntry, Transform } from "../types.js";
import { uriToDocPath } from "./util.js";

/**
 * Full-replace FTS ingester: deletes the document then adds one block per chunk.
 * Block IDs follow `{uri}:{i}` so FTS and vector sub-indexes stay correlated.
 * Receipt carries no meta — it exists purely so downstream listeners can subscribe.
 *
 * Takes the FTS sub-index directly (obtained by the caller via
 * `newFullTextAccess(name).get(index)`). The caller decides which sub-index
 * name this transform writes into.
 */
export function ftsIndex(fts: FullTextIndex): Transform<ChunksEntry, ReceiptEntry> {
  return async (up) => {
    const path = uriToDocPath(up.uri);
    await fts.deleteDocuments([{ path }]);
    const chunks = up.meta?.chunks ?? [];
    if (chunks.length > 0) {
      const blocks: FullTextBlock[] = chunks.map((c) => ({
        path,
        blockId: `${path}:${c.i}`,
        content: c.text,
      }));
      await fts.addDocument(blocks);
    }
    return { uri: up.uri, meta: {} as Record<string, never> };
  };
}

/** Cascade-remove the document from the FTS sub-index when a chunks-layer tombstone arrives. */
export async function ftsIndexRemove(fts: FullTextIndex, uri: string): Promise<void> {
  const path: DocumentPath = uriToDocPath(uri);
  await fts.deleteDocuments([{ path }]);
}
