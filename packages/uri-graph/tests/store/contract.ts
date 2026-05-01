import { describe, expect, it } from "vitest";
import type { Resource } from "../../src/index.js";
import type { Store } from "../../src/store/store.js";

export type StoreFactory = () => Promise<{ store: Store; close: () => Promise<void> }>;

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

export function defineStoreContract(name: string, factory: StoreFactory): void {
  describe(`${name} — Store contract`, () => {
    it("mints monotonically increasing stamps", async () => {
      const { store, close } = await factory();
      try {
        const a = await store.newStamp();
        const b = await store.newStamp();
        const c = await store.newStamp();
        expect(a < b).toBe(true);
        expect(b < c).toBe(true);
      } finally {
        await close();
      }
    });

    it("put + get returns the latest event for a uri", async () => {
      const { store, close } = await factory();
      try {
        await store.put({ uri: "file://a", stamp: 1, status: "added" });
        await store.put({ uri: "file://a", stamp: 5, status: "updated", meta: { size: 10 } });
        const r = await store.get("file://a");
        expect(r?.stamp).toBe(5);
        expect(r?.status).toBe("updated");
        expect((r?.meta as { size: number }).size).toBe(10);
      } finally {
        await close();
      }
    });

    it("get returns undefined for unknown uri", async () => {
      const { store, close } = await factory();
      try {
        expect(await store.get("file://missing")).toBeUndefined();
      } finally {
        await close();
      }
    });

    it("list filters by prefix and returns latest event per uri sorted by stamp", async () => {
      const { store, close } = await factory();
      try {
        await store.put({ uri: "file://a", stamp: 1, status: "added" });
        await store.put({ uri: "file://b", stamp: 2, status: "added" });
        await store.put({ uri: "text://a", stamp: 3, status: "added" });
        await store.put({ uri: "file://a", stamp: 4, status: "updated" });

        const files = await collect(store.list({ prefix: "file://" }));
        expect(files.map((r) => r.uri)).toEqual(["file://b", "file://a"]);
        expect(files.find((r) => r.uri === "file://a")?.stamp).toBe(4);

        const texts = await collect(store.list({ prefix: "text://" }));
        expect(texts.map((r) => r.uri)).toEqual(["text://a"]);
      } finally {
        await close();
      }
    });

    it("list filters by afterStamp", async () => {
      const { store, close } = await factory();
      try {
        await store.put({ uri: "file://a", stamp: 1, status: "added" });
        await store.put({ uri: "file://b", stamp: 5, status: "added" });
        await store.put({ uri: "file://a", stamp: 10, status: "updated" });

        const after3 = await collect(store.list({ prefix: "file://", afterStamp: 3 }));
        expect(after3.map((r) => r.uri).sort()).toEqual(["file://a", "file://b"]);

        const after7 = await collect(store.list({ prefix: "file://", afterStamp: 7 }));
        expect(after7.map((r) => r.uri)).toEqual(["file://a"]);
      } finally {
        await close();
      }
    });

    it("saves, gets, lists, deletes workers", async () => {
      const { store, close } = await factory();
      try {
        await store.saveWorker({ name: "scanner", selects: "", emits: "file://" });
        await store.saveWorker({ name: "extractor", selects: "file://", emits: "text://" });

        expect((await store.getWorker("scanner"))?.emits).toBe("file://");

        const all = await collect(store.listWorkers());
        expect(all.map((w) => w.name).sort()).toEqual(["extractor", "scanner"]);

        await store.deleteWorker("scanner");
        expect(await store.getWorker("scanner")).toBeUndefined();
      } finally {
        await close();
      }
    });

    it("saveWorker upserts on conflict", async () => {
      const { store, close } = await factory();
      try {
        await store.saveWorker({ name: "w", selects: "a://", emits: "b://" });
        await store.saveWorker({ name: "w", selects: "x://", emits: "y://" });
        const w = await store.getWorker("w");
        expect(w?.selects).toBe("x://");
        expect(w?.emits).toBe("y://");
      } finally {
        await close();
      }
    });

    it("allWatermarks returns max stamp per worker", async () => {
      const { store, close } = await factory();
      try {
        await store.markCompleted("a", 5);
        await store.markCompleted("a", 10);
        await store.markCompleted("a", 7);
        await store.markCompleted("b", 3);

        const wm = await store.allWatermarks();
        expect(wm.get("a")).toBe(10);
        expect(wm.get("b")).toBe(3);
        expect(wm.get("c")).toBeUndefined();
      } finally {
        await close();
      }
    });

    it("invalidate emits 'removed' events for matching uris", async () => {
      const { store, close } = await factory();
      try {
        await store.put({ uri: "text://a", stamp: 1, status: "added" });
        await store.put({ uri: "text://b", stamp: 2, status: "updated" });
        await store.put({ uri: "file://x", stamp: 3, status: "added" });

        await store.invalidate("text://");

        const a = await store.get("text://a");
        const b = await store.get("text://b");
        const x = await store.get("file://x");
        expect(a?.status).toBe("removed");
        expect(b?.status).toBe("removed");
        expect(x?.status).toBe("added");
      } finally {
        await close();
      }
    });

    it("invalidate skips uris that are already removed", async () => {
      const { store, close } = await factory();
      try {
        await store.put({ uri: "text://a", stamp: 1, status: "removed" });

        const wmBefore = await store.newStamp();
        await store.invalidate("text://");
        const r = await store.get("text://a");
        expect(r?.stamp).toBeLessThanOrEqual(wmBefore);
      } finally {
        await close();
      }
    });

    it("purgeResources({ keepLatestPerUri: true }) collapses to one event per uri", async () => {
      const { store, close } = await factory();
      try {
        await store.put({ uri: "file://a", stamp: 1, status: "added" });
        await store.put({ uri: "file://a", stamp: 2, status: "updated" });
        await store.put({ uri: "file://a", stamp: 3, status: "updated" });

        await store.purgeResources({ keepLatestPerUri: true });

        const r = await store.get("file://a");
        expect(r?.stamp).toBe(3);

        const all: Resource[] = await collect(store.list({ prefix: "file://" }));
        expect(all.length).toBe(1);
      } finally {
        await close();
      }
    });

    it("purgeCompletions({ keepLatestPerWorker }) keeps only the N newest", async () => {
      const { store, close } = await factory();
      try {
        for (let s = 1; s <= 5; s++) await store.markCompleted("w", s);
        await store.purgeCompletions({ keepLatestPerWorker: 2 });
        const wm = await store.allWatermarks();
        expect(wm.get("w")).toBe(5);
      } finally {
        await close();
      }
    });
  });
}
