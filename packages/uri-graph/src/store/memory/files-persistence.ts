import type { FilesApi } from "@statewalker/webrun-files";
import { readText, writeText } from "@statewalker/webrun-files";
import type { Dump, LockId, MemoryPersistence } from "./persistence.js";

/**
 * Process-local lock map: rejects a second `lock(key)` against the same
 * `(files, key)` while a prior LockId is still outstanding.
 */
const locks = new WeakMap<FilesApi, Map<string, LockId>>();

function acquireLock(files: FilesApi, key: string): LockId {
  let map = locks.get(files);
  if (!map) {
    map = new Map();
    locks.set(files, map);
  }
  if (map.has(key)) {
    throw new Error(`already open at ${key}`);
  }
  const id: LockId = `${key}@${Math.random().toString(36).slice(2, 10)}`;
  map.set(key, id);
  return id;
}

function releaseLock(files: FilesApi, key: string, id: LockId): void {
  const map = locks.get(files);
  if (!map) return;
  if (map.get(key) === id) map.delete(key);
}

/**
 * Produce a `MemoryPersistence` that stores the dump as a JSON file inside the
 * given `FilesApi` at `path`. Suitable for Node + browser (OPFS) wiring.
 *
 * Atomic publish: writes to `<path>.tmp`, removes the prior target, then moves
 * the temp file. If the process crashes between `writeText` and `move`, the
 * prior committed snapshot remains intact.
 */
export function createFilesPersistence(files: FilesApi, path: string): MemoryPersistence {
  return {
    key: path,
    async lock(key) {
      return acquireLock(files, key);
    },
    async load() {
      if (!(await files.exists(path))) return null;
      const text = await readText(files, path);
      if (!text.trim()) return null;
      return JSON.parse(text) as Dump;
    },
    async store(_id, dump) {
      const tmp = `${path}.tmp`;
      await writeText(files, tmp, JSON.stringify(dump));
      if (await files.exists(path)) await files.remove(path);
      await files.move(tmp, path);
    },
    async unlock(id) {
      releaseLock(files, path, id);
    },
  };
}

/**
 * Produce a `MemoryPersistence` that keeps the dump in process memory only.
 * Useful for tests that don't need durability across restarts.
 */
export function createInMemoryPersistence(key = "graph"): MemoryPersistence {
  let dump: Dump | null = null;
  let activeLock: LockId | null = null;
  return {
    key,
    async lock(k) {
      if (activeLock) throw new Error(`already open at ${k}`);
      activeLock = `${k}@local`;
      return activeLock;
    },
    async load() {
      return dump;
    },
    async store(_id, value) {
      dump = value;
    },
    async unlock(_id) {
      activeLock = null;
    },
  };
}
