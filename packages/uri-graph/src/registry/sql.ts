import type { Db } from "@statewalker/db-api";
import type { ProcessorRegistry, ResourceProcessor } from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS processors (
  name    TEXT PRIMARY KEY,
  selects TEXT NOT NULL,
  emits   TEXT NOT NULL
);
`;

type ProcessorRow = {
  name: string;
  selects: string;
  emits: string;
};

export class SqlProcessorRegistry implements ProcessorRegistry {
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

  async saveProcessor(processor: ResourceProcessor): Promise<void> {
    await this.ensureInit();
    await this.db.query(
      `INSERT INTO processors (name, selects, emits) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET selects = excluded.selects, emits = excluded.emits`,
      [processor.name, processor.selects, processor.emits],
    );
  }

  async deleteProcessor(name: string): Promise<void> {
    await this.ensureInit();
    await this.db.query("DELETE FROM processors WHERE name = ?", [name]);
  }

  async getProcessor(name: string): Promise<ResourceProcessor | undefined> {
    await this.ensureInit();
    const rows = await this.db.query<ProcessorRow>(
      "SELECT name, selects, emits FROM processors WHERE name = ?",
      [name],
    );
    const row = rows[0];
    return row ? { name: row.name, selects: row.selects, emits: row.emits } : undefined;
  }

  async *listProcessors(): AsyncIterable<ResourceProcessor> {
    await this.ensureInit();
    const rows = await this.db.query<ProcessorRow>(
      "SELECT name, selects, emits FROM processors ORDER BY name ASC",
    );
    for (const row of rows) yield { name: row.name, selects: row.selects, emits: row.emits };
  }
}
