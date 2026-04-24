import { describe, expect, it } from "vitest";
import {
  createStampAllocator,
  type StampListener,
  type Store,
  type StoreWrite,
  type Unsubscribe,
} from "../src/store.js";
import { runTracker } from "../src/tracker.js";
import type { Entry, Transform } from "../src/types.js";

/** Minimal in-memory Store used by these tests. Orders entries by insertion stamp. */
class MemStore<E extends Entry> implements Store<E> {
  private readonly entries = new Map<string, E>();
  private readonly cursors = new Map<string, number>();
  private readonly listeners = new Set<StampListener>();
  private readonly stamps = createStampAllocator();

  async get(uri: string): Promise<E | undefined> {
    return this.entries.get(uri);
  }

  async put(writes: StoreWrite<E>[]): Promise<void> {
    if (writes.length === 0) return;
    let top = 0;
    for (const w of writes) {
      const stamp = this.stamps.next();
      const entry = { ...w, stamp } as E;
      this.entries.set(entry.uri, entry);
      top = stamp;
    }
    for (const listener of this.listeners) listener(top);
  }

  async *since(cursor: number, limit: number): AsyncGenerator<E> {
    const sorted = [...this.entries.values()]
      .filter((e) => e.stamp > cursor)
      .sort((a, b) => a.stamp - b.stamp);
    for (let i = 0; i < Math.min(limit, sorted.length); i++) {
      yield sorted[i] as E;
    }
  }

  async cursor(name: string): Promise<number> {
    return this.cursors.get(name) ?? 0;
  }

  async advance(name: string, stamp: number): Promise<void> {
    this.cursors.set(name, stamp);
  }

  onStampUpdate(listener: StampListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.listeners.clear();
  }

  /** Test helper: snapshot live + tombstone entries. */
  all(): E[] {
    return [...this.entries.values()].sort((a, b) => a.stamp - b.stamp);
  }
}

type TxtMeta = { text: string };
type TxtEntry = Entry<TxtMeta>;

const identityUpper: Transform<TxtEntry, TxtEntry> = async (up) => {
  if (!up.meta) return null;
  return { uri: up.uri, meta: { text: up.meta.text.toUpperCase() } };
};

const waitFor = async (
  predicate: () => boolean,
  { timeoutMs = 1000, intervalMs = 5 } = {},
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
};

describe("runTracker", () => {
  it("catches up from cursor N, processing entries in batches of batchSize", async () => {
    const upstream = new MemStore<TxtEntry>();
    const own = new MemStore<TxtEntry>();
    await upstream.put(
      Array.from({ length: 10 }, (_, i) => ({ uri: `f${i}`, meta: { text: `x${i}` } })),
    );

    const tracker = runTracker(upstream, own, identityUpper, {
      name: "t",
      batchSize: 3,
      pauseMs: 0,
    });
    try {
      const processed = await tracker.catchUp();
      expect(processed).toBe(10);
      expect(own.all().map((e) => e.meta?.text)).toEqual([
        "X0",
        "X1",
        "X2",
        "X3",
        "X4",
        "X5",
        "X6",
        "X7",
        "X8",
        "X9",
      ]);
      const topUpstream = Math.max(...upstream.all().map((e) => e.stamp));
      expect(await upstream.cursor("t")).toBe(topUpstream);
    } finally {
      await tracker.close();
    }
  });

  it("rebuilds from scratch when cursor is reset to 0", async () => {
    const upstream = new MemStore<TxtEntry>();
    const own = new MemStore<TxtEntry>();
    await upstream.put([
      { uri: "a", meta: { text: "a" } },
      { uri: "b", meta: { text: "b" } },
    ]);

    const tracker = runTracker(upstream, own, identityUpper, { name: "t", pauseMs: 0 });
    try {
      await tracker.catchUp();
      expect(own.all().length).toBe(2);

      await upstream.advance("t", 0);
      const processed = await tracker.catchUp();
      expect(processed).toBe(2);
      // Own store now contains two generations (original + rebuilt) keyed by same URI;
      // last write wins per URI.
      expect(own.all().length).toBe(2);
    } finally {
      await tracker.close();
    }
  });

  it("cascades via runtime notifications (no manual catchUp call)", async () => {
    const upstream = new MemStore<TxtEntry>();
    const own = new MemStore<TxtEntry>();
    const tracker = runTracker(upstream, own, identityUpper, { name: "t", pauseMs: 0 });
    try {
      await upstream.put([{ uri: "a", meta: { text: "a" } }]);
      await waitFor(() => own.all().length === 1);
      expect(own.all()[0]?.meta?.text).toBe("A");

      await upstream.put([{ uri: "b", meta: { text: "b" } }]);
      await waitFor(() => own.all().length === 2);
    } finally {
      await tracker.close();
    }
  });

  it("propagates tombstones without invoking the transform", async () => {
    const upstream = new MemStore<TxtEntry>();
    const own = new MemStore<TxtEntry>();
    let transformCalls = 0;
    const spy: Transform<TxtEntry, TxtEntry> = async (up) => {
      transformCalls += 1;
      if (!up.meta) return null;
      return { uri: up.uri, meta: { text: up.meta.text } };
    };

    // Live entry for "a" is processed; later the tombstone replaces it upstream.
    await upstream.put([{ uri: "a", meta: { text: "a" } }]);
    const tracker = runTracker(upstream, own, spy, { name: "t", pauseMs: 0 });
    try {
      await tracker.catchUp();
      expect(transformCalls).toBe(1);
      expect(own.all().at(-1)?.meta?.text).toBe("a");

      // Second put replaces "a" with a tombstone in the manifest-style upstream.
      await upstream.put([{ uri: "a", tombstone: true }]);
      const before = transformCalls;
      await tracker.catchUp();
      // Transform NOT invoked for the tombstone — no additional calls.
      expect(transformCalls).toBe(before);
      expect(own.all().at(-1)?.tombstone).toBe(true);
      expect(own.all().at(-1)?.meta).toBeUndefined();
    } finally {
      await tracker.close();
    }
  });

  it("accepts transform-emitted tombstones", async () => {
    const upstream = new MemStore<TxtEntry>();
    const own = new MemStore<TxtEntry>();
    const maybeTombstone: Transform<TxtEntry, TxtEntry> = async (up) => {
      if (up.meta?.text === "drop") return { uri: up.uri, tombstone: true };
      return { uri: up.uri, meta: { text: up.meta?.text ?? "" } };
    };

    await upstream.put([
      { uri: "a", meta: { text: "a" } },
      { uri: "b", meta: { text: "drop" } },
    ]);

    const tracker = runTracker(upstream, own, maybeTombstone, { name: "t", pauseMs: 0 });
    try {
      await tracker.catchUp();
      const byUri = new Map(own.all().map((e) => [e.uri, e]));
      expect(byUri.get("a")?.meta?.text).toBe("a");
      expect(byUri.get("b")?.tombstone).toBe(true);
      expect(byUri.get("b")?.meta).toBeUndefined();
    } finally {
      await tracker.close();
    }
  });

  it("coalesces notifications that arrive during a drain", async () => {
    const upstream = new MemStore<TxtEntry>();
    const own = new MemStore<TxtEntry>();
    let drainStarts = 0;
    const slow: Transform<TxtEntry, TxtEntry> = async (up) => {
      drainStarts += 1;
      await new Promise((r) => setTimeout(r, 5));
      return { uri: up.uri, meta: { text: up.meta?.text ?? "" } };
    };

    const tracker = runTracker(upstream, own, slow, {
      name: "t",
      batchSize: 1,
      pauseMs: 0,
    });
    try {
      await upstream.put([{ uri: "a", meta: { text: "a" } }]);
      // Fire more writes while the first drain is still running.
      await upstream.put([{ uri: "b", meta: { text: "b" } }]);
      await upstream.put([{ uri: "c", meta: { text: "c" } }]);
      await waitFor(() => own.all().length === 3);
      // drainStarts equals the number of entries processed (one transform call each),
      // not the number of notifications fired — coalescing means we don't spawn one
      // drain per notification.
      expect(drainStarts).toBe(3);
    } finally {
      await tracker.close();
    }
  });

  it("aborts mid-drain at the next entry without committing the partial batch", async () => {
    const upstream = new MemStore<TxtEntry>();
    const own = new MemStore<TxtEntry>();
    const ctrl = new AbortController();
    const slow: Transform<TxtEntry, TxtEntry> = async (up) => {
      if (up.uri === "b") ctrl.abort();
      return { uri: up.uri, meta: { text: up.meta?.text ?? "" } };
    };

    await upstream.put([
      { uri: "a", meta: { text: "a" } },
      { uri: "b", meta: { text: "b" } },
      { uri: "c", meta: { text: "c" } },
    ]);

    const tracker = runTracker(upstream, own, slow, {
      name: "t",
      batchSize: 10,
      pauseMs: 0,
      signal: ctrl.signal,
    });
    try {
      await tracker.catchUp();
      // Abort fired mid-batch — no entries from the aborted batch were committed.
      expect(own.all().length).toBe(0);
      // Cursor did not advance.
      expect(await upstream.cursor("t")).toBe(0);
    } finally {
      await tracker.close();
    }
  });

  it("isolates per-URI errors as meta.error, advancing the cursor past them", async () => {
    const upstream = new MemStore<TxtEntry>();
    const own = new MemStore<Entry<{ text?: string; error?: string }>>();
    const flaky: Transform<TxtEntry, Entry<{ text?: string; error?: string }>> = async (up) => {
      if (up.uri === "bad") throw new Error("boom");
      return { uri: up.uri, meta: { text: up.meta?.text ?? "" } };
    };

    await upstream.put([
      { uri: "a", meta: { text: "a" } },
      { uri: "bad", meta: { text: "x" } },
      { uri: "c", meta: { text: "c" } },
    ]);

    const tracker = runTracker(upstream, own, flaky, { name: "t", pauseMs: 0 });
    try {
      await tracker.catchUp();
      const byUri = new Map(own.all().map((e) => [e.uri, e]));
      expect(byUri.get("a")?.meta?.text).toBe("a");
      expect(byUri.get("c")?.meta?.text).toBe("c");
      expect(byUri.get("bad")?.meta?.error).toBe("boom");
      const topUpstream = Math.max(...upstream.all().map((e) => e.stamp));
      expect(await upstream.cursor("t")).toBe(topUpstream);
    } finally {
      await tracker.close();
    }
  });
});
