import { newNodeTursoDb } from "@statewalker/db-turso-node";
import { SqlProcessorRegistry } from "../../src/index.js";
import { defineProcessorRegistryContract } from "./contract.js";

defineProcessorRegistryContract("SqlProcessorRegistry", async () => {
  const db = await newNodeTursoDb();
  const registry = new SqlProcessorRegistry(db);
  return {
    registry,
    close: async () => {
      await db.close();
    },
  };
});
