import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { FilesScanStore } from "../src/files-scan-store.js";
import type { Update } from "../src/scan-store.js";
import { at, collect, contentOf, makeUpdate } from "./test-helpers.js";

describe("FilesScanStore", () => {
  let files: MemFilesApi;
  let store: FilesScanStore;

  beforeEach(() => {
    files = new MemFilesApi();
    store = new FilesScanStore("test", files, "scan/test");
  });

  describe("store + list round-trip", () => {
    it("stores and retrieves entries", async () => {
      const input = makeUpdate({ uri: "/a.txt" });
      await collect(store.store([input]));

      const results = await collect(store.list());
      expect(results).toHaveLength(1);
      const entry = at(results, 0);
      expect(entry.uri).toBe("/a.txt");
      expect(entry.stamp.getTime()).toBe(input.stamp.getTime());
    });

    it("stores multiple entries", async () => {
      const inputs = [
        makeUpdate({ uri: "/a.txt" }),
        makeUpdate({ uri: "/b.txt" }),
        makeUpdate({ uri: "/c.txt" }),
      ];
      await collect(store.store(inputs));

      const results = await collect(store.list());
      expect(results).toHaveLength(3);
    });

    it("preserves metadata", async () => {
      const input = makeUpdate({
        uri: "/a.txt",
        meta: { size: 100, format: "markdown" },
      });
      await collect(store.store([input]));

      const results = await collect(store.list());
      expect(at(results, 0).meta).toEqual({ size: 100, format: "markdown" });
    });

    it("yields stored entries back", async () => {
      const input = makeUpdate({ uri: "/a.txt" });
      const yielded = await collect(store.store([input]));
      expect(yielded).toHaveLength(1);
      expect(at(yielded, 0).uri).toBe("/a.txt");
    });
  });

  describe("binary content", () => {
    it("stores and lazily reads binary content", async () => {
      const bytes = new TextEncoder().encode("hello world");
      const input: Update = {
        uri: "/a.txt",
        stamp: new Date("2026-04-01T00:00:00Z"),
        async *content() {
          yield bytes;
        },
      };
      await collect(store.store([input]));

      const entry = at(await collect(store.list()), 0);
      expect(entry.content).toBeDefined();
      const chunks = await collect(contentOf(entry));
      const text = new TextDecoder().decode(at(chunks, 0));
      expect(text).toBe("hello world");
    });

    it("content() is callable multiple times", async () => {
      const bytes = new TextEncoder().encode("data");
      const input: Update = {
        uri: "/a.txt",
        stamp: new Date("2026-04-01T00:00:00Z"),
        async *content() {
          yield bytes;
        },
      };
      await collect(store.store([input]));

      const entry = at(await collect(store.list()), 0);
      const firstRead = await collect(contentOf(entry));
      const secondRead = await collect(contentOf(entry));
      expect(firstRead).toHaveLength(1);
      expect(secondRead).toHaveLength(1);
    });

    it("entries without content have empty content generator", async () => {
      await collect(store.store([makeUpdate({ uri: "/a.txt" })]));
      const entry = at(await collect(store.list()), 0);
      const chunks = await collect(contentOf(entry));
      expect(chunks).toHaveLength(0);
    });
  });

  describe("Date serialization round-trip", () => {
    it("stamp is deserialized as Date", async () => {
      const stamp = new Date("2026-04-01T12:30:00.000Z");
      await collect(store.store([makeUpdate({ uri: "/a.txt", stamp })]));

      const entry = at(await collect(store.list()), 0);
      expect(entry.stamp).toBeInstanceOf(Date);
      expect(entry.stamp.getTime()).toBe(stamp.getTime());
    });

    it("removed timestamp is deserialized as Date", async () => {
      const removed = new Date("2026-04-02T00:00:00Z");
      await collect(store.store([makeUpdate({ uri: "/a.txt", removed })]));

      const entry = at(await collect(store.list()), 0);
      expect(entry.removed).toBeInstanceOf(Date);
      expect(entry.removed?.getTime()).toBe(removed.getTime());
    });
  });

  describe("list filtering", () => {
    beforeEach(async () => {
      const entries = [
        makeUpdate({
          uri: "/docs/readme.md",
          stamp: new Date("2026-04-01T00:00:00Z"),
        }),
        makeUpdate({
          uri: "/docs/guide.md",
          stamp: new Date("2026-04-02T00:00:00Z"),
        }),
        makeUpdate({
          uri: "/src/index.ts",
          stamp: new Date("2026-04-01T00:00:00Z"),
        }),
        makeUpdate({
          uri: "/src/utils.ts",
          stamp: new Date("2026-04-03T00:00:00Z"),
        }),
      ];
      await collect(store.store(entries));
    });

    it("filters by URI prefix", async () => {
      const results = await collect(store.list({ uri: "/docs/*" }));
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.uri.startsWith("/docs/"))).toBe(true);
    });

    it("filters by exact URI", async () => {
      const results = await collect(store.list({ uri: "/docs/readme.md" }));
      expect(results).toHaveLength(1);
      expect(at(results, 0).uri).toBe("/docs/readme.md");
    });

    it("filters by include exact stamp", async () => {
      const results = await collect(store.list({ include: new Date("2026-04-01T00:00:00Z") }));
      expect(results).toHaveLength(2);
    });

    it("filters by exclude exact stamp", async () => {
      const results = await collect(store.list({ exclude: new Date("2026-04-01T00:00:00Z") }));
      expect(results).toHaveLength(2);
      const t = new Date("2026-04-01T00:00:00Z").getTime();
      expect(results.every((r) => r.stamp.getTime() !== t)).toBe(true);
    });

    it("filters by include stamp range", async () => {
      const results = await collect(
        store.list({
          include: [new Date("2026-04-01T00:00:00Z"), new Date("2026-04-02T00:00:00Z")],
        }),
      );
      expect(results).toHaveLength(3);
    });

    it("filters by exclude stamp range", async () => {
      const results = await collect(
        store.list({
          exclude: [new Date("2026-04-01T00:00:00Z"), new Date("2026-04-02T00:00:00Z")],
        }),
      );
      expect(results).toHaveLength(1);
      expect(at(results, 0).uri).toBe("/src/utils.ts");
    });

    it("combines URI and stamp filters", async () => {
      const results = await collect(
        store.list({
          uri: "/docs/*",
          include: new Date("2026-04-01T00:00:00Z"),
        }),
      );
      expect(results).toHaveLength(1);
      expect(at(results, 0).uri).toBe("/docs/readme.md");
    });
  });

  describe("soft delete", () => {
    it("marks entries as removed", async () => {
      await collect(store.store([makeUpdate({ uri: "/a.txt" })]));
      const removed = await collect(store.remove({ uri: "/a.txt" }));
      expect(removed).toHaveLength(1);
      expect(at(removed, 0).removed).toBeInstanceOf(Date);
    });

    it("soft-deleted entries are visible in list()", async () => {
      await collect(store.store([makeUpdate({ uri: "/a.txt" })]));
      await collect(store.remove({ uri: "/a.txt" }));

      const results = await collect(store.list());
      expect(results).toHaveLength(1);
      expect(at(results, 0).removed).toBeDefined();
    });

    it("does not re-remove already removed entries", async () => {
      await collect(store.store([makeUpdate({ uri: "/a.txt" })]));
      await collect(store.remove({ uri: "/a.txt" }));
      const secondRemove = await collect(store.remove({ uri: "/a.txt" }));
      expect(secondRemove).toHaveLength(0);
    });

    it("removes by URI prefix", async () => {
      await collect(
        store.store([
          makeUpdate({ uri: "/docs/a.md" }),
          makeUpdate({ uri: "/docs/b.md" }),
          makeUpdate({ uri: "/src/c.ts" }),
        ]),
      );
      const removed = await collect(store.remove({ uri: "/docs/*" }));
      expect(removed).toHaveLength(2);

      const results = await collect(store.list());
      const active = results.filter((r) => !r.removed);
      expect(active).toHaveLength(1);
      expect(at(active, 0).uri).toBe("/src/c.ts");
    });
  });

  describe("prune", () => {
    it("physically deletes old soft-removed entries", async () => {
      await collect(
        store.store([
          makeUpdate({
            uri: "/old.txt",
            removed: new Date("2025-01-01T00:00:00Z"),
          }),
          makeUpdate({
            uri: "/recent.txt",
            removed: new Date("2026-06-01T00:00:00Z"),
          }),
          makeUpdate({ uri: "/active.txt" }),
        ]),
      );

      const count = await store.prune(new Date("2026-01-01T00:00:00Z"));
      expect(count).toBe(1);

      const results = await collect(store.list());
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.uri).sort()).toEqual(["/active.txt", "/recent.txt"]);
    });
  });

  describe("lastScan", () => {
    it("returns null initially", async () => {
      expect(await store.getLastScan()).toBeNull();
    });

    it("persists and retrieves lastScan", async () => {
      const stamp = new Date("2026-04-04T12:00:00Z");
      await store.setLastScan(stamp);
      const result = await store.getLastScan();
      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBe(stamp.getTime());
    });

    it("survives re-creation with same files", async () => {
      const stamp = new Date("2026-04-04T12:00:00Z");
      await store.setLastScan(stamp);

      const store2 = new FilesScanStore("test", files, "scan/test");
      const result = await store2.getLastScan();
      expect(result?.getTime()).toBe(stamp.getTime());
    });
  });

  describe("rebuildIndex", () => {
    it("reconstructs index from entry files", async () => {
      await collect(store.store([makeUpdate({ uri: "/a.txt" }), makeUpdate({ uri: "/b.txt" })]));

      // Corrupt the index by removing it
      await files.remove("scan/test/_index.json");

      // Rebuild
      const store2 = new FilesScanStore("test", files, "scan/test");
      await store2.rebuildIndex();

      const results = await collect(store2.list());
      expect(results).toHaveLength(2);
    });
  });
});
