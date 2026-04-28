# @statewalker/uri-graph

## What it is

A persistent URI dependency graph kernel. Every observable thing — files, extracted texts, chunks, embeddings, indexes, diagnostics — is a URI with an `Update` (status, monotonic stamp, optional hash and attributes). Workers are async generators that consume `Update` streams and yield `Update` streams; a single-writer orchestrator drives them to a fixpoint over a persistent graph state.

The package ships two interchangeable storage backends behind one `GraphStore` interface:

- `MemoryGraphStore` — in-memory state with an abstract persistence interface (`{key, lock, load, store, unlock}`); ships a JSON-snapshot adapter over `FilesApi` and an in-process variant for tests.
- `SqlGraphStore` — libSQL/Turso (Node and browser/OPFS) via `@statewalker/db-api`'s `Db`.

A bundled worker library (file watcher, markdown/text/html extractors, chunker, embedder, indexer with in-memory FTS + vector backends) wires the canonical pipeline `file:// → text:// → chunk:// → embedding:// → index://`.

## Why it exists

Earlier scanner-style pipelines (extract / split / embed / index) each carried their own ad-hoc state and re-did work after restart. This package replaces them with a uniform URI-shaped graph that:

- Survives restarts. A crashed worker leaves no inconsistent state — `recoverOrphans` runs on every open.
- Avoids redundant work. The no-op rule (stamp bumps only on real content change) makes re-runs idempotent and stops downstream cascades when nothing changed.
- Composes cleanly. New file formats are added by writing one extractor; the watcher, chunker, embedder, and indexer are unchanged.
- Works in Node and browser. The same kernel runs over libSQL/Turso (Node + OPFS) or in-memory state with JSON persistence.

The two-backend split exists because lighter scenarios (tests, CLI scripts, browsers without OPFS) do not need a SQL engine, and because the `MemoryGraphStore` boots faster — but worker code must not branch on backend.

## How to use

```sh
pnpm add @statewalker/uri-graph
```

Pick a backend, register workers, run the orchestrator to fixpoint:

```ts
import {
  createOrchestrator,
  openGraphStore,
  MemoryGraphStore,
  createInMemoryPersistence,
  createFileWatcher,
  createMarkdownExtractor,
  createChunker,
  createEmbedder,
  createIndexer,
  createMemoryFtsBackend,
  createMemoryVectorBackend,
} from "@statewalker/uri-graph";

const store = await openGraphStore(
  new MemoryGraphStore(createInMemoryPersistence()),
);
const orch = createOrchestrator({ graph: store });
await orch.registerWorker(createFileWatcher({ files, rootPath: "/" }));
await orch.registerWorker(createMarkdownExtractor({ files, graph: store }));
await orch.registerWorker(createChunker({ chunkSize: 1000, graph: store }));
await orch.registerWorker(createEmbedder({ graph: store, embed: yourEmbedFn }));
await orch.registerWorker(
  createIndexer({
    graph: store,
    fts: createMemoryFtsBackend(),
    vector: createMemoryVectorBackend(),
  }),
);

const ac = new AbortController();
await orch.start(ac.signal);
```

### Choosing a backend

| | `MemoryGraphStore` | `SqlGraphStore` |
|---|---|---|
| State | JS maps + JSON snapshot | libSQL tables |
| Persistence | `lock`/`load`/`store`/`unlock` callbacks | `Db` from `@statewalker/db-api` |
| Best for | tests, scripts, browser-without-OPFS | daemons, large graphs, OPFS browser |
| Same FTS + vector index store as graph | external | possible (FTS5 + `F32_BLOB` in same `Db`) |

## Examples

### Custom persistence for the memory store

The memory store does not depend on `FilesApi`. Pass any implementation of the persistence contract:

```ts
import {
  MemoryGraphStore,
  openGraphStore,
  type MemoryPersistence,
} from "@statewalker/uri-graph";

const persistence: MemoryPersistence = {
  key: "graph",
  async lock(key) {
    /* acquire — return a LockId */
  },
  async load(_id) {
    /* return prior dump (JSON) or null */
  },
  async store(_id, dump) {
    /* persist dump */
  },
  async unlock(_id) {
    /* release */
  },
};
const store = await openGraphStore(new MemoryGraphStore(persistence));
```

Two adapters ship: `createFilesPersistence(files, path)` (FilesApi/JSON, atomic via temp+move) and `createInMemoryPersistence(key?)` (process-local, no durability).

### SQL backend

```ts
import { newNodeTursoDb } from "@statewalker/db-turso-node";
import { SqlGraphStore, openGraphStore } from "@statewalker/uri-graph";

const db = await newNodeTursoDb({ path: "./graph.db" });
const store = await openGraphStore(new SqlGraphStore({ db }));
// ... use store ...
await db.close(); // caller owns Db lifecycle
```

### Writing a custom worker

```ts
import type { WorkerDefinition } from "@statewalker/uri-graph";
import { findDirty } from "@statewalker/uri-graph";

export function createUppercase(opts: { graph: GraphStore }): WorkerDefinition {
  return {
    name: "uppercase",
    version: "v1",
    inputPattern: "text:///%",
    outputPattern: "upper://**",
    selector: (ctx) =>
      findDirty(opts.graph, {
        forWorker: ctx.workerName,
        forVersion: ctx.workerVersion,
        uriLike: "text:///%",
        limit: ctx.limit,
      }),
    async *run(params, input) {
      for await (const doc of input) {
        const view = await params.read(doc.uri);
        const text = (view?.attributes?.text as string) ?? "";
        const stamp = await params.stamp();
        yield {
          uri: `upper://${doc.uri.slice("text:".length)}`,
          stamp,
          status: "updated",
          hash: text.toUpperCase().length.toString(),
          attributes: { text: text.toUpperCase() },
        };
      }
    },
  };
}
```

### Verifying both backends with one suite

The contract test suite is exported. New `GraphStore` implementations ride on the same tests:

```ts
import { defineGraphStoreContract } from "@statewalker/uri-graph";

defineGraphStoreContract("MyCustomStore", () => {
  return {
    async open() {
      /* return GraphStore */
    },
    async close(store) {
      /* tear down */
    },
  };
});
```

## Internals

### Architectural decisions

- **`GraphStore` is the abstraction, not raw SQL.** Lifting above `Db` lets `MemoryGraphStore` exist without a SQL-over-maps shim. Both backends pass the same `defineGraphStoreContract` suite — isofunctional by construction.
- **Logical transaction ≠ physical transaction.** A worker's stamp boundary opens a logical transaction; each `applyUpdate` runs as its own small physical transaction that stages writes into `uri_state_pending` (SQL) or a per-run pending map (memory). Promotion happens atomically on `commit`. Long worker calls between yields never hold writer locks.
- **Stamps bump only on real change (no-op rule).** The orchestrator compares `(status, hash)` against committed state. If unchanged, no stamp bump and no downstream cascade. This makes cycles terminate, replays safe, and "save without changes" cheap.
- **`advanced` requires committed yields.** Sentinel-tick selectors (file watcher) consume but produce no yields when nothing changed; the orchestrator treats those rounds as no-progress and sleeps. Without this guard, the fixpoint loop would spin.
- **Workers don't branch on backend.** The same `WorkerDefinition` runs against `MemoryGraphStore` and `SqlGraphStore`. The worker-library uses `findDirty(graph, ...)` selectors and `params.read(uri)` for live re-reads.
- **Memory persistence is abstract.** The store calls `lock(key)` once at open, then `load`/`store`/`unlock` against the resulting `LockId`. This decouples the store from any specific filesystem; FilesApi is one adapter, not a hard dependency.

### Schema (SQL backend)

Seven tables with the indexes shown below:

```
uri (id, text)                     ← URI interning
stamp_seq (id=1, next)             ← strictly monotonic stamps
worker_registry (name, version, …) ← worker metadata
uri_state (uri_id, status, stamp, hash, attributes)            ← committed truth
uri_state_pending (run_id, uri_id, …)                          ← staging
run (id, action, action_version, scope, stamp, outcome, …)    ← run history
run_input (run_id, uri_id, role, observed_stamp)              ← what each run consumed
run_output (run_id, uri_id, written_stamp, was_noop)          ← what each run produced
```

### Crash recovery

```
beginTransaction → flush running run row
applyUpdate × N  → no-op check; stage if changed (each = small physical txn)
commit           → promote staging → committed (single physical txn)
rollback         → drop staging, mark cancelled

crash anywhere   → on next openGraphStore, recoverOrphans:
                     UPDATE running runs → cancelled
                     DELETE pending rows for those runs
                     uri_state untouched
```

### Constraints

- Single-writer orchestrator. Multi-process is out of scope; OPFS already enforces single-writer in browser.
- `MemoryGraphStore` is one process per `key`. A second open against the same key throws "already open".
- `MemoryGraphStore` keeps full state in memory; not intended for 5M-URI workloads. Use `SqlGraphStore` at scale.
- Workers must produce deterministic output URIs (function of input, never of time/randomness). Re-run = same URIs, no orphans.
- Stamps within one generator invocation must be non-decreasing; the orchestrator throws on regression.

### Dependencies

- `@statewalker/db-api` — abstract `Db` interface (only used by SQL backend; declared as a regular dependency so consumers wiring `MemoryGraphStore` still get the type).
- `@statewalker/webrun-files` — `FilesApi` interface used by the file watcher / extractors and by the optional `createFilesPersistence` helper.
- Dev: `@statewalker/db-turso-node`, `@statewalker/webrun-files-mem`, `@types/node`, vitest, biome, tsdown, rimraf, typescript.

The kernel is environment-agnostic. Bootstrap helpers in `./node` and `./browser` are thin and pull in env-specific factories (`newNodeTursoDb` / `newBrowserTursoDb`, `NodeFilesApi` / `getOPFSFilesApi`).

## Related

- `@statewalker/db-api` — abstract DB interface used by `SqlGraphStore`.
- `@statewalker/db-turso-node` / `@statewalker/db-turso-browser` — libSQL adapters.
- `@statewalker/webrun-files` (and `-mem` / `-node` / `-browser`) — FilesApi interface and implementations.
- `@statewalker/content-pipeline` — earlier scanner-based pipeline this package is positioned to replace.

## License

MIT.
