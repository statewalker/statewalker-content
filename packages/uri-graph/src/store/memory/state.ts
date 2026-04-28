import type { Status } from "../../types/update.js";

export interface UriStateEntry {
  status: Status;
  stamp: number;
  hash?: string;
  attributes?: Record<string, unknown>;
}

export interface PendingEntry extends UriStateEntry {
  uriId: number;
}

export type RunOutcome = "running" | "success" | "cancelled" | "error";

export interface RunRow {
  id: number;
  action: string;
  actionVersion: string;
  scope: string | null;
  stamp: number;
  startedAt: number;
  finishedAt: number | null;
  outcome: RunOutcome;
}

export interface RunInputRow {
  uriId: number;
  role: string | null;
  observedStamp: number;
}

export interface RunOutputRow {
  uriId: number;
  writtenStamp: number;
  wasNoop: boolean;
}

export interface WorkerRegistryEntry {
  name: string;
  version: string;
  description: string | null;
  inputPattern: string | null;
  outputPattern: string | null;
  scopeExpr: string | null;
  registeredAt: number;
  lastRunAt: number | null;
}

/** Internal state kept in memory by `MemoryGraphStore`. */
export interface State {
  schemaVersion: 1;
  uriById: Map<number, string>;
  uriIdByText: Map<string, number>;
  nextUriId: number;
  uriState: Map<number, UriStateEntry>;
  pending: Map<number, Map<number, PendingEntry>>; // runId → uriId → entry
  runs: Map<number, RunRow>;
  nextRunId: number;
  runInput: Map<number, RunInputRow[]>;
  runOutput: Map<number, RunOutputRow[]>;
  workers: Map<string, WorkerRegistryEntry>;
  stampSeq: number;
}

export function createEmptyState(): State {
  return {
    schemaVersion: 1,
    uriById: new Map(),
    uriIdByText: new Map(),
    nextUriId: 1,
    uriState: new Map(),
    pending: new Map(),
    runs: new Map(),
    nextRunId: 1,
    runInput: new Map(),
    runOutput: new Map(),
    workers: new Map(),
    stampSeq: 0,
  };
}

export function internUri(state: State, text: string): number {
  const existing = state.uriIdByText.get(text);
  if (existing !== undefined) return existing;
  const id = state.nextUriId++;
  state.uriById.set(id, text);
  state.uriIdByText.set(text, id);
  return id;
}

export function getUriId(state: State, text: string): number | undefined {
  return state.uriIdByText.get(text);
}
