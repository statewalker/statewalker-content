export type Status = "added" | "updated" | "removed";

export type Resource = {
  uri: string;
  stamp: number;
  status: Status;
  meta?: unknown;
};

export type Worker = {
  name: string;
  selects: string;
  emits: string;
};

export type WorkerContext = {
  newStamp: () => Promise<number>;
  read: (uri: string) => Promise<Resource | undefined>;
};

export type WorkerFn = (
  input: AsyncIterable<Resource>,
  ctx: WorkerContext,
) => AsyncGenerator<Resource>;
