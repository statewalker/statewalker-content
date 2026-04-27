import { beforeEach, describe, expect, it } from "vitest";
import { findDirty, joinInputs } from "../../src/graph/selector-helpers.js";
import type { GraphStore } from "../../src/store/types.js";
import type { Update } from "../../src/types/update.js";
import { openTempMemoryStore } from "../helpers.js";

describe("findDirty", () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await openTempMemoryStore();
    // seed three URIs
    await store.registerWorker({ name: "seed", version: "v1" });
    const s = await store.mintStamp();
    const txn = await store.beginTransaction({
      worker: "seed",
      version: "v1",
      scope: null,
      initialStamp: s,
    });
    for (const u of ["file:///a.md", "file:///b.md", "file:///c.txt"]) {
      await txn.applyUpdate({ uri: u, stamp: s, status: "added", hash: u });
    }
    await txn.commit();
  });

  async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const x of it) out.push(x);
    return out;
  }

  it("yields URIs matching the pattern that the worker has not processed", async () => {
    const it = findDirty(store, {
      forWorker: "ext",
      forVersion: "v1",
      uriLike: "file:///%.md",
      limit: 10,
    });
    const results = await collect(it);
    expect(results.map((r) => r.uri).sort()).toEqual(["file:///a.md", "file:///b.md"]);
  });

  it("excludes URIs the worker has already processed at this version", async () => {
    // simulate ext worker processed a.md at v1
    await store.registerWorker({ name: "ext", version: "v1" });
    const aState = await store.getState("file:///a.md");
    expect(aState).not.toBeNull();
    const s = await store.mintStamp();
    const txn = await store.beginTransaction({
      worker: "ext",
      version: "v1",
      scope: "file:///a.md",
      initialStamp: s,
    });
    await txn.recordInputs([{ uri: "file:///a.md", observedStamp: aState?.stamp ?? 0 }]);
    await txn.applyUpdate({
      uri: "text:///a.md",
      stamp: s,
      status: "added",
      hash: "h",
    });
    await txn.commit();

    const it = findDirty(store, {
      forWorker: "ext",
      forVersion: "v1",
      uriLike: "file:///%.md",
      limit: 10,
    });
    const results = await collect(it);
    expect(results.map((r) => r.uri)).toEqual(["file:///b.md"]);
  });

  it("re-yields a URI when the worker version is bumped", async () => {
    await store.registerWorker({ name: "ext", version: "v1" });
    const aState = await store.getState("file:///a.md");
    const s = await store.mintStamp();
    const txn = await store.beginTransaction({
      worker: "ext",
      version: "v1",
      scope: "file:///a.md",
      initialStamp: s,
    });
    await txn.recordInputs([{ uri: "file:///a.md", observedStamp: aState?.stamp ?? 0 }]);
    await txn.applyUpdate({
      uri: "text:///a.md",
      stamp: s,
      status: "added",
      hash: "h",
    });
    await txn.commit();

    const it = findDirty(store, {
      forWorker: "ext",
      forVersion: "v2",
      uriLike: "file:///%.md",
      limit: 10,
    });
    const results = await collect(it);
    expect(results.map((r) => r.uri).sort()).toEqual(["file:///a.md", "file:///b.md"]);
  });

  it("respects limit", async () => {
    const it = findDirty(store, {
      forWorker: "ext",
      forVersion: "v1",
      uriLike: "file:///%",
      limit: 1,
    });
    const results: Array<{ uri: string }> = [];
    for await (const x of it) results.push(x);
    expect(results.length).toBe(1);
  });
});

describe("joinInputs", () => {
  async function* asyncIter<T>(items: T[]): AsyncIterableIterator<T> {
    for (const x of items) yield x;
  }

  async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const x of it) out.push(x);
    return out;
  }

  it("merges streams ordered by scope, then role", async () => {
    const a: Update[] = [
      {
        uri: "text://x",
        stamp: 1,
        status: "added",
        scope: "x",
        role: "text",
      },
      {
        uri: "text://y",
        stamp: 1,
        status: "added",
        scope: "y",
        role: "text",
      },
    ];
    const b: Update[] = [
      {
        uri: "chunk://x#0",
        stamp: 1,
        status: "added",
        scope: "x",
        role: "chunk",
      },
      {
        uri: "chunk://y#0",
        stamp: 1,
        status: "added",
        scope: "y",
        role: "chunk",
      },
    ];
    const merged = joinInputs(asyncIter(a), asyncIter(b));
    const result = await collect(merged);
    expect(result.map((u) => `${u.scope}:${u.role}`)).toEqual([
      "x:chunk",
      "x:text",
      "y:chunk",
      "y:text",
    ]);
  });
});
