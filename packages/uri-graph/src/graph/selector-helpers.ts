import type { GraphReader, GraphStore } from "../store/types.js";
import type { Update } from "../types/update.js";

export interface FindDirtyOptions {
  forWorker: string;
  forVersion: string;
  uriLike: string;
  limit: number;
}

/**
 * Yields `Update`s for URIs matching `uriLike` that the worker has NOT processed
 * at its current version. Stops at `limit` URIs.
 *
 * Synthesizes one `Update` per matching URI from the URI's committed state.
 * Sets `scope = uri` and `role = undefined`; multi-input workers should compose
 * multiple `findDirty` calls via `joinInputs`.
 */
export async function* findDirty(
  graph: GraphStore,
  opts: FindDirtyOptions,
): AsyncIterableIterator<Update> {
  let yielded = 0;
  for await (const view of graph.find(opts.uriLike)) {
    if (yielded >= opts.limit) break;
    const processed = await graph.isInputProcessed(opts.forWorker, opts.forVersion, view.uri);
    if (processed) continue;
    yielded += 1;
    yield {
      uri: view.uri,
      stamp: view.stamp,
      status: view.status,
      hash: view.hash,
      scope: view.uri,
      attributes: view.attributes,
    };
  }
}

/**
 * Merges multiple `Update` streams, yielding all updates ordered by `(scope, role, uri)`.
 * Inputs SHOULD already be ordered by scope so the merge is k-way; otherwise the
 * helper buffers and sorts which may use more memory.
 */
export async function* joinInputs(
  ...streams: Array<AsyncIterable<Update>>
): AsyncIterableIterator<Update> {
  const all: Update[] = [];
  await Promise.all(
    streams.map(async (s) => {
      for await (const u of s) all.push(u);
    }),
  );
  all.sort((a, b) => {
    const sa = a.scope ?? "";
    const sb = b.scope ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    const ra = a.role ?? "";
    const rb = b.role ?? "";
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
  });
  yield* all;
}

/**
 * A trivially-empty selector. Useful for source workers that need a non-empty
 * tick selector to be polled by the orchestrator. Yields a single sentinel update.
 */
export async function* singleTickSelector(workerName: string): AsyncIterableIterator<Update> {
  yield {
    uri: `tick://${workerName}`,
    stamp: 0,
    status: "updated",
  };
}

// Re-export GraphReader so consumers writing custom selectors can type their context.
export type { GraphReader };
