import type { GraphStore, GraphTransaction } from "../store/types.js";
import type { Update } from "../types/update.js";
import type { WorkerDefinition, WorkerParams } from "../types/worker.js";

export interface DrainOptions {
  /** Yield to the event loop after every N committed updates. */
  yieldEveryN?: number;
  /** Warn if a logical transaction stays open longer than this many ms. */
  txnWarnMs?: number;
  /** Hook for warnings (used in tests). */
  onWarn?: (msg: string) => void;
  /** AbortSignal forwarded to the worker's run. */
  signal?: AbortSignal;
}

export interface DrainResult {
  /** Number of commits that produced at least one non-noop write. */
  committedWithChanges: number;
  /** Number of commits regardless of changes. */
  commits: number;
}

/**
 * Drives a `WorkerDefinition.run` to completion against an `input` stream:
 *   - opens a logical transaction at the first yield of a new stamp,
 *   - applies every same-stamp update under that transaction,
 *   - commits at the stamp boundary and opens the next,
 *   - rolls back on generator throw,
 *   - asserts stamp monotonicity per generator invocation,
 *   - records every consumed input into the current run.
 *
 * Returns when the generator exhausts (success) or throws (error rethrown).
 */
export async function drain(
  worker: WorkerDefinition,
  input: AsyncIterable<Update>,
  graph: GraphStore,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const yieldEveryN = opts.yieldEveryN ?? 100;
  const txnWarnMs = opts.txnWarnMs ?? 200;
  const warn = opts.onWarn ?? ((m) => console.warn(m));
  const signal = opts.signal ?? new AbortController().signal;

  // Tee input so we record every consumed update against the current run.
  const consumed: Update[] = [];
  async function* teeInput(): AsyncGenerator<Update> {
    for await (const u of input) {
      consumed.push(u);
      yield u;
    }
  }

  const params: WorkerParams = {
    stamp: () => graph.mintStamp(),
    read: (uri) => graph.getState(uri),
    find: (pattern) => graph.find(pattern),
    priorOutputs: (uri) => graph.priorOutputs(worker.name, uri),
    recordRead: (uri, role) => {
      consumed.push({
        uri,
        stamp: 0,
        status: "updated",
        ...(role !== undefined ? { role } : {}),
      });
    },
    signal,
  };

  let txn: GraphTransaction | undefined;
  let currentStamp: number | undefined;
  let txnOpenedAt = 0;
  let yieldedCount = 0;

  // Inputs consumed since last commit; flushed atomically with the commit.
  const consumedAtCommit: Update[] = [];

  async function openTransaction(forStamp: number): Promise<void> {
    txn = await graph.beginTransaction({
      worker: worker.name,
      version: worker.version,
      scope: null,
      initialStamp: forStamp,
    });
    txnOpenedAt = performance.now();
  }

  async function commitCurrent(): Promise<void> {
    if (!txn) return;
    if (consumedAtCommit.length > 0) {
      await txn.recordInputs(
        consumedAtCommit.map((u) => ({
          uri: u.uri,
          observedStamp: u.stamp,
          ...(u.role !== undefined ? { role: u.role } : {}),
        })),
      );
      consumedAtCommit.length = 0;
    }
    const elapsed = performance.now() - txnOpenedAt;
    if (elapsed > txnWarnMs) {
      warn(`${worker.name} stamp ${currentStamp} held logical txn ${elapsed.toFixed(0)}ms`);
    }
    await txn.commit();
    txn = undefined;
  }

  async function rollbackCurrent(): Promise<void> {
    if (!txn) return;
    try {
      await txn.rollback();
    } finally {
      txn = undefined;
    }
  }

  const gen = worker.run(params, teeInput());
  let commits = 0;
  try {
    while (true) {
      const next = await gen.next();
      if (next.done) break;
      const u = next.value;

      // Stamp regression guard.
      if (currentStamp !== undefined && u.stamp < currentStamp) {
        throw new Error(`stamp regression in ${worker.name}: ${currentStamp} → ${u.stamp}`);
      }

      // Stamp boundary: close prior batch, open new one.
      if (currentStamp !== undefined && u.stamp !== currentStamp) {
        await commitCurrent();
        commits += 1;
      }
      if (!txn) {
        await openTransaction(u.stamp);
      }
      // Always move newly-consumed inputs into the active batch.
      consumedAtCommit.push(...consumed);
      consumed.length = 0;

      currentStamp = u.stamp;
      if (!txn) throw new Error("internal: txn missing");
      await txn.applyUpdate(u);

      yieldedCount += 1;
      if (yieldedCount % yieldEveryN === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }

    if (txn) {
      await commitCurrent();
      commits += 1;
    }
  } catch (err) {
    await rollbackCurrent();
    throw err;
  }
  return {
    commits,
    committedWithChanges: yieldedCount > 0 ? commits : 0,
  };
}
