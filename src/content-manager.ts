import { DocumentStore } from "./document-store.js";
import { IndexingService } from "./indexing-service.js";
import { NormalizationPipeline } from "./normalization-pipeline.js";
import type {
  ContentManager,
  ContentManagerOptions,
  SearchHit,
  StoredBlock,
  StoredDocument,
} from "./types.js";

export function createContentManager(
  options: ContentManagerOptions,
): ContentManager {
  const store = new DocumentStore(options.storage);
  const indexing = new IndexingService({
    indexer: options.indexer,
    embed: options.embed,
    embeddingDimensions: options.embeddingDimensions,
  });
  const pipeline = new NormalizationPipeline({
    normalize: options.normalize,
  });

  const manager: ContentManager = {
    async setRawContent(params: {
      uri: string;
      content: string;
    }): Promise<StoredDocument> {
      const { uri, content } = params;

      // Normalize and parse into blocks
      const { doc } = await pipeline.process(content);

      // Store in document store (assigns documentId + blockIds, persists to storage)
      const storedDoc = await store.store(uri, doc);

      // Index blocks
      await indexing.indexDocument(storedDoc.blocks);

      return storedDoc;
    },

    async removeContent(uri: string): Promise<void> {
      const doc = await store.getByUri(uri);
      if (!doc) return;

      // Remove from index by URI (path prefix)
      await indexing.removeDocument(uri);

      // Remove from document store (also removes from storage)
      await store.remove(uri);
    },

    async getDocumentById(documentId: string): Promise<StoredDocument | null> {
      return store.getById(documentId);
    },

    async getDocumentByUri(uri: string): Promise<StoredDocument | null> {
      return store.getByUri(uri);
    },

    async getBlockById(blockId: string): Promise<StoredBlock | null> {
      return store.getBlock(blockId);
    },

    async search(
      query: string,
      searchOptions?: { topK?: number },
    ): Promise<SearchHit[]> {
      const topK = searchOptions?.topK ?? 10;

      const results = await indexing.search(query, topK);

      const hits: SearchHit[] = [];
      for (const result of results) {
        const block = await store.getBlock(result.blockId);
        if (block) {
          hits.push({
            blockId: block.blockId,
            documentId: block.documentId,
            uri: block.uri,
            title: block.title,
            content: block.content,
            score: result.score,
          });
        }
      }

      return hits;
    },

    async close(): Promise<void> {
      await indexing.close();
    },
  };

  return manager;
}
