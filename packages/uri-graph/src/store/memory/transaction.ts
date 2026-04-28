import type { Update } from "../../types/update.js";
import type { GraphTransaction } from "../types.js";
import { internUri, type State } from "./state.js";

export interface MemoryTransactionDeps {
  state: State;
  /** Called after commit/rollback to persist the snapshot. */
  flush: () => Promise<void>;
}

type TerminalState = "open" | "committed" | "rolledback";

export class MemoryTransaction implements GraphTransaction {
  readonly runId: number;
  private state: State;
  private flush: () => Promise<void>;
  private status: TerminalState = "open";

  constructor(runId: number, deps: MemoryTransactionDeps) {
    this.runId = runId;
    this.state = deps.state;
    this.flush = deps.flush;
  }

  private ensureOpen(op: string): void {
    if (this.status !== "open") {
      throw new Error(`transaction ${this.runId} is closed (${this.status}); cannot ${op}`);
    }
  }

  async applyUpdate(u: Update): Promise<void> {
    this.ensureOpen("applyUpdate");
    const uriId = internUri(this.state, u.uri);

    // No-op rule: skip staging if committed (status, hash) match.
    const committed = this.state.uriState.get(uriId);
    const isNoop =
      committed !== undefined && committed.status === u.status && committed.hash === u.hash;

    let pendingForRun = this.state.pending.get(this.runId);
    if (!pendingForRun) {
      pendingForRun = new Map();
      this.state.pending.set(this.runId, pendingForRun);
    }

    if (isNoop && committed) {
      // Record an output marker with prior stamp + wasNoop flag (deferred until commit).
      const outputs = this.state.runOutput.get(this.runId) ?? [];
      outputs.push({
        uriId,
        writtenStamp: committed.stamp,
        wasNoop: true,
      });
      this.state.runOutput.set(this.runId, outputs);
      return;
    }

    pendingForRun.set(uriId, {
      uriId,
      status: u.status,
      stamp: u.stamp,
      hash: u.hash,
      attributes: u.attributes,
    });
  }

  async recordInputs(
    inputs: ReadonlyArray<{
      uri: string;
      observedStamp: number;
      role?: string;
    }>,
  ): Promise<void> {
    this.ensureOpen("recordInputs");
    const rows = this.state.runInput.get(this.runId) ?? [];
    for (const i of inputs) {
      const id = internUri(this.state, i.uri);
      rows.push({
        uriId: id,
        role: i.role ?? null,
        observedStamp: i.observedStamp,
      });
    }
    this.state.runInput.set(this.runId, rows);
  }

  async commit(): Promise<void> {
    this.ensureOpen("commit");
    this.status = "committed";

    // Promote pending → committed; record run_output for non-noop entries.
    const pendingForRun = this.state.pending.get(this.runId);
    const outputs = this.state.runOutput.get(this.runId) ?? [];
    if (pendingForRun) {
      for (const [uriId, entry] of pendingForRun) {
        this.state.uriState.set(uriId, {
          status: entry.status,
          stamp: entry.stamp,
          hash: entry.hash,
          attributes: entry.attributes,
        });
        outputs.push({
          uriId,
          writtenStamp: entry.stamp,
          wasNoop: false,
        });
      }
    }
    this.state.runOutput.set(this.runId, outputs);
    this.state.pending.delete(this.runId);

    const run = this.state.runs.get(this.runId);
    if (run) {
      run.outcome = "success";
      run.finishedAt = Date.now();
    }
    await this.flush();
  }

  async rollback(): Promise<void> {
    this.ensureOpen("rollback");
    this.status = "rolledback";
    this.state.pending.delete(this.runId);
    this.state.runInput.delete(this.runId);
    this.state.runOutput.delete(this.runId);
    const run = this.state.runs.get(this.runId);
    if (run) {
      run.outcome = "cancelled";
      run.finishedAt = Date.now();
    }
    await this.flush();
  }
}
