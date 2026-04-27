import { describe, expect, it } from "vitest";
import { createOrchestrator } from "../../src/orchestrator/orchestrator.js";
import { openTempMemoryStore } from "../helpers.js";

describe("Orchestrator.status()", () => {
  it("reports running flag and registered workers", async () => {
    const store = await openTempMemoryStore();
    const orch = createOrchestrator({ graph: store, pollMs: 5 });
    await orch.registerWorker({
      name: "a",
      version: "v1",
      selector: async function* () {
        // empty
      },
      run: async function* () {
        // empty
      },
    });
    await orch.registerWorker({
      name: "b",
      version: "v2",
      selector: async function* () {
        // empty
      },
      run: async function* () {
        // empty
      },
    });
    const before = await orch.status();
    expect(before.running).toBe(false);
    expect(before.workers.map((w) => `${w.name}:${w.version}`).sort()).toEqual(["a:v1", "b:v2"]);

    const ac = new AbortController();
    const startPromise = orch.start(ac.signal);
    await new Promise((r) => setTimeout(r, 20));
    const during = await orch.status();
    expect(during.running).toBe(true);
    ac.abort();
    await startPromise;
    const after = await orch.status();
    expect(after.running).toBe(false);
  });
});
