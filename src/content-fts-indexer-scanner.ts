import type { DocumentPath, Index, IndexedBlock } from "@repo/indexer-api";
import { collect, decodeMsgpack } from "@repo/streams";
import type { ChunkData } from "./content-splitter-scanner.js";
import type { ScanStore, Update } from "./scan-store.js";
import type { ScannerOptions } from "./scanner.js";
import { Scanner } from "./scanner.js";

export type ContentFtsIndexerOptions = ScannerOptions & {
  /** The indexer-api Index to add/remove documents from. */
  index: Index;
};

/**
 * Scanner that maintains a full-text search index from content chunks.
 *
 * Reads chunks from the upstream "chunks" store via msgpack stream,
 * creates FullTextBlock entries, and delegates to the indexer-api Index.
 * Tracks indexed URIs in its own "fts-index" store (metadata only).
 */
export class ContentFtsIndexerScanner extends Scanner {
  private readonly index: Index;

  constructor(store: ScanStore, options: ContentFtsIndexerOptions) {
    super(store, options);
    this.index = options.index;
  }

  async processEntry(upstream: Update): Promise<Update | null> {
    if (!upstream.content) return null;

    const chunks = await collect(decodeMsgpack<ChunkData>(upstream.content()));
    if (chunks.length === 0) return null;

    const path = uriToDocPath(upstream.uri);
    const blocks: IndexedBlock[] = chunks.map((c) => ({
      path,
      blockId: `${path}:${c.index}`,
      content: c.content,
    }));

    await this.index.deleteDocuments([{ path }]);
    await this.index.addDocument(blocks);

    return {
      uri: upstream.uri,
      stamp: upstream.stamp,
    };
  }

  async removeEntry(uri: string): Promise<void> {
    const path = uriToDocPath(uri);
    await this.index.deleteDocuments([{ path }]);
  }
}

function uriToDocPath(uri: string): DocumentPath {
  return (uri.startsWith("/") ? uri : `/${uri}`) as DocumentPath;
}
