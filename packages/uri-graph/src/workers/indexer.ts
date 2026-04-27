import type { GraphStore } from "../store/types.js";
import type { Update } from "../types/update.js";
import type { WorkerDefinition, WorkerParams } from "../types/worker.js";
import { sha256Hex } from "../util/hash.js";
import type { FtsBackend } from "./index-backends/memory-fts.js";
import type { VectorBackend } from "./index-backends/memory-vector.js";

export interface IndexerOptions {
  fts: FtsBackend;
  vector: VectorBackend;
  /** Optional graph; when provided, the selector emits ready scopes. */
  graph?: GraphStore;
  name?: string;
  version?: string;
}

interface ScopeBag {
  text?: Update;
  chunks: Update[];
  embeddings: Update[];
}

function ftsUri(scope: string): string {
  return `index://fts/${scope}`;
}

function vectorUri(scope: string): string {
  return `index://vector/${scope}`;
}

/**
 * Multi-input indexer scoped by `text://` URI. Consumes interleaved updates
 * grouped by `scope` and `role` (text | chunk | embedding) and writes per-scope
 * entries to the configured FTS and vector backends.
 *
 * The indexer expects its input to be ordered by `scope` so that all rows for
 * one scope arrive contiguously. Use `joinInputs` to merge multiple selector
 * streams into a single ordered input.
 */
export function createIndexer(opts: IndexerOptions): WorkerDefinition {
  const name = opts.name ?? "indexer";
  const version = opts.version ?? "v1";

  return {
    name,
    version,
    description: "Builds FTS + vector indexes from text/chunk/embedding inputs.",
    inputPattern: "text:// + chunk:// + embedding://",
    outputPattern: "index://**",
    scopeExpr: "text_uri",
    selector: makeIndexerSelector(opts.graph),
    run: async function* (
      params: WorkerParams,
      input: AsyncIterable<Update>,
    ): AsyncGenerator<Update> {
      let currentScope: string | undefined;
      let bag: ScopeBag = { chunks: [], embeddings: [] };

      async function* flush(): AsyncGenerator<Update> {
        if (currentScope === undefined) return;
        yield* indexOne(opts, params, currentScope, bag);
        currentScope = undefined;
        bag = { chunks: [], embeddings: [] };
      }

      for await (const u of input) {
        if (params.signal.aborted) return;
        const scope = u.scope ?? u.uri;
        if (currentScope !== undefined && scope !== currentScope) {
          yield* flush();
        }
        currentScope = scope;
        if (u.role === "text") bag.text = u;
        else if (u.role === "chunk") bag.chunks.push(u);
        else if (u.role === "embedding") bag.embeddings.push(u);
        else if (u.uri.startsWith("text:")) bag.text = u;
        else if (u.uri.startsWith("chunk:")) bag.chunks.push(u);
        else if (u.uri.startsWith("embedding:")) bag.embeddings.push(u);
      }
      yield* flush();
    },
  };
}

function makeIndexerSelector(graph: GraphStore | undefined): WorkerDefinition["selector"] {
  if (!graph) {
    return async function* () {
      // Driven externally (test harness).
    };
  }
  return (ctx) => indexerSelector(graph, ctx.workerName, ctx.workerVersion, ctx.limit);
}

/**
 * Selector for the indexer: emit one stream of `(text, chunk*, embedding*)`
 * updates for each `text://` URI where every chunk has a matching embedding AND
 * the indexer has not run for that scope at its current version.
 *
 * Streams are ordered by scope so the run can group via `(currentScope, bag)`.
 */
async function* indexerSelector(
  graph: GraphStore,
  workerName: string,
  workerVersion: string,
  limit: number,
): AsyncIterableIterator<Update> {
  const scopes: string[] = [];
  for await (const v of graph.find("text:///%")) {
    if (v.status === "removed") {
      // Removed text — emit a single sentinel so the run can cascade.
      const processed = await graph.isInputProcessed(workerName, workerVersion, v.uri);
      if (!processed) scopes.push(v.uri);
      continue;
    }
    const processed = await graph.isInputProcessed(workerName, workerVersion, v.uri);
    if (processed) continue;
    // Verify all chunks have embeddings.
    const chunkPattern = `chunk:${v.uri.slice("text:".length)}#%`;
    let allEmbedded = true;
    let chunkCount = 0;
    for await (const c of graph.find(chunkPattern)) {
      if (c.status === "removed") continue;
      chunkCount += 1;
      const emb = await graph.getState(`embedding://${c.uri}`);
      if (!emb || emb.status === "removed") {
        allEmbedded = false;
        break;
      }
    }
    if (chunkCount === 0 || !allEmbedded) continue;
    scopes.push(v.uri);
  }

  for (const scope of scopes.slice(0, limit)) {
    const text = await graph.getState(scope);
    if (!text) continue;
    yield {
      uri: scope,
      stamp: text.stamp,
      status: text.status,
      hash: text.hash,
      scope,
      role: "text",
      attributes: text.attributes,
    };
    if (text.status === "removed") continue;

    const chunkPattern = `chunk:${scope.slice("text:".length)}#%`;
    const chunks: Array<{
      uri: string;
      stamp: number;
      status: Update["status"];
      hash?: string;
      attributes?: Record<string, unknown>;
    }> = [];
    for await (const c of graph.find(chunkPattern)) {
      chunks.push({
        uri: c.uri,
        stamp: c.stamp,
        status: c.status,
        hash: c.hash,
        attributes: c.attributes,
      });
    }
    chunks.sort((a, b) => a.uri.localeCompare(b.uri));
    for (const c of chunks) {
      yield {
        uri: c.uri,
        stamp: c.stamp,
        status: c.status,
        hash: c.hash,
        scope,
        role: "chunk",
        attributes: c.attributes,
      };
      const emb = await graph.getState(`embedding://${c.uri}`);
      if (!emb) continue;
      yield {
        uri: `embedding://${c.uri}`,
        stamp: emb.stamp,
        status: emb.status,
        hash: emb.hash,
        scope,
        role: "embedding",
        attributes: emb.attributes,
      };
    }
  }
}

async function* indexOne(
  opts: IndexerOptions,
  params: WorkerParams,
  scope: string,
  bag: ScopeBag,
): AsyncGenerator<Update> {
  // Removal: any "removed" text/chunk/embedding for this scope drops the indexes.
  if (bag.text && bag.text.status === "removed") {
    opts.fts.remove(scope);
    for (const c of bag.chunks) opts.vector.remove(c.uri);
    // Also drop any prior chunk-based vectors that may live under the scope's
    // chunks even if the chunks themselves weren't passed in.
    const stamp = await params.stamp();
    yield {
      uri: ftsUri(scope),
      stamp,
      status: "removed",
      scope,
      role: "fts-index",
    };
    yield {
      uri: vectorUri(scope),
      stamp,
      status: "removed",
      scope,
      role: "vector-index",
    };
    return;
  }

  // Build / update entries.
  const chunkTexts: string[] = [];
  for (const c of bag.chunks) {
    const t = (c.attributes as Record<string, unknown>)?.text as string;
    if (typeof t === "string") chunkTexts.push(t);
  }
  opts.fts.upsert(scope, chunkTexts);

  for (const e of bag.embeddings) {
    const v = (e.attributes as Record<string, unknown>)?.vector as number[] | undefined;
    if (!Array.isArray(v)) continue;
    const arr = new Float32Array(v);
    opts.vector.upsert(e.uri, arr);
  }

  const stamp = await params.stamp();
  const ftsHash = await sha256Hex(chunkTexts.join("\n"));
  const vecHash = await sha256Hex(bag.embeddings.map((e) => e.hash ?? "").join("|"));
  yield {
    uri: ftsUri(scope),
    stamp,
    status: "updated",
    hash: ftsHash,
    scope,
    role: "fts-index",
  };
  yield {
    uri: vectorUri(scope),
    stamp,
    status: "updated",
    hash: vecHash,
    scope,
    role: "vector-index",
  };
}
