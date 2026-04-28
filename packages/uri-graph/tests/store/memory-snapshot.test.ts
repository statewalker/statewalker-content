import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { createFilesPersistence } from "../../src/store/memory/files-persistence.js";
import { MemoryGraphStore } from "../../src/store/memory/store.js";
import { openGraphStore } from "../../src/store/types.js";

describe("MemoryGraphStore — files-backed persistence", () => {
  it("opens with no existing snapshot and starts empty", async () => {
    const files = new MemFilesApi();
    const store = await openGraphStore(
      new MemoryGraphStore(createFilesPersistence(files, "/g.json")),
    );
    expect(await store.getState("u://x")).toBeNull();
    expect(await store.mintStamp()).toBe(1);
  });

  it("opens with existing snapshot and restores state", async () => {
    const files = new MemFilesApi();
    {
      const store = await openGraphStore(
        new MemoryGraphStore(createFilesPersistence(files, "/g.json")),
      );
      await store.registerWorker({ name: "w", version: "v1" });
      const s = await store.mintStamp();
      const txn = await store.beginTransaction({
        worker: "w",
        version: "v1",
        scope: null,
        initialStamp: s,
      });
      await txn.applyUpdate({
        uri: "u://x",
        stamp: s,
        status: "added",
        hash: "h",
      });
      await txn.commit();
      await (store as unknown as { close(): Promise<void> }).close();
    }
    const store2 = await openGraphStore(
      new MemoryGraphStore(createFilesPersistence(files, "/g.json")),
    );
    expect((await store2.getState("u://x"))?.hash).toBe("h");
    const next = await store2.mintStamp();
    expect(next).toBeGreaterThan(1);
  });

  it("snapshot omits pending data", async () => {
    const files = new MemFilesApi();
    const store = await openGraphStore(
      new MemoryGraphStore(createFilesPersistence(files, "/g.json")),
    );
    await store.registerWorker({ name: "w", version: "v1" });
    const s = await store.mintStamp();
    const txn = await store.beginTransaction({
      worker: "w",
      version: "v1",
      scope: null,
      initialStamp: s,
    });
    await txn.applyUpdate({ uri: "u://x", stamp: s, status: "added", hash: "h" });
    // Without commit, snapshot should not contain u://x. Force one via rollback.
    await txn.rollback();
    const decoder = new TextDecoder();
    const chunks: Uint8Array[] = [];
    for await (const c of files.read("/g.json")) chunks.push(c);
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    const json = JSON.parse(decoder.decode(buf));
    expect(JSON.stringify(json)).not.toContain("u://x");
  });

  it("commit triggers snapshot write", async () => {
    const files = new MemFilesApi();
    const store = await openGraphStore(
      new MemoryGraphStore(createFilesPersistence(files, "/g.json")),
    );
    await store.registerWorker({ name: "w", version: "v1" });
    const s = await store.mintStamp();
    const txn = await store.beginTransaction({
      worker: "w",
      version: "v1",
      scope: null,
      initialStamp: s,
    });
    await txn.applyUpdate({ uri: "u://x", stamp: s, status: "added", hash: "h" });
    await txn.commit();
    expect(await files.exists("/g.json")).toBe(true);
  });

  it("second open against same path errors", async () => {
    const files = new MemFilesApi();
    const persistence = createFilesPersistence(files, "/g.json");
    await openGraphStore(new MemoryGraphStore(persistence));
    await expect(
      openGraphStore(new MemoryGraphStore(createFilesPersistence(files, "/g.json"))),
    ).rejects.toThrow(/already open/);
  });

  it("applyUpdate stages without affecting reads", async () => {
    const files = new MemFilesApi();
    const store = await openGraphStore(
      new MemoryGraphStore(createFilesPersistence(files, "/g.json")),
    );
    await store.registerWorker({ name: "w", version: "v1" });
    const s = await store.mintStamp();
    const txn = await store.beginTransaction({
      worker: "w",
      version: "v1",
      scope: null,
      initialStamp: s,
    });
    await txn.applyUpdate({ uri: "u://x", stamp: s, status: "added", hash: "h" });
    expect(await store.getState("u://x")).toBeNull();
    await txn.commit();
    expect(await store.getState("u://x")).not.toBeNull();
  });

  it("commit promotes staging atomically", async () => {
    const files = new MemFilesApi();
    const store = await openGraphStore(
      new MemoryGraphStore(createFilesPersistence(files, "/g.json")),
    );
    await store.registerWorker({ name: "w", version: "v1" });
    const s = await store.mintStamp();
    const txn = await store.beginTransaction({
      worker: "w",
      version: "v1",
      scope: null,
      initialStamp: s,
    });
    for (let i = 0; i < 10; i++) {
      await txn.applyUpdate({
        uri: `u://${i}`,
        stamp: s,
        status: "added",
        hash: `h${i}`,
      });
    }
    expect(await store.getState("u://0")).toBeNull();
    await txn.commit();
    for (let i = 0; i < 10; i++) {
      expect(await store.getState(`u://${i}`)).not.toBeNull();
    }
  });
});
