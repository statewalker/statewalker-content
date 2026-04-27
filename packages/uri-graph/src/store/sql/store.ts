import type { Db } from "@statewalker/db-api";
import type { ReadOnlyView } from "../../types/update.js";
import type {
  BeginTransactionOpts,
  GraphStore,
  GraphTransaction,
  RecoverOrphansResult,
  RegisterWorkerInput,
  RegisterWorkerResult,
} from "../types.js";
import { applySchema } from "./schema.js";
import { SqlTransaction } from "./transaction.js";
import { getUriId } from "./uri-intern.js";

export interface SqlGraphStoreOptions {
  db: Db;
}

interface UriStateRow {
  status: string;
  stamp: number;
  hash: string | null;
  attributes: string | null;
}

interface UriRow extends UriStateRow {
  text: string;
}

function rowToView(uri: string, row: UriStateRow): ReadOnlyView {
  return {
    uri,
    stamp: row.stamp,
    status: row.status as ReadOnlyView["status"],
    hash: row.hash ?? undefined,
    attributes:
      row.attributes !== null && row.attributes !== undefined
        ? (JSON.parse(row.attributes) as Record<string, unknown>)
        : undefined,
  };
}

export class SqlGraphStore implements GraphStore {
  private db: Db;
  private initialized = false;
  private closed = false;

  constructor(options: SqlGraphStoreOptions) {
    this.db = options.db;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await applySchema(this.db);
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Caller owns Db lifecycle; we just mark closed.
  }

  async getState(uri: string): Promise<ReadOnlyView | null> {
    const id = await getUriId(this.db, uri);
    if (id === null) return null;
    const rows = await this.db.query<UriStateRow>(
      "SELECT status, stamp, hash, attributes FROM uri_state WHERE uri_id = ?",
      [id],
    );
    if (rows.length === 0 || !rows[0]) return null;
    return rowToView(uri, rows[0]);
  }

  async *find(pattern: string): AsyncIterable<ReadOnlyView> {
    const rows = await this.db.query<UriRow>(
      `SELECT u.text AS text, s.status, s.stamp, s.hash, s.attributes
       FROM uri_state s
       JOIN uri u ON u.id = s.uri_id
       WHERE u.text LIKE ?`,
      [pattern],
    );
    for (const r of rows) {
      yield rowToView(r.text, r);
    }
  }

  async priorOutputs(workerName: string, inputUri: string): Promise<ReadOnlyView[]> {
    const inputId = await getUriId(this.db, inputUri);
    if (inputId === null) return [];

    const latest = await this.db.query<{ run_id: number }>(
      `SELECT r.id AS run_id
       FROM run r
       JOIN run_input ri ON ri.run_id = r.id
       WHERE r.action = ?
         AND r.outcome = 'success'
         AND ri.uri_id = ?
       ORDER BY r.id DESC
       LIMIT 1`,
      [workerName, inputId],
    );
    if (latest.length === 0 || !latest[0]) return [];
    const runId = latest[0].run_id;

    const rows = await this.db.query<UriRow>(
      `SELECT u.text AS text, s.status, s.stamp, s.hash, s.attributes
       FROM run_output ro
       JOIN uri u ON u.id = ro.uri_id
       JOIN uri_state s ON s.uri_id = ro.uri_id
       WHERE ro.run_id = ? AND ro.was_noop = 0`,
      [runId],
    );
    return rows.map((r) => rowToView(r.text, r));
  }

  async beginTransaction(opts: BeginTransactionOpts): Promise<GraphTransaction> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO run (action, action_version, scope, stamp, started_at, outcome)
       VALUES (?, ?, ?, ?, ?, 'running')
       RETURNING id`,
      [opts.worker, opts.version, opts.scope, opts.initialStamp, Date.now()],
    );
    if (result.length === 0 || !result[0]) {
      throw new Error("failed to allocate run id");
    }
    return new SqlTransaction(this.db, result[0].id);
  }

  async mintStamp(): Promise<number> {
    // Atomic increment-and-fetch.
    const rows = await this.db.query<{ next: number }>(
      "UPDATE stamp_seq SET next = next + 1 WHERE id = 1 RETURNING next - 1 AS next",
    );
    if (rows.length === 0 || !rows[0]) {
      throw new Error("stamp_seq row missing");
    }
    return rows[0].next;
  }

  async recoverOrphans(): Promise<RecoverOrphansResult> {
    const before = await this.db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM run WHERE outcome = 'running'",
    );
    const cancelled = before.length > 0 && before[0] ? before[0].count : 0;
    if (cancelled === 0) return { cancelled: 0, pendingRowsDropped: 0 };

    const pendingBefore = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM uri_state_pending
       WHERE run_id IN (SELECT id FROM run WHERE outcome = 'running')`,
    );
    const pendingRowsDropped =
      pendingBefore.length > 0 && pendingBefore[0] ? pendingBefore[0].count : 0;

    await this.db.exec("BEGIN IMMEDIATE");
    try {
      await this.db.query(
        `DELETE FROM uri_state_pending
         WHERE run_id IN (SELECT id FROM run WHERE outcome = 'running')`,
      );
      await this.db.query(
        `DELETE FROM run_input
         WHERE run_id IN (SELECT id FROM run WHERE outcome = 'running')`,
      );
      await this.db.query(
        `DELETE FROM run_output
         WHERE run_id IN (SELECT id FROM run WHERE outcome = 'running')`,
      );
      await this.db.query(
        "UPDATE run SET outcome = 'cancelled', finished_at = ? WHERE outcome = 'running'",
        [Date.now()],
      );
      await this.db.exec("COMMIT");
    } catch (err) {
      try {
        await this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
    return { cancelled, pendingRowsDropped };
  }

  async registerWorker(def: RegisterWorkerInput): Promise<RegisterWorkerResult> {
    const existing = await this.db.query<{ version: string }>(
      "SELECT version FROM worker_registry WHERE name = ?",
      [def.name],
    );
    const versionChanged =
      existing.length === 0 || !existing[0] || existing[0].version !== def.version;
    const now = Date.now();
    if (existing.length === 0) {
      await this.db.query(
        `INSERT INTO worker_registry
           (name, version, description, input_pattern, output_pattern, scope_expr, registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          def.name,
          def.version,
          def.description ?? null,
          def.inputPattern ?? null,
          def.outputPattern ?? null,
          def.scopeExpr ?? null,
          now,
        ],
      );
    } else if (versionChanged) {
      await this.db.query(
        `UPDATE worker_registry
         SET version = ?, description = ?, input_pattern = ?, output_pattern = ?, scope_expr = ?
         WHERE name = ?`,
        [
          def.version,
          def.description ?? null,
          def.inputPattern ?? null,
          def.outputPattern ?? null,
          def.scopeExpr ?? null,
          def.name,
        ],
      );
    }
    return { versionChanged };
  }

  async lastSuccessfulRunVersion(workerName: string, inputUri: string): Promise<string | null> {
    const inputId = await getUriId(this.db, inputUri);
    if (inputId === null) return null;
    const rows = await this.db.query<{ action_version: string }>(
      `SELECT r.action_version
       FROM run r
       JOIN run_input ri ON ri.run_id = r.id
       WHERE r.action = ?
         AND r.outcome = 'success'
         AND ri.uri_id = ?
       ORDER BY r.id DESC
       LIMIT 1`,
      [workerName, inputId],
    );
    return rows.length > 0 && rows[0] ? rows[0].action_version : null;
  }

  async isInputProcessed(
    workerName: string,
    workerVersion: string,
    inputUri: string,
  ): Promise<boolean> {
    const inputId = await getUriId(this.db, inputUri);
    if (inputId === null) return false;
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM run r
       JOIN run_input ri ON ri.run_id = r.id
       LEFT JOIN uri_state s ON s.uri_id = ri.uri_id
       WHERE r.action = ?
         AND r.action_version = ?
         AND r.outcome = 'success'
         AND ri.uri_id = ?
         AND ri.observed_stamp >= COALESCE(s.stamp, 0)`,
      [workerName, workerVersion, inputId],
    );
    return rows.length > 0 && rows[0] !== undefined && rows[0].count > 0;
  }
}
