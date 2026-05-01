import { MemoryProcessorRegistry } from "../../src/index.js";
import { defineProcessorRegistryContract } from "./contract.js";

defineProcessorRegistryContract("MemoryProcessorRegistry", async () => {
  const registry = new MemoryProcessorRegistry();
  return { registry, close: async () => {} };
});
