import { newNodeTursoDb } from "@statewalker/db-turso-node";
import { describe, expect, it } from "vitest";
import {
  Engine,
  MemoryProcessorRegistry,
  MemoryResourceStore,
  type ProcessorRegistry,
  type ResourceProcessorFn,
  type ResourceStore,
  SqlProcessorRegistry,
  SqlResourceStore,
} from "../../src/index.js";

type BackendFactory = () => Promise<{
  registry: ProcessorRegistry;
  store: ResourceStore;
  close: () => Promise<void>;
}>;

const factories: Array<{ name: string; make: BackendFactory }> = [
  {
    name: "Memory",
    make: async () => ({
      registry: new MemoryProcessorRegistry(),
      store: new MemoryResourceStore(),
      close: async () => {},
    }),
  },
  {
    name: "Sql",
    make: async () => {
      const db = await newNodeTursoDb();
      return {
        registry: new SqlProcessorRegistry(db),
        store: new SqlResourceStore(db),
        close: async () => db.close(),
      };
    },
  },
];

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

for (const { name, make } of factories) {
  describe(`Pipeline e2e — ${name}`, () => {
    it("scanner → extractor (md only) → indexer", async () => {
      const { registry, store, close } = await make();
      try {
        const engine = new Engine({ registry, store });

        const scanner: ResourceProcessorFn = async function* (input, ctx) {
          for await (const _tick of input) {
            const stamp = await ctx.newStamp();
            yield { uri: "file://a.md", stamp, status: "added" };
            yield { uri: "file://b.png", stamp, status: "added" };
            yield { uri: "file://c.md", stamp, status: "added" };
          }
        };

        const extractor: ResourceProcessorFn = async function* (input, ctx) {
          for await (const r of input) {
            if (!r.uri.endsWith(".md")) continue;
            const stamp = await ctx.newStamp();
            yield { uri: `text://${r.uri.slice("file://".length)}`, stamp, status: "added" };
          }
        };

        const indexer: ResourceProcessorFn = async function* (input, ctx) {
          for await (const r of input) {
            const stamp = await ctx.newStamp();
            yield { uri: `db://${r.uri.slice("text://".length)}`, stamp, status: "added" };
          }
        };

        await store.put({
          uri: "tick://run",
          stamp: await store.newStamp(),
          status: "updated",
        });

        await engine.register({ name: "scanner", selects: "tick://", emits: "file://" }, scanner);
        await engine.register(
          { name: "extractor", selects: "file://", emits: "text://" },
          extractor,
        );
        await engine.register({ name: "indexer", selects: "text://", emits: "db://" }, indexer);

        await collect(engine.stabilize());

        const dbRows = await collect(store.list({ prefix: "db://" }));
        expect(dbRows.map((r) => r.uri).sort()).toEqual(["db://a.md", "db://c.md"]);

        const png = await store.get("text://b.png");
        expect(png).toBeUndefined();
      } finally {
        await close();
      }
    });

    it("invalidate triggers downstream re-execution", async () => {
      const { registry, store, close } = await make();
      try {
        const engine = new Engine({ registry, store });

        const stamp1 = await store.newStamp();
        await store.put({ uri: "file://x", stamp: stamp1, status: "added" });

        const echo: ResourceProcessorFn = async function* (input, ctx) {
          for await (const r of input) {
            const stamp = await ctx.newStamp();
            yield {
              uri: `text://${r.uri.slice("file://".length)}`,
              stamp,
              status: r.status,
            };
          }
        };

        await engine.register({ name: "echo", selects: "file://", emits: "text://" }, echo);
        await collect(engine.stabilize());
        expect((await store.get("text://x"))?.status).toBe("added");

        await store.invalidate("file://");
        await collect(engine.stabilize());
        expect((await store.get("text://x"))?.status).toBe("removed");
      } finally {
        await close();
      }
    });
  });
}
