import { beforeEach, describe, expect, it } from "vitest";
import { createOrchestrator } from "../../src/orchestrator/orchestrator.js";
import type { GraphStore } from "../../src/store/types.js";
import type { WorkerDefinition } from "../../src/types/worker.js";
import { openTempMemoryStore } from "../helpers.js";

describe("Orchestrator", () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await openTempMemoryStore();
  });

  function makeOneShotWorker(
    name: string,
    version: string,
    behavior: { selectorYields: number; runYields: number },
  ): { def: WorkerDefinition; selectorCalls: number; runCalls: number } {
    const stats = { selectorCalls: 0, runCalls: 0 };
    let selectorEmitted = false;
    const def: WorkerDefinition = {
      name,
      version,
      selector: async function* () {
        stats.selectorCalls += 1;
        if (selectorEmitted) return;
        for (let i = 0; i < behavior.selectorYields; i++) {
          yield {
            uri: `tick://${name}#${i}`,
            stamp: 0,
            status: "updated",
          };
        }
        selectorEmitted = true;
      },
      run: async function* (params, input) {
        stats.runCalls += 1;
        // consume input fully
        for await (const _ of input) {
          // just drain
        }
        for (let i = 0; i < behavior.runYields; i++) {
          const s = await params.stamp();
          yield {
            uri: `out://${name}#${i}`,
            stamp: s,
            status: "added",
            hash: `h:${i}`,
          };
        }
      },
    };
    return {
      def,
      get selectorCalls() {
        return stats.selectorCalls;
      },
      get runCalls() {
        return stats.runCalls;
      },
    };
  }

  it("invokes a worker when its selector has work", async () => {
    const w = makeOneShotWorker("a", "v1", { selectorYields: 1, runYields: 2 });
    const orch = createOrchestrator({ graph: store, pollMs: 10 });
    await orch.registerWorker(w.def);
    const ac = new AbortController();
    const startPromise = orch.start(ac.signal);
    // Wait until run completes.
    while (w.runCalls === 0) await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await startPromise;
    expect(w.runCalls).toBe(1);
    expect(await store.getState("out://a#0")).not.toBeNull();
    expect(await store.getState("out://a#1")).not.toBeNull();
  });

  it("sleeps when no work is pending and stops on abort", async () => {
    const orch = createOrchestrator({ graph: store, pollMs: 5 });
    const w = makeOneShotWorker("idle", "v1", {
      selectorYields: 0,
      runYields: 0,
    });
    await orch.registerWorker(w.def);
    const ac = new AbortController();
    const startPromise = orch.start(ac.signal);
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await startPromise;
    expect(w.runCalls).toBe(0);
    expect(w.selectorCalls).toBeGreaterThan(0);
  });

  it("workers are addressable by name in run records", async () => {
    const w = makeOneShotWorker("named", "v3", {
      selectorYields: 1,
      runYields: 1,
    });
    const orch = createOrchestrator({ graph: store, pollMs: 5 });
    await orch.registerWorker(w.def);
    const ac = new AbortController();
    const startPromise = orch.start(ac.signal);
    while (w.runCalls === 0) await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    await startPromise;
    // priorOutputs by name should yield the run's outputs.
    const prior = await store.priorOutputs("named", "tick://named#0");
    expect(prior.map((p) => p.uri)).toEqual(["out://named#0"]);
  });

  it("bumping a worker version triggers reprocessing", async () => {
    const w1 = makeOneShotWorker("ver", "v1", {
      selectorYields: 1,
      runYields: 1,
    });
    const orch1 = createOrchestrator({ graph: store, pollMs: 5 });
    await orch1.registerWorker(w1.def);
    const ac1 = new AbortController();
    const p1 = orch1.start(ac1.signal);
    while (w1.runCalls === 0) await new Promise((r) => setTimeout(r, 5));
    ac1.abort();
    await p1;

    // Sanity: v1 ran once.
    expect(w1.runCalls).toBe(1);

    // Now register v2 with same name; isInputProcessed should be false against new version.
    const v1Done = await store.isInputProcessed("ver", "v1", "tick://ver#0");
    const v2Done = await store.isInputProcessed("ver", "v2", "tick://ver#0");
    expect(v1Done).toBe(true);
    expect(v2Done).toBe(false);
  });
});
