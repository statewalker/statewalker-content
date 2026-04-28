/**
 * Persistence interface for `MemoryGraphStore`. Decouples the in-memory store
 * from any specific filesystem or storage layer.
 *
 * The `key` field identifies this store within the persistence layer's
 * namespace. The store calls `lock(key)` once at open time to acquire a
 * `LockId`, then uses that id for every subsequent `load` / `store` /
 * `unlock` call.
 *
 * A second `lock(key)` call against the same key while a prior LockId is still
 * outstanding SHOULD reject (single-writer guarantee).
 */
export type Dump = unknown;
export type LockId = string;

export interface MemoryPersistence {
  key: string;
  lock: (key: string) => Promise<LockId>;
  load: (id: LockId) => Promise<Dump | null>;
  store: (id: LockId, dump: Dump) => Promise<void>;
  unlock: (id: LockId) => Promise<void>;
}
