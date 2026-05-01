export type Status = "added" | "updated" | "removed";

export type Resource = {
  uri: string;
  stamp: number;
  status: Status;
  meta?: unknown;
};

export type ResourceProcessor = {
  name: string;
  selects: string;
  emits: string;
};

export type ResourceProcessorContext = {
  newStamp: () => Promise<number>;
  read: (uri: string) => Promise<Resource | undefined>;
};

export type ResourceProcessorFn = (
  input: AsyncIterable<Resource>,
  ctx: ResourceProcessorContext,
) => AsyncGenerator<Resource>;

export type ListOptions = {
  prefix: string;
  afterStamp?: number;
};

export type PurgeResourcesOptions = {
  keepLatestPerUri?: boolean;
};

export type PurgeCompletionsOptions = {
  keepLatestPerProcessor?: number;
};

export interface ResourceStore {
  newStamp(): Promise<number>;

  put(resource: Resource): Promise<void>;
  get(uri: string): Promise<Resource | undefined>;
  list(options: ListOptions): AsyncIterable<Resource>;

  markCompleted(processor: string, stamp: number): Promise<void>;
  allWatermarks(): Promise<Map<string, number>>;

  invalidate(prefix: string): Promise<void>;

  purgeResources(options?: PurgeResourcesOptions): Promise<void>;
  purgeCompletions(options?: PurgeCompletionsOptions): Promise<void>;
}

export interface ProcessorRegistry {
  saveProcessor(processor: ResourceProcessor): Promise<void>;
  deleteProcessor(name: string): Promise<void>;
  getProcessor(name: string): Promise<ResourceProcessor | undefined>;
  listProcessors(): AsyncIterable<ResourceProcessor>;
}
