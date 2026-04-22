import type { DocumentPath, Index, IndexedBlock } from "@statewalker/indexer-api";
import { decodeFloat32Arrays } from "@statewalker/webrun-msgpack";
import { collect } from "@statewalker/webrun-streams";
import type { ScanStore, Update } from "./scan-store.js";
import type { ScannerOptions } from "./scanner.js";
import { Scanner } from "./scanner.js";

export type ContentVectorIndexerOptions = ScannerOptions & {
  /** The indexer-api Index to add/remove documents from. */
  index: Index;
};

/**
 * Scanner that maintains a vector search index from embeddings.
 *
 * Reads embeddings from the upstream "embeddings" store via Float32Array
 * stream, creates EmbeddingBlock entries, and delegates to the indexer-api
 * Index. Tracks indexed URIs in its own "vec-index" store (metadata only).
 */
export class ContentVectorIndexerScanner extends Scanner {
  private readonly index: Index;

  constructor(store: ScanStore, options: ContentVectorIndexerOptions) {
    super(store, options);
    this.index = options.index;
  }

  async processEntry(upstream: Update): Promise<Update | null> {
    if (!upstream.content) return null;

    const embeddings = await collect(decodeFloat32Arrays(upstream.content()));
    if (embeddings.length === 0) return null;

    const path = uriToDocPath(upstream.uri);
    const blocks: IndexedBlock[] = embeddings.map((emb, i) => ({
      path,
      blockId: `${path}:${i}`,
      embedding: emb,
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
