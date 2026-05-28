import type { ExtractorRegistry } from "@statewalker/content-extractors";
import type {
  DocumentPath,
  Index,
  Indexer,
  EmbedFn as IndexerEmbedFn,
  SearchResult,
} from "@statewalker/indexer-api";
import type { ChunkOptions } from "@statewalker/indexer-chunker";
import type { FullTextIndex, FulltextQuery } from "@statewalker/indexer-fulltext";
import { FULL_TEXT_TYPE, newFullTextAccess } from "@statewalker/indexer-fulltext";
import type { VectorIndex } from "@statewalker/indexer-vector";
import { newVectorAccess, VECTOR_TYPE } from "@statewalker/indexer-vector";
import type { FilesApi } from "@statewalker/webrun-files";
import type { Pipeline, PipelineStores } from "./pipeline.js";
import { createDefaultStores, createPipeline } from "./pipeline.js";
import type { EmbedFn } from "./transforms/embed.js";

/** Standard sub-index names this manager uses on the content `Index`. */
const FTS_SUB = "q";
const VEC_SUB = "semantic";

export type SearchHit = {
  blockId: string;
  uri: string;
  content: string;
  score: number;
};

export type ContentSearchParams = {
  queries: string[];
  topK?: number;
  paths?: string[];
};

/** Optional vector sub-index config — supply when `embed` is enabled. */
export type ContentVectorConfig = {
  dimensionality: number;
  model: string;
};

export type ContentStatus = {
  files: number;
  indexed: number;
};

export type SyncEvent =
  | { type: "sync-started" }
  | { type: "file-indexed"; uri: string }
  | { type: "file-removed"; uri: string }
  | { type: "file-error"; uri: string; error: string }
  | {
      type: "sync-done";
      stats: { scanned: number; indexed: number; removed: number; errors: number };
    };

export type ContentManagerOptions = {
  files: FilesApi;
  /** Directory prefix for all store state, e.g. `/.settings/content`. */
  statePrefix: string;
  extractors: ExtractorRegistry;
  chunkOptions?: ChunkOptions;
  indexer: Indexer;
  embed?: EmbedFn | IndexerEmbedFn;
  /**
   * Vector sub-index config used when `embed` is set. Required to create the
   * Index's `"semantic"` vector sub-index; ignored when reusing an Index that
   * already has it.
   */
  vector?: ContentVectorConfig;
  /** FTS language passed to the `"q"` sub-index on creation. Default `"en"`. */
  ftsLanguage?: string;
  /** Optional precomputed `stores` — overrides the default wiring derived from `statePrefix`. */
  stores?: PipelineStores;
  root?: string;
  filter?: (path: string) => boolean;
  batchSize?: number;
  pauseMs?: number;
};

export type ContentManager = {
  sync(): AsyncGenerator<SyncEvent>;
  search(params: ContentSearchParams): Promise<SearchHit[]>;
  status(): Promise<ContentStatus>;
  clear(): Promise<void>;
  close(): Promise<void>;
};

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { targetChars: 1500 };
const INDEX_NAME = "content";

/** Resolve or create the content Index with the `"q"` FTS sub-index and (if embedding) the `"semantic"` vector sub-index. */
async function getOrCreateIndex(
  indexer: Indexer,
  ftsLanguage: string,
  vector?: ContentVectorConfig,
): Promise<Index> {
  const existing = await indexer.getIndex(INDEX_NAME);
  if (existing) return existing;
  const subIndexes: Record<string, { type: string } & Record<string, unknown>> = {
    [FTS_SUB]: { type: FULL_TEXT_TYPE, language: ftsLanguage },
  };
  if (vector) {
    subIndexes[VEC_SUB] = {
      type: VECTOR_TYPE,
      dimensionality: vector.dimensionality,
      model: vector.model,
    };
  }
  return indexer.createIndex({ name: INDEX_NAME, subIndexes });
}

/**
 * Build a ContentManager over the new pipeline. Preserves the public surface of
 * the old `@statewalker/content-manager` so `content-cli` can swap packages
 * with minimal change.
 */
export function createContentManager(options: ContentManagerOptions): ContentManager {
  const embed = options.embed as EmbedFn | undefined;
  let index: Index | null = null;
  let pipeline: Pipeline | null = null;

  async function ensureIndex(): Promise<Index> {
    if (!index) {
      index = await getOrCreateIndex(
        options.indexer,
        options.ftsLanguage ?? "en",
        embed ? options.vector : undefined,
      );
    }
    return index;
  }

  async function ensurePipeline(): Promise<Pipeline> {
    if (pipeline) return pipeline;
    const idx = await ensureIndex();
    const stores =
      options.stores ??
      createDefaultStores({
        files: options.files,
        prefix: options.statePrefix,
        withFtsIndex: true,
        withEmbeddings: embed !== undefined,
        withVecIndex: embed !== undefined,
      });
    const fts: FullTextIndex = newFullTextAccess(FTS_SUB).get(idx);
    const vec: VectorIndex | undefined = embed ? newVectorAccess(VEC_SUB).tryGet(idx) : undefined;
    pipeline = createPipeline({
      files: options.files,
      root: options.root ?? "/",
      filter: options.filter,
      extractors: options.extractors,
      chunkOptions: options.chunkOptions ?? DEFAULT_CHUNK_OPTIONS,
      embed,
      ftsIndex: fts,
      vecIndex: vec,
      stores,
      batchSize: options.batchSize,
      pauseMs: options.pauseMs,
    });
    return pipeline;
  }

  return {
    async *sync(): AsyncGenerator<SyncEvent> {
      yield { type: "sync-started" };
      const p = await ensurePipeline();
      const stats = { scanned: 0, indexed: 0, removed: 0, errors: 0 };

      // Count "scanned" = files-store writes produced by this sync.
      const scanCursor = await p.stores.files.cursor("_mgr_scan");
      await p.scanFiles();
      let newScanCursor = scanCursor;
      for await (const e of p.stores.files.since(scanCursor, Number.POSITIVE_INFINITY)) {
        stats.scanned += 1;
        if (e.stamp > newScanCursor) newScanCursor = e.stamp;
      }
      if (newScanCursor !== scanCursor) {
        await p.stores.files.advance("_mgr_scan", newScanCursor);
      }

      // Translate fts-receipt deltas to SyncEvents.
      const fts = p.stores.fts;
      const syncCursor = fts ? await fts.cursor("_mgr_sync") : 0;
      await p.catchUpAll();
      if (fts) {
        let newSyncCursor = syncCursor;
        for await (const e of fts.since(syncCursor, Number.POSITIVE_INFINITY)) {
          if (e.tombstone) {
            stats.removed += 1;
            yield { type: "file-removed", uri: e.uri };
          } else if (e.meta && "error" in e.meta) {
            stats.errors += 1;
            yield {
              type: "file-error",
              uri: e.uri,
              error: String((e.meta as { error?: unknown }).error),
            };
          } else {
            stats.indexed += 1;
            yield { type: "file-indexed", uri: e.uri };
          }
          if (e.stamp > newSyncCursor) newSyncCursor = e.stamp;
        }
        if (newSyncCursor !== syncCursor) {
          await fts.advance("_mgr_sync", newSyncCursor);
        }
      }

      yield { type: "sync-done", stats };
    },

    async search(params: ContentSearchParams): Promise<SearchHit[]> {
      const idx = await ensureIndex();
      const ftsAccess = newFullTextAccess(FTS_SUB);
      const subQuery: FulltextQuery = { queries: params.queries };
      const results: SearchResult[] = [];
      const request = {
        topK: params.topK ?? 10,
        paths: params.paths as DocumentPath[] | undefined,
        subQueries: { [FTS_SUB]: subQuery },
      };
      for await (const r of idx.search(request)) {
        results.push(r);
      }
      return results.map((r) => {
        const ftsHit = ftsAccess.getResult(r);
        return {
          blockId: r.blockId,
          uri: String(r.path),
          content: ftsHit?.snippet ?? "",
          score: r.score,
        };
      });
    },

    async status(): Promise<ContentStatus> {
      const p = await ensurePipeline();
      let files = 0;
      for await (const e of p.stores.files.since(0, Number.POSITIVE_INFINITY)) {
        if (!e.tombstone) files += 1;
      }
      let indexed = 0;
      if (p.stores.fts) {
        for await (const e of p.stores.fts.since(0, Number.POSITIVE_INFINITY)) {
          if (!e.tombstone) indexed += 1;
        }
      }
      return { files, indexed };
    },

    async clear(): Promise<void> {
      if (pipeline) await pipeline.close();
      if (await options.indexer.hasIndex(INDEX_NAME)) {
        await options.indexer.deleteIndex(INDEX_NAME);
      }
      // Remove all store state under the prefix.
      if (await options.files.exists(options.statePrefix)) {
        await options.files.remove(options.statePrefix);
      }
      pipeline = null;
      index = null;
    },

    async close(): Promise<void> {
      if (pipeline) await pipeline.close();
      pipeline = null;
      index = null;
    },
  };
}
