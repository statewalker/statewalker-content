import type { Resource, Worker } from "../types.js";

export type ListOptions = {
  prefix: string;
  afterStamp?: number;
};

export type PurgeResourcesOptions = {
  keepLatestPerUri?: boolean;
};

export type PurgeCompletionsOptions = {
  keepLatestPerWorker?: number;
};

export interface Store {
  newStamp(): Promise<number>;

  put(resource: Resource): Promise<void>;
  get(uri: string): Promise<Resource | undefined>;
  list(options: ListOptions): AsyncIterable<Resource>;

  saveWorker(worker: Worker): Promise<void>;
  deleteWorker(name: string): Promise<void>;
  getWorker(name: string): Promise<Worker | undefined>;
  listWorkers(): AsyncIterable<Worker>;

  markCompleted(worker: string, stamp: number): Promise<void>;
  allWatermarks(): Promise<Map<string, number>>;

  invalidate(prefix: string): Promise<void>;

  purgeResources(options?: PurgeResourcesOptions): Promise<void>;
  purgeCompletions(options?: PurgeCompletionsOptions): Promise<void>;
}
