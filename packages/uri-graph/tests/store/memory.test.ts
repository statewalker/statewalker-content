import { defineGraphStoreContract } from "../../src/store/contract.js";
import { createInMemoryPersistence } from "../../src/store/memory/files-persistence.js";
import { MemoryGraphStore } from "../../src/store/memory/store.js";
import { openGraphStore } from "../../src/store/types.js";

defineGraphStoreContract("MemoryGraphStore", () => {
  const persistence = createInMemoryPersistence("graph.json");
  return {
    async open() {
      const raw = new MemoryGraphStore(persistence);
      return openGraphStore(raw);
    },
    async close(store) {
      const closable = store as { close?: () => Promise<void> };
      if (closable.close) await closable.close();
    },
  };
});
