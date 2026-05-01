# @statewalker/uri-graph

## What it is

A minimal persistent dependency graph for URI-shaped work. Every observable thing — a file, an extracted text, a chunk, an index, a transformed cell — is a URI. Each URI has a `Resource` (status, monotonic stamp, optional meta). `ResourceProcessor`s are async generators that consume a stream of resources and yield more; an `Engine` drives them to a fixpoint.

The package is small on purpose. Two storage interfaces, each with two interchangeable implementations:

- `ProcessorRegistry` — manages dependency declarations between processors (their `selects` and `emits` URI scheme prefixes). Backends: `MemoryProcessorRegistry`, `SqlProcessorRegistry`.
- `ResourceStore` — stores the resource event log and per-processor completion history (watermarks). Backends: `MemoryResourceStore`, `SqlResourceStore`.

Both halves are independent. You can mix and match (e.g. SQL resources + in-memory registry) and you can swap one without touching the other.

## Why it exists

To replace heavier scanner-style pipelines with a single algorithm that works for:

- file transformations (scan → extract → index)
- code transformations (TS/TSX → JS)
- code execution (ObservableHQ-style cells)
- in-process transient pipelines and durable ones, with the same code

The algorithm:

1. Each processor declares a single input scheme (`selects`) and a single output scheme (`emits`).
2. The engine reads the processor's last completion stamp from the resource store.
3. It streams every resource whose latest event has `stamp > watermark` and whose URI begins with `selects` into the processor.
4. The processor yields output resources, each carrying a fresh stamp from `ctx.newStamp()`. Each yield is persisted by the engine immediately.
5. On clean completion, the engine mints another stamp and writes it to `completions(processor, stamp)`. By construction this stamp is greater than every input or output stamp the run touched.
6. `stabilize()` repeats this round until no processor progressed.

Crash safety falls out: outputs are URI-keyed (idempotent on retry); the completion row is the last write of a run. A crashed run leaves no completion; the next round re-executes the same inputs and overwrites the same output URIs.

## How to use

```sh
pnpm add @statewalker/uri-graph
```

```ts
import {
  Engine,
  MemoryProcessorRegistry,
  MemoryResourceStore,
  type ResourceProcessorFn,
} from "@statewalker/uri-graph";

const registry = new MemoryProcessorRegistry();
const store = new MemoryResourceStore();
const engine = new Engine({ registry, store });

const scanner: ResourceProcessorFn = async function* (input, ctx) {
  for await (const _tick of input) {
    const stamp = await ctx.newStamp();
    yield { uri: "file://a.md", stamp, status: "added" };
    yield { uri: "file://b.md", stamp, status: "added" };
  }
};

const extractor: ResourceProcessorFn = async function* (input, ctx) {
  for await (const r of input) {
    if (!r.uri.endsWith(".md")) continue;
    const stamp = await ctx.newStamp();
    yield { uri: `text://${r.uri.slice("file://".length)}`, stamp, status: r.status };
  }
};

await engine.register({ name: "scanner", selects: "tick://", emits: "file://" }, scanner);
await engine.register({ name: "extractor", selects: "file://", emits: "text://" }, extractor);

// publish a tick to wake up the source processor
await store.put({ uri: "tick://run", stamp: await store.newStamp(), status: "updated" });

for await (const r of engine.stabilize()) {
  console.log(r.uri, r.stamp, r.status);
}
```

### Choosing backends

| Concern | Memory | SQL |
|---|---|---|
| `ProcessorRegistry` | `MemoryProcessorRegistry` | `SqlProcessorRegistry(db)` |
| `ResourceStore` | `MemoryResourceStore` | `SqlResourceStore(db)` |
| Best for | unit tests, in-memory cell evaluation, scratch pipelines | daemons, durable indexes, cross-restart work |

```ts
import { newNodeTursoDb } from "@statewalker/db-turso-node";
import {
  Engine,
  SqlProcessorRegistry,
  SqlResourceStore,
} from "@statewalker/uri-graph";

const db = await newNodeTursoDb({ path: "./graph.db" });
const engine = new Engine({
  registry: new SqlProcessorRegistry(db),
  store: new SqlResourceStore(db),
});
// ... register, stabilize ...
await db.close(); // caller owns the Db
```

Mixing is fine — e.g. SQL-backed resources for durability with an in-memory registry that you re-populate at startup:

```ts
const engine = new Engine({
  registry: new MemoryProcessorRegistry(),
  store: new SqlResourceStore(db),
});
```

`ResourceProcessorFn`s do not branch on backend.

### Operator actions

- `store.invalidate(prefix)` — appends `'removed'` events for every live URI under the prefix. Downstream processors see these on the next `stabilize()` and cascade.
- `store.purgeResources({ keepLatestPerUri: true })` — collapses the event log to one row per URI.
- `store.purgeCompletions({ keepLatestPerProcessor: N })` — trims completion history.
- `engine.unregister(name)` — removes the processor from the registry; resources and history stay.

### Introspection

```ts
import { topoLayers } from "@statewalker/uri-graph";

const layers = topoLayers(processors);
// [[p1, p2], [p3], [p4, p5]] — processors in the same layer are independent
```

`topoLayers` is for visualization and parallel scheduling decisions. The engine itself does not use it: the fixpoint loop is data-driven by stamps.

## Internals

### Storage shape

`ResourceStore` (SQL backend): three append-only tables plus a stamp counter.

```
stamp_seq    (id=1, next)                — single-row counter
resources    (uri, stamp, status, meta)    PK (uri, stamp)
completions  (processor, stamp, finished_at)  PK (processor, stamp)
```

`ProcessorRegistry` (SQL backend): one CRUD table.

```
processors   (name, selects, emits)
```

The two halves don't share tables — each backend class manages its own `CREATE TABLE IF NOT EXISTS` against the `Db` you give it. They can share the same `Db` or be backed by different ones.

### Watermark semantics

A row in `completions(processor, stamp)` means: *this processor has fully processed every resource that existed when that stamp was minted.* The completion stamp is minted after the run finishes, so it is strictly greater than every output stamp produced by the run, which is in turn greater than every input stamp consumed.

A processor that consumes input but produces nothing (filter case) still advances its watermark — the engine writes a completion row whenever the input stream yielded at least one resource. A processor that finds no input writes no completion row and re-runs cheaply on the next round.

### Crash safety

- `put(resource)` is `INSERT OR REPLACE` keyed by `(uri, stamp)`; safe to re-emit the same URI/stamp pair.
- `markCompleted` runs only on clean generator completion; a crash leaves the watermark unchanged.
- On restart, the engine sees the unchanged watermark and re-runs the processor with the same inputs. Processors are required to be deterministic on URI keys; re-emitted outputs overwrite previous ones.

### Constraints

- Single-writer engine. Multi-process is out of scope; if you need it, run a single engine and feed work in.
- `selects` and `emits` are scheme prefixes, not glob patterns. If you need finer filtering, do it inside the processor.
- Processors must produce deterministic output URIs (a function of input, never of time/randomness). Re-running yields the same URIs and overwrites prior values.
- `MemoryResourceStore` keeps full state in memory; not intended for huge graphs.

## Related

- `@statewalker/db-api` — abstract `Db` interface used by `Sql*` backends.
- `@statewalker/db-turso-node`, `@statewalker/db-turso-browser` — libSQL adapters that implement `Db`.

## License

MIT.
