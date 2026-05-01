import { describe, expect, it } from "vitest";
import { Engine, MemoryStore, type Resource, type WorkerFn } from "../src/index.js";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("Engine.runWorker", () => {
  it("runs a worker with empty input and writes no completion", async () => {
    const store = new MemoryStore();
    const engine = new Engine(store);

    const fn: WorkerFn = async function* (input, ctx) {
      for await (const r of input) {
        yield { uri: r.uri, stamp: await ctx.newStamp(), status: "added" };
      }
    };

    await engine.register({ name: "w", selects: "x://", emits: "y://" }, fn);

    const out = await collect(engine.runWorker("w"));
    expect(out).toEqual([]);

    const wm = await store.allWatermarks();
    expect(wm.get("w")).toBeUndefined();
  });

  it("runs a worker, persists outputs, and writes a completion stamp", async () => {
    const store = new MemoryStore();
    const engine = new Engine(store);

    await store.put({ uri: "file://a", stamp: 1, status: "added" });
    await store.put({ uri: "file://b", stamp: 2, status: "added" });

    const fn: WorkerFn = async function* (input, ctx) {
      const stamp = await ctx.newStamp();
      for await (const r of input) {
        yield {
          uri: `text://${r.uri.slice("file://".length)}`,
          stamp,
          status: "updated",
        };
      }
    };

    await engine.register({ name: "extractor", selects: "file://", emits: "text://" }, fn);

    const out: Resource[] = await collect(engine.runWorker("extractor"));
    expect(out.map((r) => r.uri).sort()).toEqual(["text://a", "text://b"]);

    const wm = await store.allWatermarks();
    const completion = wm.get("extractor");
    expect(completion).toBeDefined();
    if (!completion) return;

    for (const r of out) expect(r.stamp).toBeLessThan(completion);
  });

  it("filter worker (consumes input, produces nothing) still bumps watermark", async () => {
    const store = new MemoryStore();
    const engine = new Engine(store);

    await store.put({ uri: "file://a.png", stamp: 1, status: "added" });
    await store.put({ uri: "file://b.png", stamp: 2, status: "added" });

    const fn: WorkerFn = async function* (input, ctx) {
      for await (const r of input) {
        if (r.uri.endsWith(".md")) {
          yield { uri: `text://${r.uri}`, stamp: await ctx.newStamp(), status: "added" };
        }
      }
    };

    await engine.register({ name: "filter", selects: "file://", emits: "text://" }, fn);

    await collect(engine.runWorker("filter"));

    const wm = await store.allWatermarks();
    const first = wm.get("filter");
    expect(first).toBeDefined();
    if (!first) return;
    expect(first).toBeGreaterThanOrEqual(2);

    await collect(engine.runWorker("filter"));

    const wm2 = await store.allWatermarks();
    expect(wm2.get("filter")).toBe(first);
  });

  it("does not advance watermark when worker generator throws", async () => {
    const store = new MemoryStore();
    const engine = new Engine(store);

    await store.put({ uri: "file://a", stamp: 1, status: "added" });

    const fn: WorkerFn = async function* (input, ctx) {
      for await (const r of input) {
        if (r.uri) throw new Error("boom");
        yield { uri: r.uri, stamp: await ctx.newStamp(), status: "added" };
      }
    };

    await engine.register({ name: "w", selects: "file://", emits: "x://" }, fn);

    await expect(collect(engine.runWorker("w"))).rejects.toThrow("boom");

    const wm = await store.allWatermarks();
    expect(wm.get("w")).toBeUndefined();
  });

  it("re-running with no new inputs is a no-op", async () => {
    const store = new MemoryStore();
    const engine = new Engine(store);

    await store.put({ uri: "file://a", stamp: 1, status: "added" });

    let runs = 0;
    const fn: WorkerFn = async function* (input, ctx) {
      runs++;
      const stamp = await ctx.newStamp();
      for await (const r of input) {
        yield { uri: `text://${r.uri}`, stamp, status: "updated" };
      }
    };

    await engine.register({ name: "x", selects: "file://", emits: "text://" }, fn);

    await collect(engine.runWorker("x"));
    expect(runs).toBe(1);

    await collect(engine.runWorker("x"));
    expect(runs).toBe(2);
    const got = await collect(store.list({ prefix: "text://" }));
    expect(got.length).toBe(1);
  });
});

describe("Engine.stabilize", () => {
  it("cascades through a 3-stage pipeline", async () => {
    const store = new MemoryStore();
    const engine = new Engine(store);

    const scanner: WorkerFn = async function* (input, ctx) {
      for await (const _tick of input) {
        const stamp = await ctx.newStamp();
        yield { uri: "file://a", stamp, status: "added" };
        yield { uri: "file://b", stamp, status: "added" };
      }
    };

    const extractor: WorkerFn = async function* (input, ctx) {
      const stamp = await ctx.newStamp();
      for await (const r of input) {
        yield { uri: `text://${r.uri.slice("file://".length)}`, stamp, status: "updated" };
      }
    };

    const indexer: WorkerFn = async function* (input, ctx) {
      const stamp = await ctx.newStamp();
      for await (const r of input) {
        yield { uri: `db://${r.uri.slice("text://".length)}`, stamp, status: "updated" };
      }
    };

    await store.put({ uri: "tick://run", stamp: await store.newStamp(), status: "updated" });

    await engine.register({ name: "scanner", selects: "tick://", emits: "file://" }, scanner);
    await engine.register({ name: "extractor", selects: "file://", emits: "text://" }, extractor);
    await engine.register({ name: "indexer", selects: "text://", emits: "db://" }, indexer);

    await collect(engine.stabilize());

    const dbRows = await collect(store.list({ prefix: "db://" }));
    expect(dbRows.map((r) => r.uri).sort()).toEqual(["db://a", "db://b"]);
  });

  it("stabilize converges (terminates) when no worker has new input", async () => {
    const store = new MemoryStore();
    const engine = new Engine(store);

    const fn: WorkerFn = async function* (input, ctx) {
      const stamp = await ctx.newStamp();
      for await (const r of input) {
        yield { uri: `text://${r.uri}`, stamp, status: "updated" };
      }
    };

    await store.put({ uri: "file://a", stamp: await store.newStamp(), status: "added" });
    await engine.register({ name: "w", selects: "file://", emits: "text://" }, fn);

    const out1 = await collect(engine.stabilize());
    expect(out1.length).toBeGreaterThan(0);

    const out2 = await collect(engine.stabilize());
    expect(out2).toEqual([]);
  });

  it("invalidate triggers re-execution of downstream workers", async () => {
    const store = new MemoryStore();
    const engine = new Engine(store);

    const extractor: WorkerFn = async function* (input, ctx) {
      const stamp = await ctx.newStamp();
      for await (const r of input) {
        if (r.status === "removed") {
          yield { uri: `text://${r.uri}`, stamp, status: "removed" };
        } else {
          yield { uri: `text://${r.uri}`, stamp, status: "updated" };
        }
      }
    };

    await store.put({ uri: "file://a", stamp: await store.newStamp(), status: "added" });
    await engine.register({ name: "extractor", selects: "file://", emits: "text://" }, extractor);

    await collect(engine.stabilize());
    expect((await store.get("text://file://a"))?.status).toBe("updated");

    await store.invalidate("file://");
    await collect(engine.stabilize());
    expect((await store.get("text://file://a"))?.status).toBe("removed");
  });
});

describe("Engine.unregister", () => {
  it("removes worker and clears completions", async () => {
    const store = new MemoryStore();
    const engine = new Engine(store);

    await store.put({ uri: "file://a", stamp: await store.newStamp(), status: "added" });

    const fn: WorkerFn = async function* (input, ctx) {
      const stamp = await ctx.newStamp();
      for await (const r of input) {
        yield { uri: `text://${r.uri}`, stamp, status: "updated" };
      }
    };
    await engine.register({ name: "w", selects: "file://", emits: "text://" }, fn);
    await collect(engine.stabilize());

    expect((await store.allWatermarks()).get("w")).toBeDefined();
    await engine.unregister("w");
    expect((await store.allWatermarks()).get("w")).toBeUndefined();
    expect(await store.getWorker("w")).toBeUndefined();
  });
});
