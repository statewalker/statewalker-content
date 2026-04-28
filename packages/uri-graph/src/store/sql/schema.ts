import type { Db } from "@statewalker/db-api";

const STATEMENTS: string[] = [
  // 1. URI interning. INTEGER PRIMARY KEY is an alias for rowid; SQLite
  // auto-generates the id on INSERT.
  `CREATE TABLE IF NOT EXISTS uri (
     id   INTEGER PRIMARY KEY,
     text TEXT NOT NULL UNIQUE
   )`,
  `CREATE INDEX IF NOT EXISTS uri_text ON uri(text)`,

  // 2. Stamp source
  `CREATE TABLE IF NOT EXISTS stamp_seq (
     id   INTEGER PRIMARY KEY CHECK (id = 1),
     next INTEGER NOT NULL
   )`,
  `INSERT OR IGNORE INTO stamp_seq (id, next) VALUES (1, 1)`,

  // 3. Worker registry
  `CREATE TABLE IF NOT EXISTS worker_registry (
     name           TEXT PRIMARY KEY,
     version        TEXT NOT NULL,
     description    TEXT,
     input_pattern  TEXT,
     output_pattern TEXT,
     scope_expr     TEXT,
     selector_kind  TEXT NOT NULL DEFAULT 'code',
     registered_at  INTEGER NOT NULL,
     last_run_at    INTEGER
   )`,

  // 4. Committed state
  `CREATE TABLE IF NOT EXISTS uri_state (
     uri_id     INTEGER PRIMARY KEY REFERENCES uri(id),
     status     TEXT NOT NULL,
     stamp      INTEGER NOT NULL,
     hash       TEXT,
     attributes TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS uri_state_stamp ON uri_state(stamp)`,

  // 5. Pending (staging)
  `CREATE TABLE IF NOT EXISTS uri_state_pending (
     run_id     INTEGER NOT NULL,
     uri_id     INTEGER NOT NULL REFERENCES uri(id),
     status     TEXT NOT NULL,
     stamp      INTEGER NOT NULL,
     hash       TEXT,
     attributes TEXT,
     PRIMARY KEY (run_id, uri_id)
   )`,
  `CREATE INDEX IF NOT EXISTS uri_state_pending_uri ON uri_state_pending(uri_id)`,

  // 6. Run history
  `CREATE TABLE IF NOT EXISTS run (
     id              INTEGER PRIMARY KEY,
     action          TEXT NOT NULL,
     action_version  TEXT NOT NULL,
     scope           TEXT,
     stamp           INTEGER NOT NULL,
     started_at      INTEGER NOT NULL,
     finished_at     INTEGER,
     outcome         TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS run_action_scope ON run(action, scope, id)`,
  `CREATE INDEX IF NOT EXISTS run_outcome_started ON run(outcome, started_at)`,

  // 7. Run inputs / outputs
  `CREATE TABLE IF NOT EXISTS run_input (
     run_id          INTEGER NOT NULL REFERENCES run(id) ON DELETE CASCADE,
     uri_id          INTEGER NOT NULL REFERENCES uri(id),
     role            TEXT,
     observed_stamp  INTEGER NOT NULL,
     PRIMARY KEY (run_id, uri_id)
   )`,
  `CREATE TABLE IF NOT EXISTS run_output (
     run_id          INTEGER NOT NULL REFERENCES run(id) ON DELETE CASCADE,
     uri_id          INTEGER NOT NULL REFERENCES uri(id),
     written_stamp   INTEGER NOT NULL,
     was_noop        INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (run_id, uri_id)
   )`,
  `CREATE INDEX IF NOT EXISTS run_output_uri ON run_output(uri_id, run_id)`,
];

const PRAGMAS: string[] = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA foreign_keys = ON",
];

export async function applySchema(db: Db): Promise<void> {
  for (const pragma of PRAGMAS) {
    try {
      await db.exec(pragma);
    } catch {
      // libSQL may no-op some PRAGMAs; tolerate.
    }
  }
  for (const stmt of STATEMENTS) {
    await db.exec(stmt);
  }
}
