import { sha1Uuid } from "@statewalker/shared-ids";
import type { FilesApi } from "@statewalker/webrun-files";
import { readFile, readText, writeText } from "@statewalker/webrun-files";
import type { StampListener, Store, StoreWrite, Unsubscribe } from "../store.js";
import type { Entry } from "../types.js";
import type { BlobCodec } from "./codec.js";
import { createStampAllocator, type StampAllocator } from "./stamp.js";

type ManifestEntry = { stamp: number; tombstone?: true };

type Manifest = {
  counter: number;
  entries: Record<string, ManifestEntry>;
  cursors: Record<string, number>;
};

export type BlobStoreOptions<M> = {
  /** FilesApi used for both the manifest and per-URI blobs. */
  files: FilesApi;
  /** Directory prefix — manifest at `{prefix}/manifest.json`, blobs at `{prefix}/{dd}/{hash}.bin`. */
  prefix: string;
  /** Codec for the meta payload. */
  codec: BlobCodec<M>;
};

/**
 * Meta-in-blob store. Manifest holds only `{uri → {stamp, tombstone?}}` (keeping
 * listing cheap); each URI's meta is persisted as one blob file per URI via
 * `BlobCodec`. Suitable for payload-heavy layers (extract, chunks, embeddings).
 */
export class BlobStore<E extends Entry> implements Store<E> {
  private readonly files: FilesApi;
  private readonly prefix: string;
  private readonly codec: BlobCodec<E extends Entry<infer M> ? M : never>;
  private readonly listeners = new Set<StampListener>();
  private readonly stamps: StampAllocator = createStampAllocator();
  private manifest: Manifest | null = null;
  private loadPromise: Promise<Manifest> | null = null;

  constructor(options: BlobStoreOptions<E extends Entry<infer M> ? M : never>) {
    this.files = options.files;
    this.prefix = options.prefix;
    this.codec = options.codec;
  }

  private get manifestPath(): string {
    return `${this.prefix}/manifest.json`;
  }

  private async blobPath(uri: string): Promise<string> {
    const hash = await sha1Uuid(uri);
    const dd = hash.slice(0, 2);
    return `${this.prefix}/${dd}/${hash}.bin`;
  }

  private async load(): Promise<Manifest> {
    if (this.manifest) return this.manifest;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      if (await this.files.exists(this.manifestPath)) {
        const text = await readText(this.files, this.manifestPath);
        if (text) {
          const parsed = JSON.parse(text) as Manifest;
          this.stamps.seed(parsed.counter);
          this.manifest = parsed;
          return parsed;
        }
      }
      const empty: Manifest = { counter: 0, entries: {}, cursors: {} };
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
    if (!persisted) return undefined;
    return this.materialise<E>(uri, persisted);
  }

  async put(writes: StoreWrite<E>[]): Promise<void> {
    if (writes.length === 0) return;
    const m = await this.load();
    let top = 0;
    for (const w of writes) {
      const stamp = this.stamps.next();
      top = stamp;
      const blobP = await this.blobPath(w.uri);
      if (w.tombstone) {
        m.entries[w.uri] = { stamp, tombstone: true };
        if (await this.files.exists(blobP)) await this.files.remove(blobP);
      } else if (w.meta !== undefined) {
        const payload = await this.codec.encode(w.meta as E extends Entry<infer M> ? M : never);
        await writeBytes(this.files, blobP, payload);
        m.entries[w.uri] = { stamp };
      } else {
        // Live entry with no meta — rare but legal. Write the manifest row; no blob.
        m.entries[w.uri] = { stamp };
        if (await this.files.exists(blobP)) await this.files.remove(blobP);
      }
    }
    await this.save();
    for (const listener of this.listeners) listener(top);
  }

  async *since(cursor: number, limit: number): AsyncGenerator<E> {
    const m = await this.load();
    const sorted = Object.entries(m.entries)
      .filter(([, e]) => e.stamp > cursor)
      .sort((a, b) => a[1].stamp - b[1].stamp)
      .slice(0, limit);
    for (const [uri, persisted] of sorted) {
      yield await this.materialise<E>(uri, persisted);
    }
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

  private async materialise<T extends Entry>(uri: string, persisted: ManifestEntry): Promise<T> {
    const entry: Entry = { uri, stamp: persisted.stamp };
    if (persisted.tombstone) {
      (entry as { tombstone?: true }).tombstone = true;
      return entry as T;
    }
    const blobP = await this.blobPath(uri);
    if (await this.files.exists(blobP)) {
      const bytes = await readFile(this.files, blobP);
      const meta = await this.codec.decode(bytes);
      entry.meta = meta as Record<string, unknown>;
    }
    return entry as T;
  }
}

async function writeBytes(files: FilesApi, path: string, bytes: Uint8Array): Promise<void> {
  await files.write(
    path,
    (async function* () {
      yield bytes;
    })(),
  );
}
