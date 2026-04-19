import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { FilesScanRegistry } from "../src/files-scan-registry.js";
import type { ScanStore, Update } from "../src/scan-store.js";
import { Scanner } from "../src/scanner.js";
import { collect, makeSource } from "./test-helpers.js";

/** Concrete test scanner that uppercases content metadata. */
class TestScanner extends Scanner {
  removedUris: string[] = [];

  async processEntry(upstream: Update): Promise<Update | null> {
    const text = upstream.meta?.text;
    if (typeof text !== "string") return null;
    return {
      uri: upstream.uri,
      stamp: upstream.stamp,
      meta: { text: text.toUpperCase() },
    };
  }

  async removeEntry(uri: string): Promise<void> {
    this.removedUris.push(uri);
  }
}

/** Concrete test scanner that throws on specific URIs. */
class FailingScanner extends Scanner {
  async processEntry(upstream: Update): Promise<Update | null> {
    if (upstream.uri === "/fail.txt") {
      throw new Error("processing failed");
    }
    return { uri: upstream.uri, stamp: upstream.stamp };
  }

  async removeEntry(_uri: string): Promise<void> {}
}

describe("Scanner", () => {
  let files: MemFilesApi;
  let registry: FilesScanRegistry;
  let store: ScanStore;

  beforeEach(async () => {
    files = new MemFilesApi();
    registry = new FilesScanRegistry({ files, prefix: "scan" });
    store = await registry.createStore("test");
  });

  describe("scan processes upstream entries", () => {
    it("calls processEntry for each upstream entry", async () => {
      const scanner = new TestScanner(store);
      const source = makeSource([
        {
          uri: "/a.txt",
          stamp: new Date("2026-04-01T00:00:00Z"),
          meta: { text: "hello" },
        },
        {
          uri: "/b.txt",
          stamp: new Date("2026-04-01T00:00:00Z"),
          meta: { text: "world" },
        },
      ]);

      await collect(scanner.scan(source));

      const stored = await collect(store.list());
      expect(stored).toHaveLength(2);
      const uris = stored.map((s) => s.uri).sort();
      expect(uris).toEqual(["/a.txt", "/b.txt"]);

      const a = stored.find((s) => s.uri === "/a.txt");
      expect(a?.meta?.text).toBe("HELLO");
    });

    it("skips entries when processEntry returns null", async () => {
      const scanner = new TestScanner(store);
      const source = makeSource([
        {
          uri: "/a.txt",
          stamp: new Date("2026-04-01T00:00:00Z"),
          meta: { text: "hello" },
        },
        {
          uri: "/b.txt",
          stamp: new Date("2026-04-01T00:00:00Z"),
          meta: { noText: true },
        },
      ]);

      await collect(scanner.scan(source));

      const stored = await collect(store.list());
      expect(stored).toHaveLength(1);
      expect(stored.find((s) => s.uri === "/a.txt")).toBeDefined();
    });
  });

  describe("scan handles removals", () => {
    it("calls removeEntry for soft-deleted upstream entries", async () => {
      const scanner = new TestScanner(store);

      // First store something
      const source1 = makeSource([
        {
          uri: "/a.txt",
          stamp: new Date("2026-04-01T00:00:00Z"),
          meta: { text: "hello" },
        },
      ]);
      await collect(scanner.scan(source1));

      // Then send removal
      const source2 = makeSource([
        {
          uri: "/a.txt",
          stamp: new Date("2026-04-02T00:00:00Z"),
          removed: new Date("2026-04-02T00:00:00Z"),
        },
      ]);
      await collect(scanner.scan(source2));

      expect(scanner.removedUris).toEqual(["/a.txt"]);
    });
  });

  describe("scan yields events", () => {
    it("yields scan-started and scan-done", async () => {
      const scanner = new TestScanner(store);
      const events = await collect(scanner.scan(makeSource([])));

      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("scan-started");
      expect(events[1]?.type).toBe("scan-done");
    });

    it("yields entry-processed for each processed entry", async () => {
      const scanner = new TestScanner(store);
      const source = makeSource([
        {
          uri: "/a.txt",
          stamp: new Date("2026-04-01T00:00:00Z"),
          meta: { text: "hi" },
        },
      ]);

      const events = await collect(scanner.scan(source));
      const processed = events.filter((e) => e.type === "entry-processed");
      expect(processed).toHaveLength(1);
      expect((processed[0] as { uri: string }).uri).toBe("/a.txt");
    });

    it("yields entry-removed for soft-deleted entries", async () => {
      const scanner = new TestScanner(store);
      const source = makeSource([{ uri: "/a.txt", stamp: new Date(), removed: new Date() }]);

      const events = await collect(scanner.scan(source));
      const removed = events.filter((e) => e.type === "entry-removed");
      expect(removed).toHaveLength(1);
    });

    it("yields batch-done after batchSize entries", async () => {
      const scanner = new TestScanner(store, { batchSize: 2 });
      const entries: Update[] = [];
      for (let i = 0; i < 5; i++) {
        entries.push({
          uri: `/file-${i}.txt`,
          stamp: new Date("2026-04-01T00:00:00Z"),
          meta: { text: `content-${i}` },
        });
      }

      const events = await collect(scanner.scan(makeSource(entries)));
      const batches = events.filter((e) => e.type === "batch-done");
      expect(batches).toHaveLength(2); // at 2 and 4
    });
  });

  describe("error handling", () => {
    it("continues processing after entry error", async () => {
      const scanner = new FailingScanner(store);
      const source = makeSource([
        { uri: "/ok.txt", stamp: new Date("2026-04-01T00:00:00Z") },
        { uri: "/fail.txt", stamp: new Date("2026-04-01T00:00:00Z") },
        { uri: "/ok2.txt", stamp: new Date("2026-04-01T00:00:00Z") },
      ]);

      const events = await collect(scanner.scan(source));
      const errors = events.filter((e) => e.type === "entry-error");
      const processed = events.filter((e) => e.type === "entry-processed");

      expect(errors).toHaveLength(1);
      expect(processed).toHaveLength(2);
    });

    it("includes error count in scan-done stats", async () => {
      const scanner = new FailingScanner(store);
      const source = makeSource([
        { uri: "/fail.txt", stamp: new Date("2026-04-01T00:00:00Z") },
        { uri: "/ok.txt", stamp: new Date("2026-04-01T00:00:00Z") },
      ]);

      const events = await collect(scanner.scan(source));
      const done = events.find((e) => e.type === "scan-done");
      expect(done?.type).toBe("scan-done");
      if (done?.type === "scan-done") {
        expect(done.stats.errors).toBe(1);
        expect(done.stats.processed).toBe(1);
      }
    });
  });

  describe("lastScan update", () => {
    it("updates store lastScan after scan completes", async () => {
      const scanner = new TestScanner(store);
      await collect(scanner.scan(makeSource([])));

      const lastScan = await store.getLastScan();
      expect(lastScan).toBeInstanceOf(Date);
    });
  });
});
