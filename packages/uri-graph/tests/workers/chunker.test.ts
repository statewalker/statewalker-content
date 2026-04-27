import { beforeEach, describe, expect, it } from "vitest";
import { drain } from "../../src/orchestrator/drain.js";
import type { GraphStore } from "../../src/store/types.js";
import type { Update } from "../../src/types/update.js";
import { createChunker } from "../../src/workers/chunker.js";
import { openTempMemoryStore } from "../helpers.js";

describe("chunker", () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await openTempMemoryStore();
  });

  async function feedTextUpdates(updates: Update[]): Promise<void> {
    const chunker = createChunker({ chunkSize: 5 });
    await store.registerWorker({
      name: chunker.name,
      version: chunker.version,
    });
    async function* feed(): AsyncIterableIterator<Update> {
      for (const u of updates) yield u;
    }
    await drain(chunker, feed(), store);
  }

  function textUpdate(uri: string, text: string, hash: string): Update {
    return {
      uri,
      stamp: 0,
      status: "added",
      hash,
      attributes: { text },
    };
  }

  async function chunkUris(): Promise<string[]> {
    const out: string[] = [];
    for await (const v of store.find("chunk:///%")) out.push(v.uri);
    return out.sort();
  }

  it("splits text into chunks under one shared stamp", async () => {
    const text = "abcde" + "fghij" + "klmno"; // 15 chars, chunkSize 5 → 3 chunks
    await feedTextUpdates([textUpdate("text:///a.md", text, "h")]);
    const uris = await chunkUris();
    expect(uris).toEqual(["chunk:///a.md#0", "chunk:///a.md#1", "chunk:///a.md#2"]);
    const stamps = await Promise.all(uris.map(async (u) => (await store.getState(u))?.stamp));
    expect(new Set(stamps).size).toBe(1);
  });

  it("stable chunk URIs across re-runs", async () => {
    const text = "abcdefghij"; // 10 chars → 2 chunks
    await feedTextUpdates([textUpdate("text:///x.md", text, "h1")]);
    const first = await chunkUris();
    await feedTextUpdates([textUpdate("text:///x.md", text, "h2")]);
    const second = await chunkUris();
    expect(second).toEqual(first);
  });

  it("shrinking output cleans surplus chunks", async () => {
    const long = "12345" + "67890" + "abcde" + "fghij" + "klmno"; // 25 chars → 5 chunks
    await feedTextUpdates([textUpdate("text:///s.md", long, "h1")]);
    const before = await chunkUris();
    expect(before.length).toBe(5);

    const short = "12345" + "67890" + "abcde"; // 15 chars → 3 chunks
    await feedTextUpdates([textUpdate("text:///s.md", short, "h2")]);

    // The first 3 chunks should still exist; chunks #3 and #4 should be removed.
    const c3 = await store.getState("chunk:///s.md#3");
    const c4 = await store.getState("chunk:///s.md#4");
    expect(c3?.status).toBe("removed");
    expect(c4?.status).toBe("removed");
  });

  it("two text docs get distinct stamps", async () => {
    await feedTextUpdates([
      textUpdate("text:///a.md", "hello world!", "ha"),
      textUpdate("text:///b.md", "another doc", "hb"),
    ]);
    const a0 = await store.getState("chunk:///a.md#0");
    const b0 = await store.getState("chunk:///b.md#0");
    expect(a0?.stamp).not.toBe(b0?.stamp);
  });

  it("upstream removal cascades to chunks", async () => {
    await feedTextUpdates([textUpdate("text:///a.md", "abcdefghij", "h")]);
    expect((await store.getState("chunk:///a.md#0"))?.status).toBe("added");

    await feedTextUpdates([{ uri: "text:///a.md", stamp: 0, status: "removed" }]);
    const c0 = await store.getState("chunk:///a.md#0");
    const c1 = await store.getState("chunk:///a.md#1");
    expect(c0?.status).toBe("removed");
    expect(c1?.status).toBe("removed");
  });
});
