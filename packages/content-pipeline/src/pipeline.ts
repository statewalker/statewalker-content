import type { ExtractorRegistry } from "@statewalker/content-extractors";
import type { Index } from "@statewalker/indexer-api";
import type { ChunkOptions } from "@statewalker/indexer-chunker";
import type { FilesApi } from "@statewalker/webrun-files";
import type { ScanFilesOptions } from "./files-tracker.js";
import { scanFiles } from "./files-tracker.js";
import type { Store } from "./store.js";
import { BlobStore } from "./stores/blob.js";
import { float32Codec } from "./stores/codec-float32.js";
import { msgpackCodec } from "./stores/codec-msgpack.js";
import { JsonManifestStore } from "./stores/json-manifest.js";
import type { Tracker } from "./tracker.js";
import { runTracker } from "./tracker.js";
import { type EmbedFn, embed as embedT } from "./transforms/embed.js";
import { extract as extractT } from "./transforms/extract.js";
import { ftsIndexRemove, ftsIndex as ftsIndexT } from "./transforms/fts-index.js";
import { split as splitT } from "./transforms/split.js";
import { vecIndexRemove, vecIndex as vecIndexT } from "./transforms/vec-index.js";
import type { ChunksEntry, ContentEntry, FileEntry, ReceiptEntry, VecsEntry } from "./types.js";

export type PipelineStores = {
  files: Store<FileEntry>;
  content: Store<ContentEntry>;
  chunks: Store<ChunksEntry>;
  embeddings?: Store<VecsEntry>;
  fts?: Store<ReceiptEntry>;
  vec?: Store<ReceiptEntry>;
};

export type CreatePipelineOptions = {
  files: FilesApi;
  root: string;
  filter?: (path: string) => boolean;
  extractors: ExtractorRegistry;
  chunkOptions: ChunkOptions;
  /** Enables the embed tracker and (with `vecIndex`) the vec tracker. */
  embed?: EmbedFn;
  ftsIndex?: Index;
  vecIndex?: Index;
  stores: PipelineStores;
  batchSize?: number;
  pauseMs?: number;
  signal?: AbortSignal;
};

export type Pipeline = {
  stores: PipelineStores;
  scanFiles(scanOpts?: ScanFilesOptions): Promise<void>;
  catchUpAll(): Promise<void>;
  close(): Promise<void>;
};

/**
 * Wire concrete trackers — each a `runTracker` over a transform — from an
 * upstream store into its downstream store. Trackers subscribe to their upstream
 * store's `onStampUpdate`, so a `scanFiles()` write kicks the full cascade.
 */
export function createPipeline(opts: CreatePipelineOptions): Pipeline {
  const batchSize = opts.batchSize ?? 50;
  const pauseMs = opts.pauseMs ?? 10;
  const signal = opts.signal;

  const trackers: Tracker[] = [];

  const extractTracker = runTracker(
    opts.stores.files,
    opts.stores.content,
    extractT(opts.files, opts.extractors),
    { name: "extract", batchSize, pauseMs, signal },
  );
  trackers.push(extractTracker);

  const splitTracker = runTracker(
    opts.stores.content,
    opts.stores.chunks,
    splitT(opts.chunkOptions),
    { name: "split", batchSize, pauseMs, signal },
  );
  trackers.push(splitTracker);

  const ftsIndex = opts.ftsIndex;
  const ftsStore = opts.stores.fts;
  const ftsTracker =
    ftsIndex && ftsStore
      ? runTracker(opts.stores.chunks, ftsStore, ftsIndexT(ftsIndex), {
          name: "fts",
          batchSize,
          pauseMs,
          signal,
          onRemove: (uri) => ftsIndexRemove(ftsIndex, uri),
        })
      : null;
  if (ftsTracker) trackers.push(ftsTracker);

  const embedFn = opts.embed;
  const embedStore = opts.stores.embeddings;
  const embedTracker =
    embedFn && embedStore
      ? runTracker(opts.stores.chunks, embedStore, embedT(embedFn), {
          name: "embed",
          batchSize,
          pauseMs,
          signal,
        })
      : null;
  if (embedTracker) trackers.push(embedTracker);

  const vecIndex = opts.vecIndex;
  const vecStore = opts.stores.vec;
  const vecTracker =
    vecIndex && vecStore && embedStore
      ? runTracker(embedStore, vecStore, vecIndexT(vecIndex), {
          name: "vec",
          batchSize,
          pauseMs,
          signal,
          onRemove: (uri) => vecIndexRemove(vecIndex, uri),
        })
      : null;
  if (vecTracker) trackers.push(vecTracker);

  // Order matches dependency chain so that a cold-start catch-up fills the
  // intermediate stores before the downstream trackers run.
  const ordered: Tracker[] = [
    extractTracker,
    splitTracker,
    ...(ftsTracker ? [ftsTracker] : []),
    ...(embedTracker ? [embedTracker] : []),
    ...(vecTracker ? [vecTracker] : []),
  ];

  return {
    stores: opts.stores,
    async scanFiles(scanOpts) {
      await scanFiles(
        opts.files,
        opts.root,
        opts.stores.files,
        scanOpts ?? { filter: opts.filter },
      );
    },
    async catchUpAll() {
      for (const t of ordered) await t.catchUp();
    },
    async close() {
      for (const t of trackers) await t.close();
    },
  };
}

/**
 * Default store wiring: JSON manifest for `files`, `fts`, `vec`;
 * BlobStore for `content`, `chunks` (msgpack codec), `embeddings` (float32 codec).
 */
export function createDefaultStores(params: {
  files: FilesApi;
  prefix: string;
  withEmbeddings?: boolean;
  withVecIndex?: boolean;
  withFtsIndex?: boolean;
}): PipelineStores {
  const { files, prefix } = params;
  const filesStore = new JsonManifestStore<FileEntry>({
    files,
    prefix: `${prefix}/files`,
  });
  const contentStore = new BlobStore<ContentEntry>({
    files,
    prefix: `${prefix}/content`,
    codec: msgpackCodec(),
  });
  const chunksStore = new BlobStore<ChunksEntry>({
    files,
    prefix: `${prefix}/chunks`,
    codec: msgpackCodec(),
  });
  const stores: PipelineStores = {
    files: filesStore,
    content: contentStore,
    chunks: chunksStore,
  };
  if (params.withFtsIndex ?? true) {
    stores.fts = new JsonManifestStore<ReceiptEntry>({
      files,
      prefix: `${prefix}/fts`,
    });
  }
  if (params.withEmbeddings) {
    stores.embeddings = new BlobStore<VecsEntry>({
      files,
      prefix: `${prefix}/embeddings`,
      codec: float32Codec(),
    });
  }
  if (params.withVecIndex) {
    stores.vec = new JsonManifestStore<ReceiptEntry>({
      files,
      prefix: `${prefix}/vec`,
    });
  }
  return stores;
}
