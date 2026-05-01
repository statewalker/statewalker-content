import type { Resource, Worker } from "../types.js";
import type {
  ListOptions,
  PurgeCompletionsOptions,
  PurgeResourcesOptions,
  Store,
} from "./store.js";

export class MemoryStore implements Store {
  private nextStampValue = 1;
  private resourcesByUri = new Map<string, Resource[]>();
  private workers = new Map<string, Worker>();
  private completionsByWorker = new Map<string, number[]>();

  async newStamp(): Promise<number> {
    return this.nextStampValue++;
  }

  async put(resource: Resource): Promise<void> {
    if (resource.stamp >= this.nextStampValue) {
      this.nextStampValue = resource.stamp + 1;
    }
    const arr = this.resourcesByUri.get(resource.uri);
    if (arr) {
      arr.push(resource);
    } else {
      this.resourcesByUri.set(resource.uri, [resource]);
    }
  }

  async get(uri: string): Promise<Resource | undefined> {
    const arr = this.resourcesByUri.get(uri);
    if (!arr || arr.length === 0) return undefined;
    return arr[arr.length - 1];
  }

  async *list(options: ListOptions): AsyncIterable<Resource> {
    const after = options.afterStamp ?? 0;
    const matches: Resource[] = [];
    for (const [uri, arr] of this.resourcesByUri) {
      if (!uri.startsWith(options.prefix)) continue;
      const latest = arr[arr.length - 1];
      if (latest && latest.stamp > after) matches.push(latest);
    }
    matches.sort((a, b) => a.stamp - b.stamp);
    for (const r of matches) yield r;
  }

  async saveWorker(worker: Worker): Promise<void> {
    this.workers.set(worker.name, { ...worker });
  }

  async deleteWorker(name: string): Promise<void> {
    this.workers.delete(name);
    this.completionsByWorker.delete(name);
  }

  async getWorker(name: string): Promise<Worker | undefined> {
    const w = this.workers.get(name);
    return w ? { ...w } : undefined;
  }

  async *listWorkers(): AsyncIterable<Worker> {
    for (const w of this.workers.values()) yield { ...w };
  }

  async markCompleted(worker: string, stamp: number): Promise<void> {
    const arr = this.completionsByWorker.get(worker);
    if (arr) arr.push(stamp);
    else this.completionsByWorker.set(worker, [stamp]);
  }

  async allWatermarks(): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const [worker, stamps] of this.completionsByWorker) {
      let max = 0;
      for (const s of stamps) if (s > max) max = s;
      result.set(worker, max);
    }
    return result;
  }

  async invalidate(prefix: string): Promise<void> {
    const stamp = await this.newStamp();
    for (const [uri, arr] of this.resourcesByUri) {
      if (!uri.startsWith(prefix)) continue;
      const latest = arr[arr.length - 1];
      if (!latest || latest.status === "removed") continue;
      arr.push({ uri, stamp, status: "removed" });
    }
  }

  async purgeResources(options?: PurgeResourcesOptions): Promise<void> {
    if (options?.keepLatestPerUri !== true) return;
    for (const [uri, arr] of this.resourcesByUri) {
      if (arr.length > 1) {
        const latest = arr[arr.length - 1];
        if (latest) this.resourcesByUri.set(uri, [latest]);
      }
    }
  }

  async purgeCompletions(options?: PurgeCompletionsOptions): Promise<void> {
    const keep = options?.keepLatestPerWorker;
    if (keep === undefined || keep < 1) return;
    for (const [worker, stamps] of this.completionsByWorker) {
      if (stamps.length > keep) {
        stamps.sort((a, b) => a - b);
        this.completionsByWorker.set(worker, stamps.slice(stamps.length - keep));
      }
    }
  }
}
