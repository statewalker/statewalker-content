import type { GraphStore } from "../store/types.js";
import type { Update } from "../types/update.js";
import type { WorkerDefinition } from "../types/worker.js";
import { type DrainOptions, drain } from "./drain.js";

export interface OrchestratorOptions {
  graph: GraphStore;
  pollMs?: number;
  selectorBatchSize?: number;
  txnWarnMs?: number;
  yieldEveryN?: number;
  onWarn?: (msg: string) => void;
  /** Optional logger for run failures. Defaults to console.error. */
  onRunError?: (workerName: string, err: unknown) => void;
}

export interface OrchestratorStatusReport {
  running: boolean;
  workers: Array<{
    name: string;
    version: string;
  }>;
}

export interface Orchestrator {
  registerWorker(def: WorkerDefinition): Promise<void>;
  start(signal?: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<OrchestratorStatusReport>;
}

export function createOrchestrator(opts: OrchestratorOptions): Orchestrator {
  const pollMs = opts.pollMs ?? 200;
  const selectorBatchSize = opts.selectorBatchSize ?? 100;
  const drainOpts: DrainOptions = {
    yieldEveryN: opts.yieldEveryN,
    txnWarnMs: opts.txnWarnMs,
    onWarn: opts.onWarn,
  };
  const onRunError = opts.onRunError ?? ((name, e) => console.error(`worker ${name} failed:`, e));

  const workers: WorkerDefinition[] = [];
  let running = false;
  let internalSignal: AbortController | undefined;

  async function pollOnce(signal: AbortSignal): Promise<boolean> {
    let advanced = false;
    for (const w of workers) {
      if (signal.aborted) return advanced;
      const cursor = w.selector({
        workerName: w.name,
        workerVersion: w.version,
        limit: selectorBatchSize,
      });
      const stream = await drainIfNonEmpty(cursor);
      if (!stream) continue;
      try {
        const result = await drain(w, stream, opts.graph, {
          ...drainOpts,
          signal,
        });
        // Only treat as progress when the worker actually committed real outputs.
        // A worker whose run() consumes a sentinel tick and yields nothing must
        // not loop the orchestrator forever.
        if (result.committedWithChanges > 0) advanced = true;
      } catch (err) {
        onRunError(w.name, err);
      }
    }
    return advanced;
  }

  return {
    async registerWorker(def: WorkerDefinition): Promise<void> {
      await opts.graph.registerWorker({
        name: def.name,
        version: def.version,
        description: def.description,
        inputPattern: def.inputPattern,
        outputPattern: def.outputPattern,
        scopeExpr: def.scopeExpr,
      });
      workers.push(def);
    },
    async start(signal?: AbortSignal): Promise<void> {
      if (running) return;
      running = true;
      internalSignal = new AbortController();
      const composedSignal = mergeSignals(signal, internalSignal.signal);

      try {
        while (!composedSignal.aborted) {
          const advanced = await pollOnce(composedSignal);
          if (composedSignal.aborted) break;
          if (!advanced) {
            await sleep(pollMs, composedSignal);
          }
        }
      } finally {
        running = false;
      }
    },
    async stop(): Promise<void> {
      internalSignal?.abort();
    },
    async status(): Promise<OrchestratorStatusReport> {
      return {
        running,
        workers: workers.map((w) => ({ name: w.name, version: w.version })),
      };
    },
  };
}

async function drainIfNonEmpty<T>(
  it: AsyncIterableIterator<T>,
): Promise<AsyncIterableIterator<T> | null> {
  const first = await it.next();
  if (first.done) {
    if (it.return) await it.return(undefined);
    return null;
  }
  async function* prepended(): AsyncIterableIterator<T> {
    yield first.value;
    while (true) {
      const n = await it.next();
      if (n.done) return;
      yield n.value;
    }
  }
  return prepended();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function mergeSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      ctrl.abort();
      return ctrl.signal;
    }
    s.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

// Re-export Update for consumers writing tests against the orchestrator.
export type { Update };
