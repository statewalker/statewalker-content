import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { JsonManifestStore } from "../src/stores/json-manifest.js";
import type { FileEntry } from "../src/types.js";

const mk = (prefix = "/store"): JsonManifestStore<FileEntry> =>
  new JsonManifestStore<FileEntry>({ files: new MemFilesApi(), prefix });

describe("JsonManifestStore", () => {
  it("round-trips live entries and tombstones", async () => {
    const store = mk();
    await store.put([
      { uri: "a", meta: { size: 10, mtime: 1, hash: "aa" } },
      { uri: "b", meta: { size: 20, mtime: 2, hash: "bb" } },
    ]);
    const a = await store.get("a");
    expect(a?.meta?.hash).toBe("aa");
    expect(a?.tombstone).toBeUndefined();

    await store.put([{ uri: "a", tombstone: true }]);
    const aGone = await store.get("a");
    expect(aGone?.tombstone).toBe(true);
    expect(aGone?.meta).toBeUndefined();
  });

  it("since yields only entries with stamp > cursor, in ascending order", async () => {
    const store = mk();
    await store.put([
      { uri: "a", meta: { size: 1, mtime: 1, hash: "a" } },
      { uri: "b", meta: { size: 2, mtime: 2, hash: "b" } },
    ]);
    const all = [];
    for await (const e of store.since(0, 100)) all.push(e);
    expect(all.map((e) => e.uri)).toEqual(["a", "b"]);
    for (let i = 1; i < all.length; i++) {
      expect((all[i] as FileEntry).stamp).toBeGreaterThan((all[i - 1] as FileEntry).stamp);
    }
    const midCursor = (all[0] as FileEntry).stamp;
    const after = [];
    for await (const e of store.since(midCursor, 100)) after.push(e);
    expect(after.map((e) => e.uri)).toEqual(["b"]);
  });

  it("keeps per-listener cursors independent", async () => {
    const store = mk();
    await store.advance("A", 100);
    await store.advance("B", 200);
    expect(await store.cursor("A")).toBe(100);
    expect(await store.cursor("B")).toBe(200);
    expect(await store.cursor("unknown")).toBe(0);
    await store.advance("A", 150);
    expect(await store.cursor("A")).toBe(150);
    expect(await store.cursor("B")).toBe(200);
  });

  it("persists across a simulated restart on the same FilesApi", async () => {
    const files = new MemFilesApi();
    const first = new JsonManifestStore<FileEntry>({ files, prefix: "/s" });
    await first.put([{ uri: "a", meta: { size: 1, mtime: 1, hash: "a" } }]);
    const topFirst = (await first.get("a"))?.stamp as number;
    await first.advance("t", topFirst);

    const second = new JsonManifestStore<FileEntry>({ files, prefix: "/s" });
    const reopened = await second.get("a");
    expect(reopened?.meta?.hash).toBe("a");
    expect(await second.cursor("t")).toBe(topFirst);

    await second.put([{ uri: "b", meta: { size: 2, mtime: 2, hash: "b" } }]);
    const topSecond = (await second.get("b"))?.stamp as number;
    expect(topSecond).toBeGreaterThan(topFirst);
  });

  it("fires onStampUpdate once per put batch with the batch's top stamp", async () => {
    const store = mk();
    const notifications: number[] = [];
    const unsub = store.onStampUpdate((s) => notifications.push(s));
    await store.put([
      { uri: "a", meta: { size: 1, mtime: 1, hash: "a" } },
      { uri: "b", meta: { size: 2, mtime: 2, hash: "b" } },
    ]);
    expect(notifications.length).toBe(1);
    const top = (await store.get("b"))?.stamp;
    expect(notifications[0]).toBe(top);
    unsub();
    await store.put([{ uri: "c", meta: { size: 3, mtime: 3, hash: "c" } }]);
    expect(notifications.length).toBe(1);
  });
});
