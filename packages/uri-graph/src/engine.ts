import type { Store } from "./store/store.js";
import type { Resource, Worker, WorkerContext, WorkerFn } from "./types.js";

export class Engine {
  private fns = new Map<string, WorkerFn>();

  constructor(private store: Store) {}

  async register(worker: Worker, fn: WorkerFn): Promise<void> {
    await this.store.saveWorker(worker);
    this.fns.set(worker.name, fn);
  }

  async unregister(name: string): Promise<void> {
    await this.store.deleteWorker(name);
    this.fns.delete(name);
  }

  async *runWorker(name: string): AsyncIterable<Resource> {
    const worker = await this.store.getWorker(name);
    if (!worker) return;
    const watermarks = await this.store.allWatermarks();
    yield* this.runOne(worker, watermarks.get(name) ?? 0);
  }

  async *stabilize(): AsyncIterable<Resource> {
    for (;;) {
      const watermarks = await this.store.allWatermarks();
      let progressed = false;
      for await (const worker of this.store.listWorkers()) {
        const watermark = watermarks.get(worker.name) ?? 0;
        for await (const r of this.runOne(worker, watermark)) {
          progressed = true;
          yield r;
        }
      }
      if (!progressed) break;
    }
  }

  private async *runOne(worker: Worker, watermark: number): AsyncIterable<Resource> {
    const fn = this.fns.get(worker.name);
    if (!fn) return;

    const store = this.store;
    let consumed = false;
    const input = (async function* () {
      for await (const r of store.list({ prefix: worker.selects, afterStamp: watermark })) {
        consumed = true;
        yield r;
      }
    })();

    const ctx: WorkerContext = {
      newStamp: () => store.newStamp(),
      read: (uri) => store.get(uri),
    };

    for await (const out of fn(input, ctx)) {
      await store.put(out);
      yield out;
    }

    if (consumed) {
      const completionStamp = await store.newStamp();
      await store.markCompleted(worker.name, completionStamp);
    }
  }
}
