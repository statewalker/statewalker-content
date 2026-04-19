import type { FilesApi } from "@statewalker/webrun-files";
import { readFile } from "@statewalker/webrun-files";
import type { ListParams, ScanStore, Update } from "./scan-store.js";
import type { ScannerEvent, ScannerOptions, UpdateSource } from "./scanner.js";
import { Scanner } from "./scanner.js";
import { computeSha1 } from "./sha1.js";

export type FilesScannerOptions = ScannerOptions & {
  /** FilesApi to read files from. */
  files: FilesApi;
  /** Root directory to scan. */
  root: string;
  /** Filter function — return `false` to skip a path. */
  filter?: (path: string) => boolean;
  /** Skip content hashing (detect changes by size + mtime only). */
  skipHash?: boolean;
  /** Periodic scan interval in ms (0 = no periodic scan). */
  intervalMs?: number;
};

/**
 * Creates an `UpdateSource` that walks the file system and yields
 * `Update` entries for each file found.
 */
export function createFsWalker(
  files: FilesApi,
  root: string,
  filter?: (path: string) => boolean,
): UpdateSource {
  return async function* (_params?: ListParams) {
    for await (const info of files.list(root, { recursive: true })) {
      if (info.kind !== "file") continue;
      if (filter && !filter(info.path)) continue;
      const update: Update = {
        uri: info.path,
        stamp: new Date(), // will be overwritten by scanner
        meta: {
          size: info.size ?? 0,
          lastModified: info.lastModified ?? 0,
        },
      };
      yield update;
    }
  };
}

/**
 * Root scanner that detects file-system changes.
 *
 * It walks the file system, compares against its store, and detects
 * added/modified/removed files. Stores metadata only (no binary content).
 */
export class FilesScanner extends Scanner {
  private readonly files: FilesApi;
  private readonly root: string;
  private readonly filter?: (path: string) => boolean;
  private readonly skipHash: boolean;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;

  constructor(store: ScanStore, options: FilesScannerOptions) {
    super(store, options);
    this.files = options.files;
    this.root = options.root;
    this.filter = options.filter;
    this.skipHash = options.skipHash ?? false;
    this.intervalMs = options.intervalMs ?? 0;
  }

  async processEntry(upstream: Update): Promise<Update | null> {
    const uri = upstream.uri;
    const size = (upstream.meta?.size as number) ?? 0;
    const lastModified = (upstream.meta?.lastModified as number) ?? 0;

    // Check existing entry in our store
    const existing: Update | undefined = await firstOrUndefined(this.store.list({ uri }));

    let changed = false;
    let hash = "";

    if (!existing || existing.removed) {
      // New file or previously removed
      if (!this.skipHash) {
        const data = await readFile(this.files, uri);
        hash = await computeSha1(data);
      }
      changed = true;
    } else {
      const existingSize = (existing.meta?.size as number) ?? 0;
      const existingMtime = (existing.meta?.lastModified as number) ?? 0;
      if (existingSize !== size || existingMtime !== lastModified) {
        if (!this.skipHash) {
          const data = await readFile(this.files, uri);
          hash = await computeSha1(data);
          const existingHash = (existing.meta?.hash as string) ?? "";
          changed = hash !== existingHash;
        } else {
          changed = true;
        }
      }
    }

    if (!changed && existing && !existing.removed) {
      return null; // unchanged — skip re-stamping
    }

    return {
      uri,
      stamp: new Date(),
      meta: { size, lastModified, hash },
    };
  }

  async removeEntry(_uri: string): Promise<void> {
    // No extra cleanup needed — the store handles soft delete
  }

  /**
   * Override scan to also detect removed files.
   * After processing all files from the walker, any entries in our store
   * that were not visited are marked as removed.
   */
  async *scan(source?: UpdateSource, params?: ListParams): AsyncGenerator<ScannerEvent> {
    const walker = source ?? createFsWalker(this.files, this.root, this.filter);
    const scanTime = new Date();
    const seenUris = new Set<string>();

    // Wrap the source to track seen URIs
    const trackingSource: UpdateSource = async function* (p) {
      for await (const update of walker(p)) {
        seenUris.add(update.uri);
        yield update;
      }
    };

    // Run the normal scan
    yield* super.scan(trackingSource, params);

    // Detect removed files — entries in store not seen during this scan
    for await (const existing of this.store.list()) {
      if (existing.removed) continue;
      if (seenUris.has(existing.uri)) continue;
      // Not seen — mark as removed
      for await (const _ of this.store.remove({ uri: existing.uri })) {
        // consumed
      }
    }

    await this.store.setLastScan(scanTime);
  }

  /** Start periodic scanning. */
  start(): void {
    this.stop();
    this.stopped = false;
    const doScan = async () => {
      if (this.running || this.stopped) return;
      this.running = true;
      try {
        for await (const _ of this.scan()) {
          if (this.stopped) break;
        }
      } finally {
        this.running = false;
      }
      if (!this.stopped && this.intervalMs > 0) {
        this.timer = setTimeout(doScan, this.intervalMs);
      }
    };
    void doScan();
  }

  /** Stop periodic scanning. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

async function firstOrUndefined<T>(gen: AsyncIterable<T>): Promise<T | undefined> {
  for await (const item of gen) return item;
  return undefined;
}
