import type { ReadOnlyView, Update } from "./update.js";

export interface WorkerParams {
  stamp: () => Promise<number>;
  read: (uri: string) => Promise<ReadOnlyView | null>;
  find: (pattern: string) => AsyncIterable<ReadOnlyView>;
  priorOutputs: (inputUri: string) => Promise<ReadOnlyView[]>;
  recordRead: (uri: string, role?: string) => void;
  signal: AbortSignal;
}

export interface SelectorContext {
  workerName: string;
  workerVersion: string;
  limit: number;
}

export type Selector = (ctx: SelectorContext) => AsyncIterableIterator<Update>;

export interface WorkerDefinition {
  name: string;
  version: string;
  description?: string;
  inputPattern?: string;
  outputPattern?: string;
  scopeExpr?: string;
  selector: Selector;
  run: (params: WorkerParams, input: AsyncIterable<Update>) => AsyncGenerator<Update>;
}
