import { describe, expectTypeOf, it } from "vitest";
import type { ReadOnlyView, Update } from "../../src/types/update.js";
import type {
  Selector,
  SelectorContext,
  WorkerDefinition,
  WorkerParams,
} from "../../src/types/worker.js";

describe("WorkerParams", () => {
  it("exposes stamp, read, find, priorOutputs, recordRead, signal", () => {
    expectTypeOf<WorkerParams>().toHaveProperty("stamp").toEqualTypeOf<() => Promise<number>>();
    expectTypeOf<WorkerParams>()
      .toHaveProperty("read")
      .toEqualTypeOf<(uri: string) => Promise<ReadOnlyView | null>>();
    expectTypeOf<WorkerParams>()
      .toHaveProperty("find")
      .toEqualTypeOf<(pattern: string) => AsyncIterable<ReadOnlyView>>();
    expectTypeOf<WorkerParams>()
      .toHaveProperty("priorOutputs")
      .toEqualTypeOf<(inputUri: string) => Promise<ReadOnlyView[]>>();
    expectTypeOf<WorkerParams>()
      .toHaveProperty("recordRead")
      .toEqualTypeOf<(uri: string, role?: string) => void>();
    expectTypeOf<WorkerParams>().toHaveProperty("signal").toEqualTypeOf<AbortSignal>();
  });
});

describe("Selector", () => {
  it("is a function from SelectorContext to AsyncIterableIterator<Update>", () => {
    expectTypeOf<Selector>().toEqualTypeOf<
      (ctx: SelectorContext) => AsyncIterableIterator<Update>
    >();
  });
});

describe("WorkerDefinition", () => {
  it("requires name, version, selector, run; rest optional", () => {
    const def: WorkerDefinition = {
      name: "w",
      version: "v1",
      selector: async function* () {
        // empty
      },
      run: async function* () {
        // empty
      },
    };
    expectTypeOf(def).toMatchTypeOf<WorkerDefinition>();
  });

  it("accepts inputPattern, outputPattern, scopeExpr, description", () => {
    const def: WorkerDefinition = {
      name: "w",
      version: "v1",
      description: "d",
      inputPattern: "file://**",
      outputPattern: "text://**",
      scopeExpr: "uri",
      selector: async function* () {
        // empty
      },
      run: async function* () {
        // empty
      },
    };
    expectTypeOf(def).toMatchTypeOf<WorkerDefinition>();
  });
});
