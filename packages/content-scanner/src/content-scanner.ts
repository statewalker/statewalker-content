import type { FilesApi } from "@statewalker/webrun-files";
import { readFile } from "@statewalker/webrun-files";
import { encodeUri } from "./file-uri.js";
import { createScanEvent } from "./scan-events.js";
import { computeSha1 } from "./sha1.js";
import { TrackingStore } from "./tracking-store.js";
import type { CollectionConfig, FileMetadata, ScanMessage, ScanOptions } from "./types.js";

/**
 * Separates tracking storage from content storage so the scanner's metadata
 * can live on a different FilesApi instance (e.g., a local cache) than the
 * content being scanned.
 */
export type ContentScannerOptions = {
  /** Dedicated FilesApi for tracking data -- kept separate from scanned content so metadata I/O never interferes with the content file system. */
  trackingFiles: FilesApi;
  /** Namespaces all tracking files on disk so multiple scanner instances (or versions) can coexist under the same FilesApi. Defaults to `"cs"`. */
  prefix?: string;
};

/**
 * Central facade that hides the mechanics of file-tree walking, hashing,
 * and metadata persistence behind a stream-oriented API. Callers register
 * collections and consume AsyncGenerators of ContentSection events --
 * they never touch the TrackingStore or file-system details directly.
 * This keeps scanning concerns isolated from the rest of the application.
 */
export class ContentScanner {
  private readonly store: TrackingStore;
  private readonly collections = new Map<string, CollectionConfig>();

  constructor(options: ContentScannerOptions) {
    this.store = new TrackingStore(options.trackingFiles, options.prefix ?? "cs");
  }

  // -- Collection management -------------------------------------------

  /**
   * Registers a collection so subsequent `scan()` calls can track its files.
   * Collections are scoped by ID -- the same scanner instance can manage
   * multiple independent file trees without interference.
   */
  addCollection(params: { config: CollectionConfig }): void {
    this.collections.set(params.config.collectionId, params.config);
  }

  /**
   * Tears down a collection completely -- both the in-memory registration and
   * all persisted tracking records. Without this, stale metadata would
   * accumulate and `getChanges` would keep reporting phantom files.
   */
  async removeCollection(params: { collectionId: string }): Promise<void> {
    this.collections.delete(params.collectionId);
    await this.store.deleteByCollection({
      collectionId: params.collectionId,
    });
  }

  /** Returns a snapshot so callers can inspect registrations without mutating the internal map. */
  getCollections(): CollectionConfig[] {
    return [...this.collections.values()];
  }

  // -- Scanning --------------------------------------------------------

  /**
   * Walks a single collection's file tree and yields events for every detected
   * change. This is the core operation -- it compares live file-system state
   * against persisted metadata to detect additions, modifications, and removals
   * in a single pass. Uses an AsyncGenerator so callers can process events
   * incrementally without buffering the entire result set in memory.
   *
   * @throws Error if the collection ID is not registered.
   */
  async *scan(params: {
    collectionId: string;
    options?: ScanOptions;
  }): AsyncGenerator<ScanMessage> {
    const config = this.collections.get(params.collectionId);
    if (!config) {
      throw new Error(`Collection not found: ${params.collectionId}`);
    }

    const options = params.options;
    const batchSize = options?.batchSize ?? 50;
    const sleepMs = options?.sleepMs ?? 0;
    const filter = options?.filter;
    const skipHash = options?.skipHash ?? false;

    const scanTime = new Date().toISOString();
    const seenUris = new Set<string>();
    let scannedCount = 0;

    yield createScanEvent({
      type: "scan-started",
      collectionId: params.collectionId,
    });

    for await (const info of config.files.list(config.root, {
      recursive: true,
    })) {
      if (info.kind !== "file") continue;

      const filePath = info.path;
      if (filter && !filter(filePath)) continue;

      const uri = encodeUri(config.collectionId, filePath);
      seenUris.add(uri);

      const size = info.size ?? 0;
      const lastModified = info.lastModified ?? 0;

      const existing = await this.store.get({ uri });

      let changed = false;
      let hash = "";

      if (!existing || existing.removalTime !== null) {
        // New file or previously removed file reappearing
        if (!skipHash) {
          const data = await readFile(config.files, filePath);
          hash = await computeSha1(data);
        }
        changed = true;
      } else if (existing.size !== size || existing.lastModified !== lastModified) {
        // Metadata changed — check content
        if (!skipHash) {
          const data = await readFile(config.files, filePath);
          hash = await computeSha1(data);
          changed = hash !== existing.hash;
        } else {
          changed = true;
        }
      }

      // Always update scan time
      const metadata: FileMetadata = {
        uri,
        collectionId: config.collectionId,
        path: filePath,
        hash: changed ? hash : (existing?.hash ?? hash),
        size,
        lastModified,
        scanTime,
        removalTime: null,
      };
      await this.store.set({ metadata });

      if (changed) {
        yield createScanEvent({
          type: "content-changed",
          uri,
          collectionId: config.collectionId,
        });
      }

      scannedCount++;

      if (sleepMs > 0 && scannedCount % batchSize === 0) {
        await sleep(sleepMs);
      }
    }

    // Mark unseen active files in this collection as removed
    for await (const meta of this.store.listByCollection({
      collectionId: params.collectionId,
    })) {
      if (meta.removalTime === null && !seenUris.has(meta.uri)) {
        const updated: FileMetadata = {
          ...meta,
          scanTime,
          removalTime: scanTime,
        };
        await this.store.set({ metadata: updated });

        yield createScanEvent({
          type: "content-removed",
          uri: meta.uri,
          collectionId: params.collectionId,
        });
      }
    }

    yield createScanEvent({
      type: "scan-done",
      collectionId: params.collectionId,
    });
  }

  /**
   * Convenience wrapper when callers don't need per-collection control --
   * scans everything in registration order and merges the event streams.
   */
  async *scanAll(params?: { options?: ScanOptions }): AsyncGenerator<ScanMessage> {
    for (const config of this.collections.values()) {
      yield* this.scan({
        collectionId: config.collectionId,
        options: params?.options,
      });
    }
  }

  /**
   * Replays changes since a caller-provided checkpoint, enabling poll-based
   * consumers that weren't listening during the original scan. The caller
   * stores the last-seen timestamp and passes it here to get only newer events.
   */
  async *getChanges(params: { collectionId: string; since: string }): AsyncGenerator<ScanMessage> {
    const sinceTime = new Date(params.since).getTime();
    for await (const meta of this.store.listByCollection({
      collectionId: params.collectionId,
    })) {
      const metaScanTime = new Date(meta.scanTime).getTime();
      if (metaScanTime > sinceTime) {
        const type = meta.removalTime !== null ? "content-removed" : "content-changed";
        yield createScanEvent({
          type,
          uri: meta.uri,
          collectionId: params.collectionId,
        });
      }
    }
  }

  /**
   * Garbage-collects stale removal records. Without periodic cleanup,
   * the tracking store grows unboundedly as files are deleted over time.
   * The `before` threshold lets callers keep recent removals visible to
   * `getChanges` consumers while purging older ones.
   */
  async cleanupRemoved(params: { before: string }): Promise<number> {
    return this.store.deleteRemovedBefore({ before: params.before });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
