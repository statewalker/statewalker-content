import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@statewalker/db-api";
import { newNodeTursoDb } from "@statewalker/db-turso-node";
import { afterEach } from "vitest";
import { defineGraphStoreContract } from "../../src/store/contract.js";
import { SqlGraphStore } from "../../src/store/sql/store.js";
import { openGraphStore } from "../../src/store/types.js";

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
});

defineGraphStoreContract("SqlGraphStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "uri-graph-sql-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "graph.db");
  const opened: { db: Db; store: SqlGraphStore }[] = [];
  return {
    async open() {
      const db = await newNodeTursoDb({ path: dbPath });
      const store = new SqlGraphStore({ db });
      opened.push({ db, store });
      return openGraphStore(store);
    },
    async close(store) {
      const idx = opened.findIndex((o) => o.store === (store as SqlGraphStore));
      if (idx >= 0) {
        const entry = opened.splice(idx, 1)[0];
        if (entry) {
          await entry.store.close();
          await entry.db.close();
        }
      }
    },
  };
});
