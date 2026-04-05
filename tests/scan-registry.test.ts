import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { FilesScanRegistry } from "../src/files-scan-registry.js";
import type { Update } from "../src/scan-store.js";
import { collect } from "./test-helpers.js";

describe("FilesScanRegistry", () => {
  let files: MemFilesApi;
  let registry: FilesScanRegistry;

  beforeEach(() => {
    files = new MemFilesApi();
    registry = new FilesScanRegistry({ files, prefix: "scan" });
  });

  describe("createStore", () => {
    it("creates a new store", async () => {
      const store = await registry.createStore("files");
      expect(store.name).toBe("files");
    });

    it("throws on duplicate name", async () => {
      await registry.createStore("files");
      await expect(registry.createStore("files")).rejects.toThrow(
        "Store already exists",
      );
    });
  });

  describe("getStore", () => {
    it("returns existing store", async () => {
      await registry.createStore("files");
      const store = await registry.getStore("files");
      expect(store).not.toBeNull();
      expect(store?.name).toBe("files");
    });

    it("returns null for non-existent store", async () => {
      const store = await registry.getStore("unknown");
      expect(store).toBeNull();
    });
  });

  describe("hasStore", () => {
    it("returns true for existing store", async () => {
      await registry.createStore("files");
      expect(await registry.hasStore("files")).toBe(true);
    });

    it("returns false for non-existent store", async () => {
      expect(await registry.hasStore("unknown")).toBe(false);
    });
  });

  describe("getStoreNames", () => {
    it("returns empty array initially", async () => {
      expect(await registry.getStoreNames()).toEqual([]);
    });

    it("returns all store names", async () => {
      await registry.createStore("files");
      await registry.createStore("content");
      await registry.createStore("chunks");
      const names = await registry.getStoreNames();
      expect(names.sort()).toEqual(["chunks", "content", "files"]);
    });
  });

  describe("deleteStore", () => {
    it("removes the store and its data", async () => {
      const store = await registry.createStore("files");
      const update: Update = {
        uri: "/a.txt",
        stamp: new Date("2026-04-01T00:00:00Z"),
      };
      await collect(store.store([update]));

      await registry.deleteStore("files");
      expect(await registry.hasStore("files")).toBe(false);
      expect(await registry.getStore("files")).toBeNull();
    });

    it("throws for non-existent store", async () => {
      await expect(registry.deleteStore("unknown")).rejects.toThrow(
        "Store not found",
      );
    });
  });

  describe("persistence", () => {
    it("stores survive registry re-creation", async () => {
      await registry.createStore("files");
      await registry.createStore("content");

      const registry2 = new FilesScanRegistry({ files, prefix: "scan" });
      const names = await registry2.getStoreNames();
      expect(names.sort()).toEqual(["content", "files"]);
    });

    it("store data survives registry re-creation", async () => {
      const store = await registry.createStore("files");
      const update: Update = {
        uri: "/a.txt",
        stamp: new Date("2026-04-01T00:00:00Z"),
        meta: { size: 100 },
      };
      await collect(store.store([update]));

      const registry2 = new FilesScanRegistry({ files, prefix: "scan" });
      const store2 = await registry2.getStore("files");
      expect(store2).not.toBeNull();
      if (!store2) throw new Error("expected store");
      const results = await collect(store2.list());
      expect(results).toHaveLength(1);
      expect(results[0]?.uri).toBe("/a.txt");
      expect(results[0]?.meta).toEqual({ size: 100 });
    });
  });
});
