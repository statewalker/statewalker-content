import type {
  CreateIndexParams,
  DocumentPath,
  EmbedFn,
  HybridSearchResult,
  HybridWeights,
  Index,
  Indexer,
} from "@repo/indexer-api";
import { SemanticIndex } from "@repo/indexer-api";
import type { StoredBlock } from "./types.js";

export interface IndexSearchParams {
  /** One or more full-text search queries. Blocks matching more queries rank higher. */
  queries: string[];
  /** Queries whose text is embedded for vector similarity search. Requires an embed function. */
  semanticQueries?: string[];
  /** Maximum number of results to return. */
  topK: number;
  /** Path prefixes to restrict the search scope. */
  paths?: DocumentPath[];
  /** Relative weights for blending FTS and embedding scores. */
  weights?: HybridWeights;
}

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
    params: IndexSearchParams,
  ): Promise<Array<{ blockId: string; score: number }>> {
    await this.ensureIndex();
    if (!this.index) return [];

    const { queries, semanticQueries, topK, paths, weights } = params;

    let embeddings: Float32Array[] | undefined;
    const embedFn = this.embed;
    if (semanticQueries?.length && embedFn) {
      embeddings = await Promise.all(
        semanticQueries.map((q) => embedFn(q)),
      );
    }

    const results: HybridSearchResult[] = [];
    for await (const r of this.index.search({
      queries,
      embeddings,
      topK,
      paths,
      weights,
    })) {
      results.push(r);
    }
    return results.map((r) => ({ blockId: r.blockId, score: r.score }));
  }

  async close(): Promise<void> {
    if (this.index) {
      await this.index.close();
      this.index = null;
      this.semanticIndex = null;
    }
  }
}
