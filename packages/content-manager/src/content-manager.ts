import type {
  ScanRegistry,
  ScanStore,
  Stamp,
  Update,
  UpdateSource,
} from "@statewalker/content-scanner";
import {
  ContentExtractorScanner,
  ContentFtsIndexerScanner,
  ContentSplitterScanner,
  FilesScanner,
} from "@statewalker/content-scanner";
import type {
  CreateIndexParams,
  DocumentPath,
  HybridSearchResult,
  Index,
  Indexer,
} from "@statewalker/indexer-api";
import type { ChunkOptions } from "@statewalker/indexer-chunker";
import type {
  ContentManager,
  ContentManagerOptions,
  ContentSearchParams,
  ContentStatus,
  SearchHit,
  SyncEvent,
} from "./types.js";

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetChars: 1500,
};

async function getOrCreateStore(registry: ScanRegistry, name: string): Promise<ScanStore> {
  const existing = await registry.getStore(name);
  if (existing) return existing;
  return registry.createStore(name);
}

async function getOrCreateIndex(indexer: Indexer): Promise<Index> {
  const existing = await indexer.getIndex("content");
  if (existing) return existing;
  const params: CreateIndexParams = {
    name: "content",
    fulltext: { language: "en" },
  };
  return indexer.createIndex(params);
}

/**
 * Create a cascade source that yields only entries changed or removed
 * since the given timestamp. This enables incremental downstream processing.
 */
function cascadeSource(store: ScanStore, since: Stamp | null): UpdateSource {
  return async function* (): AsyncGenerator<Update> {
    for await (const entry of store.list()) {
      if (!since) {
        yield entry;
        continue;
      }
      // Include entries with newer stamp (changed)
      if (entry.stamp > since) {
        yield entry;
        continue;
      }
      // Include entries removed after downstream's last scan
      if (entry.removed && entry.removed > since) {
        yield entry;
      }
    }
  };
}

export function createContentManager(options: ContentManagerOptions): ContentManager {
  const {
    registry,
    indexer,
    files,
    extractors,
    chunkOptions = DEFAULT_CHUNK_OPTIONS,
    root = "/",
    filter,
  } = options;

  let ftsIndex: Index | null = null;

  async function ensureIndex(): Promise<Index> {
    if (!ftsIndex) {
      ftsIndex = await getOrCreateIndex(indexer);
    }
    return ftsIndex;
  }

  const manager: ContentManager = {
    async *sync(): AsyncGenerator<SyncEvent> {
      yield { type: "sync-started" };

      const filesStore = await getOrCreateStore(registry, "files");
      const contentStore = await getOrCreateStore(registry, "content");
      const chunksStore = await getOrCreateStore(registry, "chunks");
      const ftsStore = await getOrCreateStore(registry, "fts-index");
      const index = await ensureIndex();

      const stats = { scanned: 0, indexed: 0, removed: 0, errors: 0 };

      // 1. Scan files
      const filesScanner = new FilesScanner(filesStore, {
        files,
        root,
        filter,
        skipHash: false,
      });
      for await (const event of filesScanner.scan()) {
        if (event.type === "entry-processed") stats.scanned++;
        if (event.type === "entry-error") stats.errors++;
      }

      // 2. Extract content from changed files
      const contentLast = await contentStore.getLastScan();
      const extractor = new ContentExtractorScanner(contentStore, {
        files,
        extractors,
      });
      for await (const _event of extractor.scan(cascadeSource(filesStore, contentLast))) {
        // consumed — intermediate stage
      }

      // 3. Split content into chunks
      const chunksLast = await chunksStore.getLastScan();
      const splitter = new ContentSplitterScanner(chunksStore, {
        chunkOptions,
      });
      for await (const _event of splitter.scan(cascadeSource(contentStore, chunksLast))) {
        // consumed — intermediate stage
      }

      // 4. Index chunks in FTS
      const ftsLast = await ftsStore.getLastScan();
      const ftsIndexer = new ContentFtsIndexerScanner(ftsStore, { index });
      for await (const event of ftsIndexer.scan(cascadeSource(chunksStore, ftsLast))) {
        if (event.type === "entry-processed") {
          stats.indexed++;
          yield { type: "file-indexed", uri: event.uri };
        } else if (event.type === "entry-removed") {
          stats.removed++;
          yield { type: "file-removed", uri: event.uri };
        } else if (event.type === "entry-error") {
          stats.errors++;
          yield { type: "file-error", uri: event.uri, error: event.error };
        }
      }

      yield { type: "sync-done", stats };
    },

    async search(params: ContentSearchParams): Promise<SearchHit[]> {
      const index = await ensureIndex();
      const { queries, semanticQueries: _semanticQueries, topK = 10, paths, weights } = params;

      const results: HybridSearchResult[] = [];
      for await (const r of index.search({
        queries,
        topK,
        paths: paths as DocumentPath[] | undefined,
        weights,
      })) {
        results.push(r);
      }

      return results.map((r) => ({
        blockId: r.blockId,
        uri: String(r.path),
        content: r.fts?.snippet ?? "",
        score: r.score,
      }));
    },

    async status(): Promise<ContentStatus> {
      let fileCount = 0;
      let indexedCount = 0;

      const filesStore = await registry.getStore("files");
      if (filesStore) {
        for await (const entry of filesStore.list()) {
          if (!entry.removed) fileCount++;
        }
      }

      const ftsStore = await registry.getStore("fts-index");
      if (ftsStore) {
        for await (const entry of ftsStore.list()) {
          if (!entry.removed) indexedCount++;
        }
      }

      return { files: fileCount, indexed: indexedCount };
    },

    async clear(): Promise<void> {
      const names = await registry.getStoreNames();
      for (const name of names) {
        await registry.deleteStore(name);
      }
      if (await indexer.hasIndex("content")) {
        await indexer.deleteIndex("content");
      }
      ftsIndex = null;
    },

    async close(): Promise<void> {
      if (ftsIndex) {
        await ftsIndex.close();
        ftsIndex = null;
      }
      await registry.close();
    },
  };

  return manager;
}
