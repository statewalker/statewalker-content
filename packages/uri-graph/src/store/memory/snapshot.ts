import type { Dump } from "./persistence.js";
import {
  createEmptyState,
  type RunInputRow,
  type RunOutputRow,
  type RunRow,
  type State,
  type UriStateEntry,
  type WorkerRegistryEntry,
} from "./state.js";

interface SerializedUriState {
  uri: string;
  status: UriStateEntry["status"];
  stamp: number;
  hash?: string;
  attributes?: Record<string, unknown>;
}

interface SerializedRun extends Omit<RunRow, "id"> {
  id: number;
  inputs: Array<{ uri: string; role: string | null; observedStamp: number }>;
  outputs: Array<{ uri: string; writtenStamp: number; wasNoop: boolean }>;
}

export interface Snapshot {
  schemaVersion: 1;
  uris: Array<{ id: number; text: string }>;
  state: SerializedUriState[];
  runs: SerializedRun[];
  workers: WorkerRegistryEntry[];
  stampSeq: number;
  nextUriId: number;
  nextRunId: number;
}

export function serialize(state: State): Snapshot {
  const liveUriIds = new Set<number>();
  for (const uriId of state.uriState.keys()) liveUriIds.add(uriId);
  for (const run of state.runs.values()) {
    for (const ri of state.runInput.get(run.id) ?? []) liveUriIds.add(ri.uriId);
    for (const ro of state.runOutput.get(run.id) ?? []) liveUriIds.add(ro.uriId);
  }

  const stateRows: SerializedUriState[] = [];
  for (const [uriId, entry] of state.uriState) {
    const text = state.uriById.get(uriId);
    if (text === undefined) continue;
    stateRows.push({
      uri: text,
      status: entry.status,
      stamp: entry.stamp,
      hash: entry.hash,
      attributes: entry.attributes,
    });
  }
  stateRows.sort((a, b) => a.uri.localeCompare(b.uri));

  const runs: SerializedRun[] = [];
  for (const run of state.runs.values()) {
    const inputs: SerializedRun["inputs"] = [];
    for (const ri of state.runInput.get(run.id) ?? []) {
      const text = state.uriById.get(ri.uriId);
      if (text === undefined) continue;
      inputs.push({ uri: text, role: ri.role, observedStamp: ri.observedStamp });
    }
    const outputs: SerializedRun["outputs"] = [];
    for (const ro of state.runOutput.get(run.id) ?? []) {
      const text = state.uriById.get(ro.uriId);
      if (text === undefined) continue;
      outputs.push({
        uri: text,
        writtenStamp: ro.writtenStamp,
        wasNoop: ro.wasNoop,
      });
    }
    runs.push({ ...run, inputs, outputs });
  }
  runs.sort((a, b) => a.id - b.id);

  const uris: Snapshot["uris"] = [];
  for (const [id, text] of state.uriById) {
    if (!liveUriIds.has(id)) continue;
    uris.push({ id, text });
  }
  uris.sort((a, b) => a.id - b.id);

  const workers: WorkerRegistryEntry[] = [];
  for (const w of state.workers.values()) workers.push(w);
  workers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    schemaVersion: 1,
    uris,
    state: stateRows,
    runs,
    workers,
    stampSeq: state.stampSeq,
    nextUriId: state.nextUriId,
    nextRunId: state.nextRunId,
  };
}

export function deserialize(snapshot: Snapshot): State {
  if (snapshot.schemaVersion !== 1) {
    throw new Error(`Unknown snapshot schemaVersion: ${snapshot.schemaVersion}`);
  }
  const state = createEmptyState();
  state.stampSeq = snapshot.stampSeq;
  state.nextUriId = snapshot.nextUriId;
  state.nextRunId = snapshot.nextRunId;

  for (const u of snapshot.uris) {
    state.uriById.set(u.id, u.text);
    state.uriIdByText.set(u.text, u.id);
  }
  for (const row of snapshot.state) {
    const id = state.uriIdByText.get(row.uri);
    if (id === undefined) continue;
    state.uriState.set(id, {
      status: row.status,
      stamp: row.stamp,
      hash: row.hash,
      attributes: row.attributes,
    });
  }
  for (const run of snapshot.runs) {
    const { inputs, outputs, ...rest } = run;
    state.runs.set(run.id, rest);
    const inputRows: RunInputRow[] = [];
    for (const i of inputs) {
      const id = state.uriIdByText.get(i.uri);
      if (id === undefined) continue;
      inputRows.push({
        uriId: id,
        role: i.role,
        observedStamp: i.observedStamp,
      });
    }
    state.runInput.set(run.id, inputRows);
    const outputRows: RunOutputRow[] = [];
    for (const o of outputs) {
      const id = state.uriIdByText.get(o.uri);
      if (id === undefined) continue;
      outputRows.push({
        uriId: id,
        writtenStamp: o.writtenStamp,
        wasNoop: o.wasNoop,
      });
    }
    state.runOutput.set(run.id, outputRows);
  }
  for (const w of snapshot.workers) {
    state.workers.set(w.name, w);
  }
  return state;
}

export function dumpFromState(state: State): Dump {
  return serialize(state) as unknown as Dump;
}

export function stateFromDump(dump: Dump | null): State {
  if (dump === null || dump === undefined) return createEmptyState();
  // Validate shape minimally; deserialize will throw on schema mismatch.
  return deserialize(dump as Snapshot);
}
