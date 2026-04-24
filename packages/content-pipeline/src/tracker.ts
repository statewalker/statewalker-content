import type { Store, StoreWrite } from "./store.js";
import type { Entry, Transform } from "./types.js";

export type RunTrackerOptions = {
  /** Listener name — identifies this tracker's cursor on the upstream store. */
  name: string;
  /** Entries per batch; a sleep is inserted between batches. Default: 50. */
  batchSize?: number;
  /** Milliseconds to sleep between batches, yielding to the event loop. Default: 10. */
  pauseMs?: number;
  /** Aborts the drain at the next batch boundary without committing a partial batch. */
  signal?: AbortSignal;
  /**
   * Side-effect hook invoked once per upstream tombstone, before the tombstone is
   * written downstream. Indexer trackers use this to delete documents from the
   * search index. The transform function is still NOT called for tombstones.
   */
  onRemove?: (uri: string) => Promise<void> | void;
};

export type Tracker = {
  /** Drain all upstream entries newer than the persisted cursor. */
  catchUp(): Promise<number>;
  /** Request a drain; coalesces with any in-progress one. */
  kick(): void;
  /** Unsubscribe from upstream notifications. Does not close stores. */
  close(): Promise<void>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drive a single layer. Subscribes to `upstream.onStampUpdate` and drains
 * upstream entries into `own` via `transform` in batches with `pauseMs`
 * between batches. Per-URI errors are caught and recorded as `meta.error`
 * so one bad entry doesn't stall the cursor.
 */
export function runTracker<U extends Entry, D extends Entry>(
  upstream: Store<U>,
  own: Store<D>,
  transform: Transform<U, D>,
  opts: RunTrackerOptions,
): Tracker {
  const batchSize = opts.batchSize ?? 50;
  const pauseMs = opts.pauseMs ?? 10;
  const signal = opts.signal;
  const onRemove = opts.onRemove;

  let pending = false;
  let inFlight: Promise<number> | null = null;

  async function drainBatch(): Promise<number> {
    const cursor = await upstream.cursor(opts.name);
    const buf: StoreWrite<D>[] = [];
    let lastStamp = cursor;
    let count = 0;

    for await (const up of upstream.since(cursor, batchSize)) {
      if (signal?.aborted) return 0;

      if (up.tombstone) {
        if (onRemove) {
          try {
            await onRemove(up.uri);
          } catch {
            // Swallow onRemove errors; the tombstone still propagates downstream.
          }
        }
        buf.push({ uri: up.uri, tombstone: true } as StoreWrite<D>);
      } else {
        try {
          const out = await transform(up);
          if (out) buf.push(out);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          buf.push({ uri: up.uri, meta: { error: message } } as unknown as StoreWrite<D>);
        }
      }

      lastStamp = Math.max(lastStamp, up.stamp);
      count += 1;
    }

    if (count === 0) return 0;
    await own.put(buf);
    await upstream.advance(opts.name, lastStamp);
    return count;
  }

  async function drain(): Promise<number> {
    let total = 0;
    while (!signal?.aborted) {
      const n = await drainBatch();
      if (n === 0) break;
      total += n;
      if (pauseMs > 0) await sleep(pauseMs);
    }
    return total;
  }

  async function loop(): Promise<number> {
    if (inFlight) {
      pending = true;
      // Wait for the running drain to finish; its do-while will re-run
      // because `pending` is now set, so any writes made before this call
      // will be observed by the time we return.
      return inFlight;
    }
    inFlight = (async (): Promise<number> => {
      let total = 0;
      try {
        do {
          pending = false;
          total += await drain();
        } while (pending && !signal?.aborted);
      } finally {
        inFlight = null;
      }
      return total;
    })();
    return inFlight;
  }

  const unsubscribe = upstream.onStampUpdate(() => {
    void loop();
  });

  return {
    catchUp: loop,
    kick: () => {
      void loop();
    },
    close: async () => {
      unsubscribe();
    },
  };
}
