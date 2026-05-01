import { MemoryResourceStore } from "../../src/index.js";
import { defineResourceStoreContract } from "./contract.js";

defineResourceStoreContract("MemoryResourceStore", async () => {
  const store = new MemoryResourceStore();
  return { store, close: async () => {} };
});
