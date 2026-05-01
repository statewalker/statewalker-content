import type { Db } from "@statewalker/db-api";
import type {
  ListOptions,
  PurgeCompletionsOptions,
  PurgeResourcesOptions,
  Resource,
  ResourceStore,
  Status,
} from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stamp_seq (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  next INTEGER NOT NULL
);
INSERT OR IGNORE INTO stamp_seq (id, next) VALUES (1, 1);

CREATE TABLE IF NOT EXISTS resources (
  uri    TEXT    NOT NULL,
  stamp  INTEGER NOT NULL,
  status TEXT    NOT NULL,
  meta   TEXT,
  PRIMARY KEY (uri, stamp)
);
CREATE INDEX IF NOT EXISTS resources_stamp ON resources(stamp);

CREATE TABLE IF NOT EXISTS completions (
  processor   TEXT    NOT NULL,
  stamp       INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  PRIMARY KEY (processor, stamp)
);
CREATE INDEX IF NOT EXISTS completions_processor_stamp ON completions(processor, stamp DESC);
`;

type ResourceRow = {
  uri: string;
  stamp: number;
  status: string;
  meta: string | null;
};

function rowToResource(row: ResourceRow): Resource {
  const r: Resource = {
    uri: row.uri,
    stamp: row.stamp,
    status: row.status as Status,
  };
  if (row.meta !== null) r.meta = JSON.parse(row.meta);
  return r;
}

export class SqlResourceStore implements ResourceStore {
  private initialized = false;

  constructor(private db: Db) {}

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    for (const stmt of SCHEMA.split(";")) {
      const trimmed = stmt.trim();
      if (trimmed) await this.db.exec(trimmed);
    }
    this.initialized = true;
  }

  async newStamp(): Promise<number> {
    await this.ensureInit();
    const rows = await this.db.query<{ next: number }>(
      "UPDATE stamp_seq SET next = next + 1 WHERE id = 1 RETURNING next - 1 AS next",
    );
    const row = rows[0];
    if (!row) throw new Error("stamp_seq is missing");
    return row.next;
  }

  async put(resource: Resource): Promise<void> {
    await this.ensureInit();
    const meta = resource.meta === undefined ? null : JSON.stringify(resource.meta);
    await this.db.query(
      "INSERT OR REPLACE INTO resources (uri, stamp, status, meta) VALUES (?, ?, ?, ?)",
      [resource.uri, resource.stamp, resource.status, meta],
    );
    await this.db.query("UPDATE stamp_seq SET next = MAX(next, ? + 1) WHERE id = 1", [
      resource.stamp,
    ]);
  }

  async get(uri: string): Promise<Resource | undefined> {
    await this.ensureInit();
    const rows = await this.db.query<ResourceRow>(
      "SELECT uri, stamp, status, meta FROM resources WHERE uri = ? ORDER BY stamp DESC LIMIT 1",
      [uri],
    );
    const row = rows[0];
    return row ? rowToResource(row) : undefined;
  }

  async *list(options: ListOptions): AsyncIterable<Resource> {
    await this.ensureInit();
    const after = options.afterStamp ?? 0;
    const rows = await this.db.query<ResourceRow>(
      `WITH latest AS (
         SELECT uri, MAX(stamp) AS stamp FROM resources
         WHERE uri LIKE ? || '%'
         GROUP BY uri
       )
       SELECT r.uri, r.stamp, r.status, r.meta
       FROM latest l
       JOIN resources r ON r.uri = l.uri AND r.stamp = l.stamp
       WHERE r.stamp > ?
       ORDER BY r.stamp ASC, r.uri ASC`,
      [options.prefix, after],
    );
    for (const row of rows) yield rowToResource(row);
  }

  async markCompleted(processor: string, stamp: number): Promise<void> {
    await this.ensureInit();
    await this.db.query(
      "INSERT OR REPLACE INTO completions (processor, stamp, finished_at) VALUES (?, ?, ?)",
      [processor, stamp, Date.now()],
    );
  }

  async allWatermarks(): Promise<Map<string, number>> {
    await this.ensureInit();
    const rows = await this.db.query<{ processor: string; stamp: number }>(
      "SELECT processor, MAX(stamp) AS stamp FROM completions GROUP BY processor",
    );
    const result = new Map<string, number>();
    for (const row of rows) result.set(row.processor, row.stamp);
    return result;
  }

  async invalidate(prefix: string): Promise<void> {
    await this.ensureInit();
    const stamp = await this.newStamp();
    await this.db.query(
      `INSERT OR REPLACE INTO resources (uri, stamp, status, meta)
       SELECT r.uri, ?, 'removed', NULL
       FROM (
         SELECT uri, MAX(stamp) AS stamp FROM resources
         WHERE uri LIKE ? || '%'
         GROUP BY uri
       ) l
       JOIN resources r ON r.uri = l.uri AND r.stamp = l.stamp
       WHERE r.status != 'removed'`,
      [stamp, prefix],
    );
  }

  async purgeResources(options?: PurgeResourcesOptions): Promise<void> {
    await this.ensureInit();
    if (options?.keepLatestPerUri !== true) return;
    await this.db.exec(
      `DELETE FROM resources
       WHERE (uri, stamp) NOT IN (
         SELECT uri, MAX(stamp) FROM resources GROUP BY uri
       )`,
    );
  }

  async purgeCompletions(options?: PurgeCompletionsOptions): Promise<void> {
    await this.ensureInit();
    const keep = options?.keepLatestPerProcessor;
    if (keep === undefined || keep < 1) return;
    await this.db.query(
      `DELETE FROM completions
       WHERE rowid NOT IN (
         SELECT rowid FROM (
           SELECT rowid,
             ROW_NUMBER() OVER (PARTITION BY processor ORDER BY stamp DESC) AS rn
           FROM completions
         ) WHERE rn <= ?
       )`,
      [keep],
    );
  }
}
