import { createInMemoryPersistence } from "../src/store/memory/files-persistence.js";
import { MemoryGraphStore } from "../src/store/memory/store.js";
import type { GraphStore } from "../src/store/types.js";
import { openGraphStore } from "../src/store/types.js";

/**
 * Open an in-memory `MemoryGraphStore` with throwaway persistence. Each call
 * gets an isolated store; no filesystem involved.
 */
export async function openTempMemoryStore(key = "graph"): Promise<GraphStore> {
  return openGraphStore(new MemoryGraphStore(createInMemoryPersistence(key)));
}
