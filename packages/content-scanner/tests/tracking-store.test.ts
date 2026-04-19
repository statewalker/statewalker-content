import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { TrackingStore } from "../src/tracking-store.js";
import type { FileMetadata } from "../src/types.js";

function makeMeta(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    uri: "col1:/root/file.txt",
    collectionId: "col1",
    path: "/root/file.txt",
    hash: "abc123",
    size: 100,
    lastModified: 1000,
    scanTime: "2026-01-01T00:00:00.000Z",
    removalTime: null,
    ...overrides,
  };
}

describe("TrackingStore", () => {
  let files: MemFilesApi;
  let store: TrackingStore;

  beforeEach(() => {
    files = new MemFilesApi();
    store = new TrackingStore(files, "cs");
  });

  describe("pathFor", () => {
    it("produces correct format with two-char prefix directory", async () => {
      const path = await store.pathFor("col1:/root/file.txt");
      expect(path).toMatch(/^cs\/tracking\/[0-9a-f]{2}\/[0-9a-f]+\.json$/);
    });
  });

  describe("get", () => {
    it("returns undefined for non-existent URI", async () => {
      const result = await store.get({ uri: "col1:/no-such-file" });
      expect(result).toBeUndefined();
    });
  });

  describe("set + get round-trip", () => {
    it("stores and retrieves metadata", async () => {
      const meta = makeMeta();
      await store.set({ metadata: meta });
      const result = await store.get({ uri: meta.uri });
      expect(result).toEqual(meta);
    });
  });

  describe("delete", () => {
    it("removes an entry", async () => {
      const meta = makeMeta();
      await store.set({ metadata: meta });
      const deleted = await store.delete({ uri: meta.uri });
      expect(deleted).toBe(true);
      const result = await store.get({ uri: meta.uri });
      expect(result).toBeUndefined();
    });

    it("returns false for non-existent URI", async () => {
      const deleted = await store.delete({ uri: "col1:/nothing" });
      expect(deleted).toBe(false);
    });
  });

  describe("listAll", () => {
    it("iterates all entries", async () => {
      await store.set({
        metadata: makeMeta({ uri: "col1:/a.txt", path: "/a.txt" }),
      });
      await store.set({
        metadata: makeMeta({ uri: "col1:/b.txt", path: "/b.txt" }),
      });
      await store.set({
        metadata: makeMeta({
          uri: "col2:/c.txt",
          path: "/c.txt",
          collectionId: "col2",
        }),
      });

      const all: FileMetadata[] = [];
      for await (const meta of store.listAll()) {
        all.push(meta);
      }
      expect(all).toHaveLength(3);
    });
  });

  describe("listByCollection", () => {
    it("filters by collection ID", async () => {
      await store.set({
        metadata: makeMeta({ uri: "col1:/a.txt", path: "/a.txt" }),
      });
      await store.set({
        metadata: makeMeta({
          uri: "col2:/b.txt",
          path: "/b.txt",
          collectionId: "col2",
        }),
      });

      const col1: FileMetadata[] = [];
      for await (const meta of store.listByCollection({
        collectionId: "col1",
      })) {
        col1.push(meta);
      }
      expect(col1).toHaveLength(1);
      expect(col1[0]?.collectionId).toBe("col1");
    });
  });

  describe("deleteByCollection", () => {
    it("removes all entries for a collection", async () => {
      await store.set({
        metadata: makeMeta({ uri: "col1:/a.txt", path: "/a.txt" }),
      });
      await store.set({
        metadata: makeMeta({ uri: "col1:/b.txt", path: "/b.txt" }),
      });
      await store.set({
        metadata: makeMeta({
          uri: "col2:/c.txt",
          path: "/c.txt",
          collectionId: "col2",
        }),
      });

      const count = await store.deleteByCollection({ collectionId: "col1" });
      expect(count).toBe(2);

      const remaining: FileMetadata[] = [];
      for await (const meta of store.listAll()) {
        remaining.push(meta);
      }
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.collectionId).toBe("col2");
    });
  });

  describe("deleteRemovedBefore", () => {
    it("only removes entries marked as removed before the threshold", async () => {
      await store.set({
        metadata: makeMeta({
          uri: "col1:/old.txt",
          path: "/old.txt",
          removalTime: "2025-01-01T00:00:00.000Z",
        }),
      });
      await store.set({
        metadata: makeMeta({
          uri: "col1:/recent.txt",
          path: "/recent.txt",
          removalTime: "2026-06-01T00:00:00.000Z",
        }),
      });
      await store.set({
        metadata: makeMeta({
          uri: "col1:/active.txt",
          path: "/active.txt",
          removalTime: null,
        }),
      });

      const count = await store.deleteRemovedBefore({
        before: "2026-01-01T00:00:00.000Z",
      });
      expect(count).toBe(1);

      const remaining: FileMetadata[] = [];
      for await (const meta of store.listAll()) {
        remaining.push(meta);
      }
      expect(remaining).toHaveLength(2);
    });
  });
});
