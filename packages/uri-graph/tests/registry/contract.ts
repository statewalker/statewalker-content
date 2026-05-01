import { describe, expect, it } from "vitest";
import type { ProcessorRegistry } from "../../src/index.js";

export type ProcessorRegistryFactory = () => Promise<{
  registry: ProcessorRegistry;
  close: () => Promise<void>;
}>;

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

export function defineProcessorRegistryContract(
  name: string,
  factory: ProcessorRegistryFactory,
): void {
  describe(`${name} — ProcessorRegistry contract`, () => {
    it("saves, gets, lists, deletes processors", async () => {
      const { registry, close } = await factory();
      try {
        await registry.saveProcessor({ name: "scanner", selects: "", emits: "file://" });
        await registry.saveProcessor({
          name: "extractor",
          selects: "file://",
          emits: "text://",
        });

        expect((await registry.getProcessor("scanner"))?.emits).toBe("file://");

        const all = await collect(registry.listProcessors());
        expect(all.map((p) => p.name).sort()).toEqual(["extractor", "scanner"]);

        await registry.deleteProcessor("scanner");
        expect(await registry.getProcessor("scanner")).toBeUndefined();
      } finally {
        await close();
      }
    });

    it("saveProcessor upserts on conflict", async () => {
      const { registry, close } = await factory();
      try {
        await registry.saveProcessor({ name: "p", selects: "a://", emits: "b://" });
        await registry.saveProcessor({ name: "p", selects: "x://", emits: "y://" });
        const p = await registry.getProcessor("p");
        expect(p?.selects).toBe("x://");
        expect(p?.emits).toBe("y://");
      } finally {
        await close();
      }
    });

    it("getProcessor returns undefined for unknown name", async () => {
      const { registry, close } = await factory();
      try {
        expect(await registry.getProcessor("nope")).toBeUndefined();
      } finally {
        await close();
      }
    });

    it("listProcessors yields nothing on empty registry", async () => {
      const { registry, close } = await factory();
      try {
        const all = await collect(registry.listProcessors());
        expect(all).toEqual([]);
      } finally {
        await close();
      }
    });
  });
}
