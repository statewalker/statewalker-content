import type { Db } from "@statewalker/db-api";

/**
 * Intern a URI text, returning its integer id. Idempotent.
 * Single-writer assumption: no concurrent inserts of the same text from peers.
 */
export async function internUri(db: Db, text: string): Promise<number> {
  // First try fast lookup.
  const existing = await db.query<{ id: number }>("SELECT id FROM uri WHERE text = ?", [text]);
  if (existing.length > 0 && existing[0]) return existing[0].id;
  // Insert; on race (won't happen under single-writer) fall back to lookup.
  await db.query("INSERT OR IGNORE INTO uri (text) VALUES (?)", [text]);
  const fresh = await db.query<{ id: number }>("SELECT id FROM uri WHERE text = ?", [text]);
  if (!fresh.length || !fresh[0]) {
    throw new Error(`failed to intern URI: ${text}`);
  }
  return fresh[0].id;
}

export async function getUriId(db: Db, text: string): Promise<number | null> {
  const rows = await db.query<{ id: number }>("SELECT id FROM uri WHERE text = ?", [text]);
  return rows.length > 0 && rows[0] ? rows[0].id : null;
}

export async function getUriText(db: Db, id: number): Promise<string | null> {
  const rows = await db.query<{ text: string }>("SELECT text FROM uri WHERE id = ?", [id]);
  return rows.length > 0 && rows[0] ? rows[0].text : null;
}
