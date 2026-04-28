import type { ReadOnlyView } from "../../types/update.js";
import type {
  BeginTransactionOpts,
  GraphStore,
  GraphTransaction,
  RecoverOrphansResult,
  RegisterWorkerInput,
  RegisterWorkerResult,
} from "../types.js";
import type { LockId, MemoryPersistence } from "./persistence.js";
import { dumpFromState, stateFromDump } from "./snapshot.js";
import { createEmptyState, internUri, type State } from "./state.js";
import { MemoryTransaction } from "./transaction.js";

export type MemoryGraphStoreOptions = MemoryPersistence;

function uriMatchesLikePattern(text: string, pattern: string): boolean {
  // Translate SQL LIKE pattern (% any, _ one) to a RegExp.
  let re = "^";
  for (const ch of pattern) {
    if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  re += "$";
  return new RegExp(re).test(text);
}

export class MemoryGraphStore implements GraphStore {
  private persistence: MemoryPersistence;
  private state: State = createEmptyState();
  private lockId: LockId | null = null;
  private initialized = false;
  private closed = false;

  constructor(options: MemoryGraphStoreOptions) {
    this.persistence = options;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.lockId = await this.persistence.lock(this.persistence.key);
    const dump = await this.persistence.load(this.lockId);
    this.state = stateFromDump(dump);
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.lockId !== null) {
      await this.persistence.unlock(this.lockId);
      this.lockId = null;
    }
  }

  private async flush(): Promise<void> {
    if (this.lockId === null) return;
    await this.persistence.store(this.lockId, dumpFromState(this.state));
  }

  async getState(uri: string): Promise<ReadOnlyView | null> {
    const id = this.state.uriIdByText.get(uri);
    if (id === undefined) return null;
    const entry = this.state.uriState.get(id);
    if (!entry) return null;
    return {
      uri,
      stamp: entry.stamp,
      status: entry.status,
      hash: entry.hash,
      attributes: entry.attributes,
    };
  }

  async *find(pattern: string): AsyncIterable<ReadOnlyView> {
    for (const [uriId, entry] of this.state.uriState) {
      const text = this.state.uriById.get(uriId);
      if (text === undefined) continue;
      if (!uriMatchesLikePattern(text, pattern)) continue;
      yield {
        uri: text,
        stamp: entry.stamp,
        status: entry.status,
        hash: entry.hash,
        attributes: entry.attributes,
      };
    }
  }

  async priorOutputs(workerName: string, inputUri: string): Promise<ReadOnlyView[]> {
    const inputId = this.state.uriIdByText.get(inputUri);
    if (inputId === undefined) return [];

    let bestRunId: number | undefined;
    for (const run of this.state.runs.values()) {
      if (run.action !== workerName) continue;
      if (run.outcome !== "success") continue;
      const inputs = this.state.runInput.get(run.id) ?? [];
      const observed = inputs.some((i) => i.uriId === inputId);
      if (!observed) continue;
      if (bestRunId === undefined || run.id > bestRunId) {
        bestRunId = run.id;
      }
    }
    if (bestRunId === undefined) return [];
    const outputs = this.state.runOutput.get(bestRunId) ?? [];
    const result: ReadOnlyView[] = [];
    for (const o of outputs) {
      const uri = this.state.uriById.get(o.uriId);
      if (uri === undefined) continue;
      const entry = this.state.uriState.get(o.uriId);
      if (!entry) continue;
      result.push({
        uri,
        stamp: entry.stamp,
        status: entry.status,
        hash: entry.hash,
        attributes: entry.attributes,
      });
    }
    return result;
  }

  async beginTransaction(opts: BeginTransactionOpts): Promise<GraphTransaction> {
    const runId = this.state.nextRunId++;
    this.state.runs.set(runId, {
      id: runId,
      action: opts.worker,
      actionVersion: opts.version,
      scope: opts.scope,
      stamp: opts.initialStamp,
      startedAt: Date.now(),
      finishedAt: null,
      outcome: "running",
    });
    await this.flush();
    return new MemoryTransaction(runId, {
      state: this.state,
      flush: () => this.flush(),
    });
  }

  async mintStamp(): Promise<number> {
    this.state.stampSeq += 1;
    return this.state.stampSeq;
  }

  async recoverOrphans(): Promise<RecoverOrphansResult> {
    let cancelled = 0;
    let pendingRowsDropped = 0;
    for (const run of this.state.runs.values()) {
      if (run.outcome !== "running") continue;
      run.outcome = "cancelled";
      run.finishedAt = Date.now();
      cancelled += 1;
      const pendingForRun = this.state.pending.get(run.id);
      if (pendingForRun) {
        pendingRowsDropped += pendingForRun.size;
        this.state.pending.delete(run.id);
      }
      this.state.runInput.delete(run.id);
      this.state.runOutput.delete(run.id);
    }
    if (cancelled > 0) await this.flush();
    return { cancelled, pendingRowsDropped };
  }

  async registerWorker(def: RegisterWorkerInput): Promise<RegisterWorkerResult> {
    const existing = this.state.workers.get(def.name);
    const versionChanged = !existing || existing.version !== def.version;
    this.state.workers.set(def.name, {
      name: def.name,
      version: def.version,
      description: def.description ?? null,
      inputPattern: def.inputPattern ?? null,
      outputPattern: def.outputPattern ?? null,
      scopeExpr: def.scopeExpr ?? null,
      registeredAt: existing ? existing.registeredAt : Date.now(),
      lastRunAt: existing ? existing.lastRunAt : null,
    });
    if (versionChanged) await this.flush();
    return { versionChanged };
  }

  async lastSuccessfulRunVersion(workerName: string, inputUri: string): Promise<string | null> {
    const inputId = this.state.uriIdByText.get(inputUri);
    if (inputId === undefined) return null;
    let bestRun: { id: number; version: string } | undefined;
    for (const run of this.state.runs.values()) {
      if (run.action !== workerName || run.outcome !== "success") continue;
      const inputs = this.state.runInput.get(run.id) ?? [];
      if (!inputs.some((i) => i.uriId === inputId)) continue;
      if (!bestRun || run.id > bestRun.id) {
        bestRun = { id: run.id, version: run.actionVersion };
      }
    }
    return bestRun ? bestRun.version : null;
  }

  async isInputProcessed(
    workerName: string,
    workerVersion: string,
    inputUri: string,
  ): Promise<boolean> {
    const inputId = this.state.uriIdByText.get(inputUri);
    if (inputId === undefined) return false;
    const currentStamp = this.state.uriState.get(inputId)?.stamp ?? 0;
    for (const run of this.state.runs.values()) {
      if (run.action !== workerName || run.outcome !== "success") continue;
      if (run.actionVersion !== workerVersion) continue;
      const inputs = this.state.runInput.get(run.id) ?? [];
      const obs = inputs.find((i) => i.uriId === inputId);
      if (!obs) continue;
      if (obs.observedStamp >= currentStamp) return true;
    }
    return false;
  }

  /** Internal helper used in tests when interning a URI on read paths. */
  internUri(text: string): number {
    return internUri(this.state, text);
  }
}
