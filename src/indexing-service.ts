import type {
  CreateIndexParams,
  DocumentPath,
  EmbedFn,
  HybridSearchResult,
  Index,
  Indexer,
} from "@repo/indexer-api";
import { SemanticIndex } from "@repo/indexer-api";
import type { StoredBlock } from "./types.js";

export interface IndexingServiceOptions {
  indexer: Indexer;
  embed?: EmbedFn;
  embeddingDimensions?: number;
}

function toDocPath(uri: string): DocumentPath {
  return (uri.startsWith("/") ? uri : `/${uri}`) as DocumentPath;
}

export class IndexingService {
  private readonly indexer: Indexer;
  private readonly embed?: EmbedFn;
  private readonly embeddingDimensions?: number;
  private index: Index | null = null;
  private semanticIndex: SemanticIndex | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: IndexingServiceOptions) {
    this.indexer = options.indexer;
    this.embed = options.embed;
    this.embeddingDimensions = options.embeddingDimensions;
  }

  private async ensureIndex(): Promise<void> {
    if (this.index) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = this.createIndex();
    await this.initPromise;
  }

  private async createIndex(): Promise<void> {
    const existing = await this.indexer.getIndex("content");
    if (existing) {
      this.index = existing;
    } else {
      const params: CreateIndexParams = {
        name: "content",
        fulltext: { language: "en" },
      };

      if (this.embed && this.embeddingDimensions) {
        params.vector = {
          dimensionality: this.embeddingDimensions,
          model: "custom",
        };
      }

      this.index = await this.indexer.createIndex(params);
    }

    if (this.embed) {
      this.semanticIndex = new SemanticIndex(this.index, this.embed);
    }
  }

  async indexDocument(blocks: StoredBlock[]): Promise<void> {
    await this.ensureIndex();

    if (this.semanticIndex) {
      await this.semanticIndex.addDocuments(
        blocks.map((b) => ({
          path: toDocPath(b.uri),
          blockId: b.blockId,
          content: b.title ? `${b.title}\n${b.content}` : b.content,
        })),
      );
    } else if (this.index) {
      await this.index.addDocuments(
        blocks.map((b) => [
          {
            path: toDocPath(b.uri),
            blockId: b.blockId,
            content: b.title ? `${b.title}\n${b.content}` : b.content,
          },
        ]),
      );
    }
  }

  async removeDocument(uri: string): Promise<void> {
    await this.ensureIndex();
    if (this.index) {
      await this.index.deleteDocuments([{ path: toDocPath(uri) }]);
    }
  }

  async search(
    query: string,
    topK: number,
  ): Promise<Array<{ blockId: string; score: number }>> {
    await this.ensureIndex();

    if (this.semanticIndex) {
      const results = await this.semanticIndex.search({ query, topK });
      return results.map((r) => ({ blockId: r.blockId, score: r.score }));
    }

    if (this.index) {
      const results: HybridSearchResult[] = [];
      for await (const r of this.index.search({ queries: [query], topK })) {
        results.push(r);
      }
      return results.map((r) => ({ blockId: r.blockId, score: r.score }));
    }

    return [];
  }

  async close(): Promise<void> {
    if (this.index) {
      await this.index.close();
      this.index = null;
      this.semanticIndex = null;
    }
  }
}
