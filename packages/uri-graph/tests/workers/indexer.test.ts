import { beforeEach, describe, expect, it } from "vitest";
import { drain } from "../../src/orchestrator/drain.js";
import type { GraphStore } from "../../src/store/types.js";
import type { Update } from "../../src/types/update.js";
import { createMemoryFtsBackend } from "../../src/workers/index-backends/memory-fts.js";
import { createMemoryVectorBackend } from "../../src/workers/index-backends/memory-vector.js";
import { createIndexer } from "../../src/workers/indexer.js";
import { openTempMemoryStore } from "../helpers.js";

describe("indexer", () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await openTempMemoryStore();
  });

  function indexerInputs(scope: string): Update[] {
    return [
      {
        uri: scope,
        stamp: 0,
        status: "added",
        scope,
        role: "text",
        attributes: { text: "hello world" },
      },
      {
        uri: `chunk:${scope.slice(5)}#0`,
        stamp: 0,
        status: "added",
        scope,
        role: "chunk",
        attributes: { text: "hello world" },
      },
      {
        uri: `embedding://chunk:${scope.slice(5)}#0`,
        stamp: 0,
        status: "added",
        scope,
        role: "embedding",
        attributes: { vector: [1, 0, 0] },
      },
    ];
  }

  it("emits one fts and one vector index URI per ready scope", async () => {
    const fts = createMemoryFtsBackend();
    const vec = createMemoryVectorBackend();
    const indexer = createIndexer({ fts, vector: vec });
    await store.registerWorker({
      name: indexer.name,
      version: indexer.version,
    });

    const inputs = indexerInputs("text:///x.md");
    async function* feed(): AsyncIterableIterator<Update> {
      for (const u of inputs) yield u;
    }
    await drain(indexer, feed(), store);

    expect(await store.getState("index://fts/text:///x.md")).not.toBeNull();
    expect(await store.getState("index://vector/text:///x.md")).not.toBeNull();
    // The FTS backend now indexes the scope.
    expect(fts.query("hello").map((h) => h.scope)).toContain("text:///x.md");
  });

  it("groups inputs by scope when they interleave (sorted by joinInputs upstream)", async () => {
    const fts = createMemoryFtsBackend();
    const vec = createMemoryVectorBackend();
    const indexer = createIndexer({ fts, vector: vec });
    await store.registerWorker({
      name: indexer.name,
      version: indexer.version,
    });

    const inputs = [...indexerInputs("text:///a.md"), ...indexerInputs("text:///b.md")].sort(
      (x, y) => (x.scope ?? "").localeCompare(y.scope ?? ""),
    );
    async function* feed(): AsyncIterableIterator<Update> {
      for (const u of inputs) yield u;
    }
    await drain(indexer, feed(), store);
    expect(await store.getState("index://fts/text:///a.md")).not.toBeNull();
    expect(await store.getState("index://fts/text:///b.md")).not.toBeNull();
  });

  it("removed text cascades indexes", async () => {
    const fts = createMemoryFtsBackend();
    const vec = createMemoryVectorBackend();
    const indexer = createIndexer({ fts, vector: vec });
    await store.registerWorker({
      name: indexer.name,
      version: indexer.version,
    });

    // First index it, then send a removed text update.
    async function* feed1(): AsyncIterableIterator<Update> {
      for (const u of indexerInputs("text:///r.md")) yield u;
    }
    await drain(indexer, feed1(), store);
    expect(fts.query("hello").length).toBeGreaterThan(0);

    async function* feed2(): AsyncIterableIterator<Update> {
      yield {
        uri: "text:///r.md",
        stamp: 0,
        status: "removed",
        scope: "text:///r.md",
        role: "text",
      };
    }
    await drain(indexer, feed2(), store);
    expect((await store.getState("index://fts/text:///r.md"))?.status).toBe("removed");
    expect((await store.getState("index://vector/text:///r.md"))?.status).toBe("removed");
    expect(fts.query("hello").length).toBe(0);
  });
});
