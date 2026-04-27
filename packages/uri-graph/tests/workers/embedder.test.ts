import { beforeEach, describe, expect, it } from "vitest";
import { drain } from "../../src/orchestrator/drain.js";
import type { GraphStore } from "../../src/store/types.js";
import type { Update } from "../../src/types/update.js";
import { createEmbedder } from "../../src/workers/embedder.js";
import { openTempMemoryStore } from "../helpers.js";

describe("embedder", () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await openTempMemoryStore();
  });

  function chunkUpdate(uri: string, text: string): Update {
    return {
      uri,
      stamp: 0,
      status: "added",
      hash: `h:${uri}`,
      attributes: { text },
    };
  }

  it("yields one stamp per chunk", async () => {
    const embedder = createEmbedder({
      embed: async (text: string) => new Float32Array([text.length, 0, 0]),
    });
    await store.registerWorker({
      name: embedder.name,
      version: embedder.version,
    });
    const inputs = [
      chunkUpdate("chunk:///a.md#0", "hello"),
      chunkUpdate("chunk:///a.md#1", "world"),
      chunkUpdate("chunk:///a.md#2", "!"),
    ];
    async function* feed(): AsyncIterableIterator<Update> {
      for (const u of inputs) yield u;
    }
    await drain(embedder, feed(), store);
    const e0 = await store.getState("embedding://chunk:///a.md#0");
    const e1 = await store.getState("embedding://chunk:///a.md#1");
    const e2 = await store.getState("embedding://chunk:///a.md#2");
    expect(e0?.stamp).not.toBe(e1?.stamp);
    expect(e1?.stamp).not.toBe(e2?.stamp);
    expect(e0?.stamp).not.toBe(e2?.stamp);
  });

  it("calls the embedding API once per chunk", async () => {
    let calls = 0;
    const embedder = createEmbedder({
      embed: async (_text: string) => {
        calls += 1;
        return new Float32Array([1, 2, 3]);
      },
    });
    await store.registerWorker({
      name: embedder.name,
      version: embedder.version,
    });
    async function* feed(): AsyncIterableIterator<Update> {
      yield chunkUpdate("chunk:///x#0", "a");
      yield chunkUpdate("chunk:///x#1", "b");
    }
    await drain(embedder, feed(), store);
    expect(calls).toBe(2);
  });

  it("respects abort: stops mid-stream", async () => {
    const ac = new AbortController();
    const embedder = createEmbedder({
      embed: async (text: string) => {
        if (text === "abort-here") ac.abort();
        return new Float32Array([1]);
      },
    });
    await store.registerWorker({
      name: embedder.name,
      version: embedder.version,
    });
    async function* feed(): AsyncIterableIterator<Update> {
      yield chunkUpdate("chunk:///a", "ok");
      yield chunkUpdate("chunk:///b", "abort-here");
      yield chunkUpdate("chunk:///c", "should-not-process");
    }
    await drain(embedder, feed(), store, { signal: ac.signal });
    // a was processed; b might or might not have committed (its embed returned
    // before abort took effect). c should NOT have been processed.
    expect(await store.getState("embedding://chunk:///c")).toBeNull();
  });
});
