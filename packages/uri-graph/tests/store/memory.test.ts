import { MemoryStore } from "../../src/store/memory.js";
import { defineStoreContract } from "./contract.js";

defineStoreContract("MemoryStore", async () => {
  const store = new MemoryStore();
  return { store, close: async () => {} };
});
