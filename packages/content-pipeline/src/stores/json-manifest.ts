import type { FilesApi } from "@statewalker/webrun-files";
import { readText, writeText } from "@statewalker/webrun-files";
import type { StampListener, Store, StoreWrite, Unsubscribe } from "../store.js";
import type { Entry } from "../types.js";
import { createStampAllocator, type StampAllocator } from "./stamp.js";

type PersistedEntry<E extends Entry> = {
  uri: string;
  stamp: number;
  tombstone?: true;
  meta?: E extends Entry<infer M> ? M : never;
};

type Manifest<E extends Entry> = {
  counter: number;
  entries: Record<string, PersistedEntry<E>>;
  cursors: Record<string, number>;
};

export type JsonManifestStoreOptions = {
  /** FilesApi the manifest is persisted on. */
  files: FilesApi;
  /** Directory prefix — manifest lives at `{prefix}/manifest.json`. */
  prefix: string;
};

/**
 * Single-file JSON store. Fits small-meta layers (files, receipts); not suitable
 * for heavy payloads — every write rewrites the whole manifest.
 */
export class JsonManifestStore<E extends Entry> implements Store<E> {
  private readonly files: FilesApi;
  private readonly prefix: string;
  private readonly listeners = new Set<StampListener>();
  private readonly stamps: StampAllocator = createStampAllocator();
  private manifest: Manifest<E> | null = null;
  private loadPromise: Promise<Manifest<E>> | null = null;

  constructor(options: JsonManifestStoreOptions) {
    this.files = options.files;
    this.prefix = options.prefix;
  }

  private get manifestPath(): string {
    return `${this.prefix}/manifest.json`;
  }

  private async load(): Promise<Manifest<E>> {
    if (this.manifest) return this.manifest;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      if (await this.files.exists(this.manifestPath)) {
        const text = await readText(this.files, this.manifestPath);
        if (text) {
          const parsed = JSON.parse(text) as Manifest<E>;
          this.stamps.seed(parsed.counter);
          this.manifest = parsed;
          return parsed;
        }
      }
      const empty: Manifest<E> = { counter: 0, entries: {}, cursors: {} };
      this.manifest = empty;
      return empty;
    })();
    try {
      return await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async save(): Promise<void> {
    if (!this.manifest) return;
    this.manifest.counter = this.stamps.current();
    await writeText(this.files, this.manifestPath, JSON.stringify(this.manifest));
  }

  async get(uri: string): Promise<E | undefined> {
    const m = await this.load();
    const persisted = m.entries[uri];
    return persisted ? toEntry<E>(persisted) : undefined;
  }

  async put(writes: StoreWrite<E>[]): Promise<void> {
    if (writes.length === 0) return;
    const m = await this.load();
    let top = 0;
    for (const w of writes) {
      const stamp = this.stamps.next();
      top = stamp;
      const persisted: PersistedEntry<E> = { uri: w.uri, stamp };
      if (w.tombstone) persisted.tombstone = true;
      if (w.meta !== undefined) persisted.meta = w.meta as PersistedEntry<E>["meta"];
      m.entries[w.uri] = persisted;
    }
    await this.save();
    for (const listener of this.listeners) listener(top);
  }

  async *since(cursor: number, limit: number): AsyncGenerator<E> {
    const m = await this.load();
    const sorted = Object.values(m.entries)
      .filter((e) => e.stamp > cursor)
      .sort((a, b) => a.stamp - b.stamp)
      .slice(0, limit);
    for (const e of sorted) yield toEntry<E>(e);
  }

  async cursor(name: string): Promise<number> {
    const m = await this.load();
    return m.cursors[name] ?? 0;
  }

  async advance(name: string, stamp: number): Promise<void> {
    const m = await this.load();
    m.cursors[name] = stamp;
    await this.save();
  }

  onStampUpdate(listener: StampListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.listeners.clear();
  }
}

function toEntry<E extends Entry>(p: PersistedEntry<E>): E {
  const entry: Entry = { uri: p.uri, stamp: p.stamp };
  if (p.tombstone) (entry as { tombstone?: true }).tombstone = true;
  if (p.meta !== undefined) entry.meta = p.meta;
  return entry as E;
}
