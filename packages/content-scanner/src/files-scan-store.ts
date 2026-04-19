import { sha1Uuid } from "@statewalker/content-blocks/ids";
import type { FilesApi } from "@statewalker/webrun-files";
import { readText, writeText } from "@statewalker/webrun-files";
import type { ListParams, ScanStore, Stamp, Update } from "./scan-store.js";

/** Shape of the per-entry JSON file on disk. */
type EntryJson = {
  uri: string;
  stamp: string; // ISO
  removed?: string; // ISO
  meta?: Record<string, unknown>;
};

/** Shape of the _index.json file. */
type IndexJson = {
  lastScan: string | null; // ISO
  entries: Record<string, { stamp: string; removed?: string }>;
};

const INDEX_FILE = "_index.json";
const BATCH_SIZE = 50;

/** Derive a deterministic storage path from a URI. */
async function pathFor(prefix: string, uri: string): Promise<string> {
  const hash = await sha1Uuid(uri);
  const dd = hash.slice(0, 2);
  return `${prefix}/${dd}/${hash}`;
}

function stampMatches(
  stamp: Stamp,
  include?: Stamp | [Stamp, Stamp],
  exclude?: Stamp | [Stamp, Stamp],
): boolean {
  const t = stamp.getTime();
  if (include !== undefined) {
    if (Array.isArray(include)) {
      if (t < include[0].getTime() || t > include[1].getTime()) return false;
    } else {
      if (t !== include.getTime()) return false;
    }
  }
  if (exclude !== undefined) {
    if (Array.isArray(exclude)) {
      if (t >= exclude[0].getTime() && t <= exclude[1].getTime()) return false;
    } else {
      if (t === exclude.getTime()) return false;
    }
  }
  return true;
}

function uriMatches(uri: string, pattern?: string): boolean {
  if (!pattern) return true;
  if (pattern.endsWith("*")) {
    return uri.startsWith(pattern.slice(0, -1));
  }
  return uri === pattern;
}

function entryToUpdate(entry: EntryJson, files: FilesApi, basePath: string): Update {
  const update: Update = {
    uri: entry.uri,
    stamp: new Date(entry.stamp),
  };
  if (entry.removed) {
    update.removed = new Date(entry.removed);
  }
  if (entry.meta) {
    update.meta = entry.meta;
  }
  const binPath = `${basePath}.bin`;
  update.content = async function* () {
    if (await files.exists(binPath)) {
      yield* files.read(binPath);
    }
  };
  return update;
}

export class FilesScanStore implements ScanStore {
  readonly name: string;
  private readonly files: FilesApi;
  private readonly prefix: string;
  private index: IndexJson | null = null;

  constructor(name: string, files: FilesApi, prefix: string) {
    this.name = name;
    this.files = files;
    this.prefix = prefix;
  }

  private get indexPath(): string {
    return `${this.prefix}/${INDEX_FILE}`;
  }

  private async loadIndex(): Promise<IndexJson> {
    if (this.index) return this.index;
    if (await this.files.exists(this.indexPath)) {
      const text = await readText(this.files, this.indexPath);
      if (text) {
        this.index = JSON.parse(text) as IndexJson;
        return this.index;
      }
    }
    this.index = { lastScan: null, entries: {} };
    return this.index;
  }

  private async saveIndex(): Promise<void> {
    if (!this.index) return;
    await writeText(this.files, this.indexPath, JSON.stringify(this.index));
  }

  async *store(updates: Iterable<Update> | AsyncIterable<Update>): AsyncGenerator<Update> {
    const idx = await this.loadIndex();
    let count = 0;
    for await (const update of updates) {
      const basePath = await pathFor(this.prefix, update.uri);
      const jsonPath = `${basePath}.json`;

      const entry: EntryJson = {
        uri: update.uri,
        stamp: update.stamp.toISOString(),
      };
      if (update.removed) {
        entry.removed = update.removed.toISOString();
      }
      if (update.meta) {
        entry.meta = update.meta;
      }
      await writeText(this.files, jsonPath, JSON.stringify(entry));

      if (update.content) {
        const binPath = `${basePath}.bin`;
        await this.files.write(binPath, update.content());
      }

      idx.entries[update.uri] = {
        stamp: entry.stamp,
        ...(entry.removed ? { removed: entry.removed } : {}),
      };

      count++;
      if (count % BATCH_SIZE === 0) {
        await this.saveIndex();
      }

      yield entryToUpdate(entry, this.files, basePath);
    }
    await this.saveIndex();
  }

  async *list(params?: ListParams): AsyncGenerator<Update> {
    const idx = await this.loadIndex();
    for (const [uri, info] of Object.entries(idx.entries)) {
      if (!uriMatches(uri, params?.uri)) continue;
      const stamp = new Date(info.stamp);
      if (!stampMatches(stamp, params?.include, params?.exclude)) continue;

      const basePath = await pathFor(this.prefix, uri);
      const jsonPath = `${basePath}.json`;
      if (!(await this.files.exists(jsonPath))) continue;

      const text = await readText(this.files, jsonPath);
      if (!text) continue;
      const entry = JSON.parse(text) as EntryJson;
      yield entryToUpdate(entry, this.files, basePath);
    }
  }

  async *remove(params?: ListParams): AsyncGenerator<Update> {
    const idx = await this.loadIndex();
    const now = new Date().toISOString();
    const toRemove: string[] = [];

    for (const [uri, info] of Object.entries(idx.entries)) {
      if (info.removed) continue; // already removed
      if (!uriMatches(uri, params?.uri)) continue;
      const stamp = new Date(info.stamp);
      if (!stampMatches(stamp, params?.include, params?.exclude)) continue;
      toRemove.push(uri);
    }

    for (const uri of toRemove) {
      const basePath = await pathFor(this.prefix, uri);
      const jsonPath = `${basePath}.json`;

      if (await this.files.exists(jsonPath)) {
        const text = await readText(this.files, jsonPath);
        if (text) {
          const entry = JSON.parse(text) as EntryJson;
          entry.removed = now;
          await writeText(this.files, jsonPath, JSON.stringify(entry));

          idx.entries[uri] = {
            stamp: entry.stamp,
            removed: now,
          };

          yield entryToUpdate(entry, this.files, basePath);
        }
      }
    }
    await this.saveIndex();
  }

  async getLastScan(): Promise<Stamp | null> {
    const idx = await this.loadIndex();
    return idx.lastScan ? new Date(idx.lastScan) : null;
  }

  async setLastScan(stamp: Stamp): Promise<void> {
    const idx = await this.loadIndex();
    idx.lastScan = stamp.toISOString();
    await this.saveIndex();
  }

  async prune(before: Stamp): Promise<number> {
    const idx = await this.loadIndex();
    const beforeTime = before.getTime();
    let count = 0;
    const toDelete: string[] = [];

    for (const [uri, info] of Object.entries(idx.entries)) {
      if (info.removed && new Date(info.removed).getTime() < beforeTime) {
        toDelete.push(uri);
      }
    }

    for (const uri of toDelete) {
      const basePath = await pathFor(this.prefix, uri);
      await this.files.remove(`${basePath}.json`);
      await this.files.remove(`${basePath}.bin`);
      delete idx.entries[uri];
      count++;
    }

    if (count > 0) {
      await this.saveIndex();
    }
    return count;
  }

  async rebuildIndex(): Promise<void> {
    const oldLastScan = this.index?.lastScan ?? null;
    const newIndex: IndexJson = { lastScan: oldLastScan, entries: {} };

    const trackingDir = this.prefix;
    if (!(await this.files.exists(trackingDir))) {
      this.index = newIndex;
      await this.saveIndex();
      return;
    }

    for await (const info of this.files.list(trackingDir, {
      recursive: true,
    })) {
      if (info.kind !== "file" || !info.path.endsWith(".json")) continue;
      if (info.path.endsWith(`/${INDEX_FILE}`)) continue;

      const text = await readText(this.files, info.path);
      if (!text) continue;

      const entry = JSON.parse(text) as EntryJson;
      newIndex.entries[entry.uri] = {
        stamp: entry.stamp,
        ...(entry.removed ? { removed: entry.removed } : {}),
      };
    }

    this.index = newIndex;
    await this.saveIndex();
  }
}
