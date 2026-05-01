import { newNodeTursoDb } from "@statewalker/db-turso-node";
import { SqlResourceStore } from "../../src/index.js";
import { defineResourceStoreContract } from "./contract.js";

defineResourceStoreContract("SqlResourceStore", async () => {
  const db = await newNodeTursoDb();
  const store = new SqlResourceStore(db);
  return {
    store,
    close: async () => {
      await db.close();
    },
  };
});
