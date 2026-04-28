import type { ReadOnlyView, Update } from "../types/update.js";

export interface GraphReader {
  getState(uri: string): Promise<ReadOnlyView | null>;
  find(pattern: string): AsyncIterable<ReadOnlyView>;
  priorOutputs(workerName: string, inputUri: string): Promise<ReadOnlyView[]>;
}

export interface BeginTransactionOpts {
  worker: string;
  version: string;
  scope: string | null;
  initialStamp: number;
}

export interface RegisterWorkerInput {
  name: string;
  version: string;
  description?: string;
  inputPattern?: string;
  outputPattern?: string;
  scopeExpr?: string;
}

export interface RegisterWorkerResult {
  versionChanged: boolean;
}

export interface RecoverOrphansResult {
  cancelled: number;
  pendingRowsDropped: number;
}

export interface GraphStore extends GraphReader {
  beginTransaction(opts: BeginTransactionOpts): Promise<GraphTransaction>;
  mintStamp(): Promise<number>;
  recoverOrphans(): Promise<RecoverOrphansResult>;
  registerWorker(def: RegisterWorkerInput): Promise<RegisterWorkerResult>;
  /**
   * Returns the latest successful run's action_version for the given worker against the given URI,
   * or null if no successful run exists. Used by selectors to detect version-bump invalidation.
   */
  lastSuccessfulRunVersion(workerName: string, inputUri: string): Promise<string | null>;
  /**
   * Returns true if the given worker has a successful run that observed inputUri at a stamp
   * greater than or equal to the URI's current committed stamp AND at the worker's current version.
   * Used by `findDirty`-style selectors.
   */
  isInputProcessed(workerName: string, workerVersion: string, inputUri: string): Promise<boolean>;
}

export interface GraphTransaction {
  readonly runId: number;
  applyUpdate(u: Update): Promise<void>;
  recordInputs(
    inputs: ReadonlyArray<{ uri: string; observedStamp: number; role?: string }>,
  ): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * Lifecycle helper. `openGraphStore(store)` runs schema setup + recovery and returns the store.
 * Backend-specific factories (`new MemoryGraphStore(...)`, `new SqlGraphStore(...)`) build the
 * raw store; `openGraphStore` makes it ready for use.
 */
export async function openGraphStore<T extends GraphStore & { initialize?: () => Promise<void> }>(
  store: T,
): Promise<T> {
  if (store.initialize) {
    await store.initialize();
  }
  await store.recoverOrphans();
  return store;
}
