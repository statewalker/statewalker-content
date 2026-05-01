import { newNodeTursoDb } from "@statewalker/db-turso-node";
import { SqlStore } from "../../src/store/sql.js";
import { defineStoreContract } from "./contract.js";

defineStoreContract("SqlStore", async () => {
  const db = await newNodeTursoDb();
  const store = new SqlStore(db);
  return {
    store,
    close: async () => {
      await db.close();
    },
  };
});
