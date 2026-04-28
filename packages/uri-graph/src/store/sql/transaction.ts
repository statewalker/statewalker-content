import type { Db } from "@statewalker/db-api";
import type { Update } from "../../types/update.js";
import type { GraphTransaction } from "../types.js";
import { internUri } from "./uri-intern.js";

type TxnStatus = "open" | "committed" | "rolledback";

export class SqlTransaction implements GraphTransaction {
  readonly runId: number;
  private db: Db;
  private status: TxnStatus = "open";

  constructor(db: Db, runId: number) {
    this.db = db;
    this.runId = runId;
  }

  private ensureOpen(op: string): void {
    if (this.status !== "open") {
      throw new Error(`transaction ${this.runId} is closed (${this.status}); cannot ${op}`);
    }
  }

  async applyUpdate(u: Update): Promise<void> {
    this.ensureOpen("applyUpdate");
    const uriId = await internUri(this.db, u.uri);

    // No-op check against committed state.
    const committed = await this.db.query<{ status: string; hash: string | null; stamp: number }>(
      "SELECT status, hash, stamp FROM uri_state WHERE uri_id = ?",
      [uriId],
    );
    const isNoop =
      committed.length > 0 &&
      committed[0] !== undefined &&
      committed[0].status === u.status &&
      (committed[0].hash ?? null) === (u.hash ?? null);

    if (isNoop && committed[0]) {
      // Record the no-op output marker now (durable, since each applyUpdate is its own physical txn).
      await this.db.query(
        `INSERT OR REPLACE INTO run_output (run_id, uri_id, written_stamp, was_noop)
         VALUES (?, ?, ?, 1)`,
        [this.runId, uriId, committed[0].stamp],
      );
      return;
    }

    const attrJson = u.attributes !== undefined ? JSON.stringify(u.attributes) : null;
    await this.db.query(
      `INSERT INTO uri_state_pending (run_id, uri_id, status, stamp, hash, attributes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, uri_id) DO UPDATE SET
         status = excluded.status,
         stamp = excluded.stamp,
         hash = excluded.hash,
         attributes = excluded.attributes`,
      [this.runId, uriId, u.status, u.stamp, u.hash ?? null, attrJson],
    );
  }

  async recordInputs(
    inputs: ReadonlyArray<{
      uri: string;
      observedStamp: number;
      role?: string;
    }>,
  ): Promise<void> {
    this.ensureOpen("recordInputs");
    for (const i of inputs) {
      const uriId = await internUri(this.db, i.uri);
      await this.db.query(
        `INSERT INTO run_input (run_id, uri_id, role, observed_stamp)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(run_id, uri_id) DO UPDATE SET
           role = excluded.role,
           observed_stamp = excluded.observed_stamp`,
        [this.runId, uriId, i.role ?? null, i.observedStamp],
      );
    }
  }

  async commit(): Promise<void> {
    this.ensureOpen("commit");
    this.status = "committed";

    await this.db.exec("BEGIN IMMEDIATE");
    try {
      // Promote pending → committed.
      await this.db.query(
        `INSERT INTO uri_state (uri_id, status, stamp, hash, attributes)
         SELECT uri_id, status, stamp, hash, attributes
         FROM uri_state_pending
         WHERE run_id = ?
         ON CONFLICT(uri_id) DO UPDATE SET
           status = excluded.status,
           stamp = excluded.stamp,
           hash = excluded.hash,
           attributes = excluded.attributes`,
        [this.runId],
      );

      // Record run_output for promoted entries (was_noop = 0).
      await this.db.query(
        `INSERT OR REPLACE INTO run_output (run_id, uri_id, written_stamp, was_noop)
         SELECT run_id, uri_id, stamp, 0 FROM uri_state_pending WHERE run_id = ?`,
        [this.runId],
      );

      // Mark run success.
      await this.db.query("UPDATE run SET outcome = 'success', finished_at = ? WHERE id = ?", [
        Date.now(),
        this.runId,
      ]);

      // Drop staging.
      await this.db.query("DELETE FROM uri_state_pending WHERE run_id = ?", [this.runId]);
      await this.db.exec("COMMIT");
    } catch (err) {
      try {
        await this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async rollback(): Promise<void> {
    this.ensureOpen("rollback");
    this.status = "rolledback";

    await this.db.exec("BEGIN IMMEDIATE");
    try {
      await this.db.query("DELETE FROM uri_state_pending WHERE run_id = ?", [this.runId]);
      await this.db.query("UPDATE run SET outcome = 'cancelled', finished_at = ? WHERE id = ?", [
        Date.now(),
        this.runId,
      ]);
      // Drop run_input/run_output for the cancelled run so they don't pollute history.
      await this.db.query("DELETE FROM run_input WHERE run_id = ?", [this.runId]);
      await this.db.query("DELETE FROM run_output WHERE run_id = ?", [this.runId]);
      await this.db.exec("COMMIT");
    } catch (err) {
      try {
        await this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  }
}
