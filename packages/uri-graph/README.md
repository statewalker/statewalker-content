# @statewalker/uri-graph

## What it is

A minimal persistent dependency graph for URI-shaped work. Every observable thing — a file, an extracted text, a chunk, an index, a transformed cell — is a URI. Each URI has a `Resource` (status, monotonic stamp, optional meta). Workers are async generators that consume an input stream of resources and yield an output stream. A fixpoint engine drives them to convergence.

The package is small on purpose: one `Engine`, one `Store` interface with two interchangeable backends (`MemoryStore`, `SqlStore`), and a `topoLayers` helper for introspection. There is no run history, no staging table, no hash-based no-op rule, no scope/role machinery — those concerns either belong to the worker or are handled implicitly by the watermark.

## Why it exists

To replace heavier scanner-style pipelines with a single algorithm that works for:

- file transformations (scan → extract → index)
- code transformations (TS/TSX → JS)
- code execution (ObservableHQ-style cells)
- in-process transient pipelines and durable ones, with the same code

The algorithm:

1. Each worker declares a single input scheme (`selects`) and a single output scheme (`emits`).
2. The engine reads the worker's last completion stamp.
3. The engine streams every resource whose latest event has `stamp > watermark` and whose URI begins with `selects` into the worker.
4. The worker yields output resources, each carrying a fresh stamp it minted via `ctx.newStamp()`. Each yield is persisted immediately by the engine.
5. On clean completion, the engine mints another stamp and writes it to `completions(worker, stamp)`. By construction this stamp is larger than every input or output stamp the run touched.
6. `stabilize()` repeats this round until no worker progressed.

Crash safety falls out of the design: outputs are URI-keyed (idempotent on retry); the completion row is the last write of a run. A crashed run leaves no completion; the next round re-executes the same inputs and overwrites the same output URIs.

## How to use

```sh
pnpm add @statewalker/uri-graph
```

```ts
import { Engine, MemoryStore, type WorkerFn } from "@statewalker/uri-graph";

const store = new MemoryStore();
const engine = new Engine(store);

const scanner: WorkerFn = async function* (input, ctx) {
  for await (const _tick of input) {
    const stamp = await ctx.newStamp();
    yield { uri: "file://a.md", stamp, status: "added" };
    yield { uri: "file://b.md", stamp, status: "added" };
  }
};

const extractor: WorkerFn = async function* (input, ctx) {
  for await (const r of input) {
    if (!r.uri.endsWith(".md")) continue;
    const stamp = await ctx.newStamp();
    yield { uri: `text://${r.uri.slice("file://".length)}`, stamp, status: r.status };
  }
};

await engine.register({ name: "scanner", selects: "tick://", emits: "file://" }, scanner);
await engine.register({ name: "extractor", selects: "file://", emits: "text://" }, extractor);

// publish a tick to wake up the source worker
await store.put({ uri: "tick://run", stamp: await store.newStamp(), status: "updated" });

for await (const r of engine.stabilize()) {
  console.log(r.uri, r.stamp, r.status);
}
```

### Choosing a backend

| | `MemoryStore` | `SqlStore` |
|---|---|---|
| State | JS maps | libSQL/SQLite tables |
| Persistence | none (in-process) | the underlying `Db` |
| Best for | unit tests, in-memory cell evaluation, scratch pipelines | daemons, durable indexes, cross-restart work |

```ts
import { newNodeTursoDb } from "@statewalker/db-turso-node";
import { Engine, SqlStore } from "@statewalker/uri-graph";

const db = await newNodeTursoDb({ path: "./graph.db" });
const store = new SqlStore(db);
const engine = new Engine(store);
// ... register, stabilize ...
await db.close(); // caller owns the Db
```

Workers do not branch on backend. The same `WorkerFn` runs against either store.

### Operator actions

- `store.invalidate(prefix)` — appends `'removed'` events for every live URI under the prefix. Downstream workers see these on the next `stabilize()` and cascade.
- `store.purgeResources({ keepLatestPerUri: true })` — collapses the event log to one row per URI.
- `store.purgeCompletions({ keepLatestPerWorker: N })` — trims completion history.
- `engine.unregister(name)` — removes the worker and its completion rows; resources stay.

### Introspection

```ts
import { topoLayers } from "@statewalker/uri-graph";

const layers = topoLayers(workers);
// [[w1, w2], [w3], [w4, w5]] — workers in the same layer have no dependency between them
```

`topoLayers` is for visualization and parallel scheduling decisions. The engine itself does not use it: the fixpoint loop is data-driven by stamps.

## Internals

### Storage shape

Three append-only tables plus a worker registry and a stamp counter:

```
stamp_seq      (id=1, next)              — single-row counter, only UPDATE in the system
resources      (uri, stamp, status, meta)  PK (uri, stamp)
workers        (name, selects, emits)     CRUD
completions    (worker, stamp, finished_at) PK (worker, stamp)
```

`get(uri)` reads `MAX(stamp)` per URI. `list({ prefix, afterStamp })` joins each URI's max-stamp row and filters. `allWatermarks()` is `SELECT worker, MAX(stamp) FROM completions GROUP BY worker`. The same shape backs `MemoryStore`.

### Watermark semantics

A row in `completions(worker, stamp)` means: *this worker has fully processed every resource that existed when that stamp was minted.* Because the completion stamp is minted after the run finishes, it is strictly greater than every output stamp produced by the run, which is in turn greater than every input stamp consumed.

A worker that consumes input but produces nothing (filter case) still advances its watermark — the engine writes a completion row whenever the worker's input stream yielded at least one resource. A worker that finds no input writes no completion row and re-runs cheaply on the next round.

### Crash safety

- `put(resource)` is `INSERT OR REPLACE` keyed by `(uri, stamp)`; safe to re-emit the same URI/stamp pair.
- `markCompleted` runs only on clean generator completion; a crash leaves the watermark unchanged.
- On restart, the engine sees the unchanged watermark and re-runs the worker with the same inputs. Workers are required to be deterministic on URI keys; re-emitted outputs overwrite previous ones.

### Constraints

- Single-writer engine. Multi-process is out of scope; if you need it, run a single engine and feed work in.
- `selects` and `emits` are scheme prefixes, not glob patterns. If you need finer filtering, do it inside the worker.
- Workers must produce deterministic output URIs (a function of input, never of time/randomness). Re-running yields the same URIs and overwrites prior values.
- `MemoryStore` keeps full state in memory; not intended for huge graphs.

## Related

- `@statewalker/db-api` — abstract `Db` interface used by `SqlStore`.
- `@statewalker/db-turso-node`, `@statewalker/db-turso-browser` — libSQL adapters that implement `Db`.

## License

MIT.
