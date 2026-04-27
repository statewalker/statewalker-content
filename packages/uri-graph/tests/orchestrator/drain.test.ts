import { beforeEach, describe, expect, it } from "vitest";
import { drain } from "../../src/orchestrator/drain.js";
import type { GraphStore } from "../../src/store/types.js";
import type { Update } from "../../src/types/update.js";
import type { WorkerDefinition } from "../../src/types/worker.js";
import { openTempMemoryStore } from "../helpers.js";

describe("drain", () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await openTempMemoryStore();
    await store.registerWorker({ name: "w", version: "v1" });
  });

  function makeWorker(
    runFn: (
      input: AsyncIterable<Update>,
      params: { stamp(): Promise<number> },
    ) => AsyncGenerator<Update>,
  ): WorkerDefinition {
    return {
      name: "w",
      version: "v1",
      selector: async function* () {
        // empty
      },
      run: async function* (params, input) {
        yield* runFn(input, { stamp: params.stamp });
      },
    };
  }

  async function* asyncIter<T>(items: T[]): AsyncIterableIterator<T> {
    for (const x of items) yield x;
  }

  it("multiple updates with same stamp commit together", async () => {
    const worker = makeWorker(async function* (_input, p) {
      const s = await p.stamp();
      yield { uri: "u://a", stamp: s, status: "added", hash: "ha" };
      yield { uri: "u://b", stamp: s, status: "added", hash: "hb" };
      yield { uri: "u://c", stamp: s, status: "added", hash: "hc" };
    });
    await drain(worker, asyncIter<Update>([]), store);
    const a = await store.getState("u://a");
    const b = await store.getState("u://b");
    const c = await store.getState("u://c");
    expect(a?.stamp).toBe(b?.stamp);
    expect(b?.stamp).toBe(c?.stamp);
  });

  it("multiple stamps produce multiple commits", async () => {
    const worker = makeWorker(async function* (_input, p) {
      const s1 = await p.stamp();
      yield { uri: "u://a", stamp: s1, status: "added", hash: "ha" };
      const s2 = await p.stamp();
      yield { uri: "u://b", stamp: s2, status: "added", hash: "hb" };
    });
    await drain(worker, asyncIter<Update>([]), store);
    const a = await store.getState("u://a");
    const b = await store.getState("u://b");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a?.stamp).not.toBe(b?.stamp);
    if (a && b) expect(b.stamp).toBeGreaterThan(a.stamp);
  });

  it("generator throw rolls back current batch", async () => {
    const worker = makeWorker(async function* (_input, p) {
      const s = await p.stamp();
      yield { uri: "u://x", stamp: s, status: "added", hash: "h" };
      throw new Error("boom");
    });
    await expect(drain(worker, asyncIter<Update>([]), store)).rejects.toThrow(/boom/);
    expect(await store.getState("u://x")).toBeNull();
  });

  it("stamp regression aborts run", async () => {
    const worker = makeWorker(async function* () {
      yield { uri: "u://a", stamp: 100, status: "added", hash: "h1" };
      yield { uri: "u://b", stamp: 99, status: "added", hash: "h2" };
    });
    await expect(drain(worker, asyncIter<Update>([]), store)).rejects.toThrow(/stamp/i);
    expect(await store.getState("u://a")).toBeNull();
    expect(await store.getState("u://b")).toBeNull();
  });

  it("consumed inputs are recorded", async () => {
    // Seed two committed input URIs.
    const seedStamp = await store.mintStamp();
    const seed = await store.beginTransaction({
      worker: "w",
      version: "v1",
      scope: null,
      initialStamp: seedStamp,
    });
    await seed.applyUpdate({
      uri: "in://1",
      stamp: seedStamp,
      status: "added",
      hash: "1",
    });
    await seed.applyUpdate({
      uri: "in://2",
      stamp: seedStamp,
      status: "added",
      hash: "2",
    });
    await seed.commit();

    const inputs: Update[] = [
      { uri: "in://1", stamp: seedStamp, status: "added", hash: "1" },
      { uri: "in://2", stamp: seedStamp, status: "added", hash: "2" },
    ];
    const worker = makeWorker(async function* (input, p) {
      for await (const u of input) {
        const s = await p.stamp();
        yield { uri: `out://${u.uri}`, stamp: s, status: "added", hash: `h:${u.uri}` };
      }
    });
    await drain(worker, asyncIter<Update>(inputs), store);

    // Both outputs should exist.
    expect(await store.getState("out://in://1")).not.toBeNull();
    expect(await store.getState("out://in://2")).not.toBeNull();
    // priorOutputs should map input URIs back to their outputs.
    const prior1 = await store.priorOutputs("w", "in://1");
    expect(prior1.map((p) => p.uri)).toEqual(["out://in://1"]);
  });
});
