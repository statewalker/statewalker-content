import type {
  ListOptions,
  PurgeCompletionsOptions,
  PurgeResourcesOptions,
  Resource,
  ResourceStore,
} from "../types.js";

export class MemoryResourceStore implements ResourceStore {
  private nextStampValue = 1;
  private resourcesByUri = new Map<string, Resource[]>();
  private completionsByProcessor = new Map<string, number[]>();

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

  async markCompleted(processor: string, stamp: number): Promise<void> {
    const arr = this.completionsByProcessor.get(processor);
    if (arr) arr.push(stamp);
    else this.completionsByProcessor.set(processor, [stamp]);
  }

  async allWatermarks(): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const [processor, stamps] of this.completionsByProcessor) {
      let max = 0;
      for (const s of stamps) if (s > max) max = s;
      result.set(processor, max);
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
    const keep = options?.keepLatestPerProcessor;
    if (keep === undefined || keep < 1) return;
    for (const [processor, stamps] of this.completionsByProcessor) {
      if (stamps.length > keep) {
        stamps.sort((a, b) => a - b);
        this.completionsByProcessor.set(processor, stamps.slice(stamps.length - keep));
      }
    }
  }
}
