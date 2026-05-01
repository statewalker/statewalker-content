import type {
  ProcessorRegistry,
  Resource,
  ResourceProcessor,
  ResourceProcessorContext,
  ResourceProcessorFn,
  ResourceStore,
} from "./types.js";

export type EngineOptions = {
  registry: ProcessorRegistry;
  store: ResourceStore;
};

export class Engine {
  private fns = new Map<string, ResourceProcessorFn>();
  private registry: ProcessorRegistry;
  private store: ResourceStore;

  constructor(options: EngineOptions) {
    this.registry = options.registry;
    this.store = options.store;
  }

  async register(processor: ResourceProcessor, fn: ResourceProcessorFn): Promise<void> {
    await this.registry.saveProcessor(processor);
    this.fns.set(processor.name, fn);
  }

  async unregister(name: string): Promise<void> {
    await this.registry.deleteProcessor(name);
    this.fns.delete(name);
  }

  async *runProcessor(name: string): AsyncIterable<Resource> {
    const processor = await this.registry.getProcessor(name);
    if (!processor) return;
    const watermarks = await this.store.allWatermarks();
    yield* this.runOne(processor, watermarks.get(name) ?? 0);
  }

  async *stabilize(): AsyncIterable<Resource> {
    for (;;) {
      const watermarks = await this.store.allWatermarks();
      let progressed = false;
      for await (const processor of this.registry.listProcessors()) {
        const watermark = watermarks.get(processor.name) ?? 0;
        for await (const r of this.runOne(processor, watermark)) {
          progressed = true;
          yield r;
        }
      }
      if (!progressed) break;
    }
  }

  private async *runOne(processor: ResourceProcessor, watermark: number): AsyncIterable<Resource> {
    const fn = this.fns.get(processor.name);
    if (!fn) return;

    const store = this.store;
    let consumed = false;
    const input = (async function* () {
      for await (const r of store.list({ prefix: processor.selects, afterStamp: watermark })) {
        consumed = true;
        yield r;
      }
    })();

    const ctx: ResourceProcessorContext = {
      newStamp: () => store.newStamp(),
      read: (uri) => store.get(uri),
    };

    for await (const out of fn(input, ctx)) {
      await store.put(out);
      yield out;
    }

    if (consumed) {
      const completionStamp = await store.newStamp();
      await store.markCompleted(processor.name, completionStamp);
    }
  }
}
