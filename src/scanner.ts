import type { ListParams, ScanStore, Stamp, Update } from "./scan-store.js";

/** The upstream data source — typically an upstream store's `list` method. */
export type UpdateSource = (
  params?: ListParams,
) => Generator<Update> | AsyncGenerator<Update>;

/** Statistics for a completed scan. */
export type ScanStats = {
  processed: number;
  removed: number;
  errors: number;
};

/** Lifecycle events emitted by a scanner during `scan()`. */
export type ScannerEvent =
  | { type: "scan-started"; stamp: Stamp }
  | { type: "batch-done"; processed: number; stamp: Stamp }
  | { type: "entry-processed"; uri: string }
  | { type: "entry-removed"; uri: string }
  | { type: "entry-error"; uri: string; error: string }
  | { type: "scan-done"; stats: ScanStats };

/** Options for configuring the scanner's batching behavior. */
export type ScannerOptions = {
  /** Yield `batch-done` every N entries. Default: 50. */
  batchSize?: number;
};

/**
 * Abstract base class for pull-based scanners.
 *
 * Each scanner owns a `ScanStore`, pulls upstream data via an `UpdateSource`,
 * processes entries through subclass-defined methods, and yields lifecycle events.
 * Scanners are wired together by an orchestrator — they have no knowledge of
 * downstream consumers.
 */
export abstract class Scanner {
  readonly store: ScanStore;
  private readonly batchSize: number;

  constructor(store: ScanStore, options?: ScannerOptions) {
    this.store = store;
    this.batchSize = options?.batchSize ?? 50;
  }

  /**
   * Process an upstream entry and return the update to store,
   * or `null` to skip this entry.
   */
  abstract processEntry(upstream: Update): Promise<Update | null>;

  /** Clean up data for a removed URI. */
  abstract removeEntry(uri: string): Promise<void>;

  /**
   * Pull entries from the upstream source, process each one, store results,
   * and yield lifecycle events. On completion, updates this store's `lastScan`.
   */
  async *scan(
    source: UpdateSource,
    params?: ListParams,
  ): AsyncGenerator<ScannerEvent> {
    const scanTime = new Date();
    yield { type: "scan-started", stamp: scanTime };

    const stats: ScanStats = { processed: 0, removed: 0, errors: 0 };
    let batchCount = 0;

    for await (const upstream of source(params)) {
      const uri = upstream.uri;

      if (upstream.removed) {
        // Upstream entry was soft-deleted — cascade removal
        try {
          await this.removeEntry(uri);
          for await (const _ of this.store.remove({ uri })) {
            // consumed
          }
          stats.removed++;
          yield { type: "entry-removed", uri };
        } catch (err) {
          stats.errors++;
          yield { type: "entry-error", uri, error: String(err) };
        }
      } else {
        // Process the entry
        try {
          const result = await this.processEntry(upstream);
          if (result) {
            const toStore = { ...result, stamp: scanTime } satisfies Update;
            // Consume the store generator to persist the entry
            for await (const _ of this.store.store([toStore])) {
              // consumed
            }
            stats.processed++;
            yield { type: "entry-processed", uri };
          }
        } catch (err) {
          stats.errors++;
          yield { type: "entry-error", uri, error: String(err) };
        }
      }

      batchCount++;
      if (batchCount % this.batchSize === 0) {
        yield { type: "batch-done", processed: batchCount, stamp: scanTime };
      }
    }

    await this.store.setLastScan(scanTime);
    yield { type: "scan-done", stats };
  }
}
