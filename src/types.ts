import type { ExtractorRegistry } from "@repo/content-extractors";
import type { ScanRegistry } from "@repo/content-scanner";
import type { EmbedFn, Indexer } from "@repo/indexer-api";
import type { ChunkOptions } from "@repo/indexer-chunker";
import type { FilesApi } from "@statewalker/webrun-files";

export interface SearchHit {
  blockId: string;
  uri: string;
  content: string;
  score: number;
}

export interface ContentSearchParams {
  queries: string[];
  semanticQueries?: string[];
  topK?: number;
  paths?: string[];
  weights?: { fts: number; embedding: number };
}

export interface ContentStatus {
  files: number;
  indexed: number;
}

export type SyncEvent =
  | { type: "sync-started" }
  | { type: "file-indexed"; uri: string }
  | { type: "file-removed"; uri: string }
  | { type: "file-error"; uri: string; error: string }
  | {
      type: "sync-done";
      stats: {
        scanned: number;
        indexed: number;
        removed: number;
        errors: number;
      };
    };

export interface ContentManagerOptions {
  registry: ScanRegistry;
  indexer: Indexer;
  files: FilesApi;
  extractors: ExtractorRegistry;
  chunkOptions?: ChunkOptions;
  embed?: EmbedFn;
  embeddingDimensions?: number;
  root?: string;
  filter?: (path: string) => boolean;
}

export interface ContentManager {
  sync(): AsyncGenerator<SyncEvent>;
  search(params: ContentSearchParams): Promise<SearchHit[]>;
  status(): Promise<ContentStatus>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
