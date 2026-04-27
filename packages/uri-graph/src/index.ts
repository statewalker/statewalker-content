// Core types

// Selector helpers
export {
  type FindDirtyOptions,
  findDirty,
  joinInputs,
  singleTickSelector,
} from "./graph/selector-helpers.js";
export { type DrainOptions, type DrainResult, drain } from "./orchestrator/drain.js";
// Orchestrator
export {
  createOrchestrator,
  type Orchestrator,
  type OrchestratorOptions,
  type OrchestratorStatusReport,
} from "./orchestrator/orchestrator.js";
// Store interfaces and contract
export {
  defineGraphStoreContract,
  type GraphStoreHarness,
  type GraphStoreHarnessFactory,
} from "./store/contract.js";

// Memory store
export {
  createFilesPersistence,
  createInMemoryPersistence,
} from "./store/memory/files-persistence.js";
export type { Dump, LockId, MemoryPersistence } from "./store/memory/persistence.js";
export {
  MemoryGraphStore,
  type MemoryGraphStoreOptions,
} from "./store/memory/store.js";

// SQL store
export { SqlGraphStore, type SqlGraphStoreOptions } from "./store/sql/store.js";
export {
  type BeginTransactionOpts,
  type GraphReader,
  type GraphStore,
  type GraphTransaction,
  openGraphStore,
  type RecoverOrphansResult,
  type RegisterWorkerInput,
  type RegisterWorkerResult,
} from "./store/types.js";
export type {
  ReadOnlyView,
  Status,
  Update,
} from "./types/update.js";
export type {
  Selector,
  SelectorContext,
  WorkerDefinition,
  WorkerParams,
} from "./types/worker.js";
// Utilities
export { sha256Hex } from "./util/hash.js";
// Workers
export { type ChunkerOptions, createChunker } from "./workers/chunker.js";
export { createEmbedder, type EmbedderOptions } from "./workers/embedder.js";
export { createHtmlExtractor } from "./workers/extractors/html-extractor.js";
export { createMarkdownExtractor } from "./workers/extractors/markdown-extractor.js";
export { createPlainTextExtractor } from "./workers/extractors/plain-text-extractor.js";
export {
  createFileWatcher,
  type FileWatcherOptions,
} from "./workers/file-watcher.js";
export {
  createMemoryFtsBackend,
  type FtsBackend,
  type FtsHit,
} from "./workers/index-backends/memory-fts.js";
export {
  createMemoryVectorBackend,
  type VectorBackend,
  type VectorHit,
} from "./workers/index-backends/memory-vector.js";
export { createIndexer, type IndexerOptions } from "./workers/indexer.js";
