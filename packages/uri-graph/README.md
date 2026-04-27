# @statewalker/uri-graph

Persistent URI dependency graph kernel. Workers are async generators that consume `Update` streams and yield `Update` streams; a single-writer orchestrator drives them to a fixpoint over a persistent graph state.

Two interchangeable repository backends implement one `GraphStore` interface:

- `MemoryGraphStore` — in-memory state with an abstract persistence interface (`lock` / `load` / `store` / `unlock`). Ship with a JSON-snapshot adapter over `FilesApi` for filesystem persistence, or use the in-process variant for tests.
- `SqlGraphStore` — libSQL/Turso (Node and browser/OPFS) via `@statewalker/db-api`'s `Db`.

Both pass the same shared contract test suite (`defineGraphStoreContract`), so worker code is identical across backends.

## When to use which store

Use `MemoryGraphStore` when state fits in process memory and persistence is one JSON file (or none): tests, scripted ETL jobs, browser-without-OPFS, embedded scenarios. The persistence layer is abstract — you provide `lock` / `load` / `store` / `unlock` callbacks; the package ships an `FilesApi` helper and an in-process helper.

Use `SqlGraphStore` when graphs are large or need durable, query-friendly storage: long-lived daemons, multi-million-URI workloads, OPFS-backed browser deployments where the same libSQL database serves both the graph and the FTS5/vector index. Single-writer orchestration applies in both cases.

## Minimal Node bootstrap

```ts
import { newNodeTursoDb } from "@statewalker/db-turso-node";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import {
  createOrchestrator,
  openGraphStore,
  SqlGraphStore,
  createChunker,
  createEmbedder,
  createFileWatcher,
  createMarkdownExtractor,
  createIndexer,
  createMemoryFtsBackend,
  createMemoryVectorBackend,
} from "@statewalker/uri-graph";

const db = await newNodeTursoDb({ path: "./graph.db" });
const store = await openGraphStore(new SqlGraphStore({ db }));
const files = new MemFilesApi(); // or any FilesApi
const fts = createMemoryFtsBackend();
const vector = createMemoryVectorBackend();

const orch = createOrchestrator({ graph: store });
await orch.registerWorker(createFileWatcher({ files, rootPath: "/" }));
await orch.registerWorker(createMarkdownExtractor({ files, graph: store }));
await orch.registerWorker(createChunker({ chunkSize: 1000, graph: store }));
await orch.registerWorker(createEmbedder({ graph: store, embed: yourEmbedFn }));
await orch.registerWorker(createIndexer({ graph: store, fts, vector }));

const ac = new AbortController();
process.on("SIGINT", () => ac.abort());
await orch.start(ac.signal);
await db.close();
```

## Browser / OPFS

Same kernel, same workers. Swap `newNodeTursoDb` for `newBrowserTursoDb` (OPFS path) and `MemFilesApi` for an OPFS-backed `FilesApi`. `MemoryGraphStore` works in the browser too with the in-process persistence helper.

## See also

- Proposal: [openspec/changes/uri-dependency-graph-kernel/proposal.md](../../../../openspec/changes/uri-dependency-graph-kernel/proposal.md)
- Design: [openspec/changes/uri-dependency-graph-kernel/design.md](../../../../openspec/changes/uri-dependency-graph-kernel/design.md)
- Specs: [openspec/changes/uri-dependency-graph-kernel/specs/](../../../../openspec/changes/uri-dependency-graph-kernel/specs/)
