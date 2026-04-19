import type { FilesApi } from "@statewalker/webrun-files";

/** Timestamp type for scan tracking. Serialized as ISO string in JSON on disk. */
export type Stamp = Date;

/** A tracked entry in a scan store. */
export type Update = {
  /** Primary key — identifies the tracked resource. */
  uri: string;
  /** When this entry was last touched by a scan. */
  stamp: Stamp;
  /** Soft-delete timestamp. Set by `remove()`, observed by downstream scanners. */
  removed?: Stamp;
  /** Lightweight JSON-serializable metadata. */
  meta?: Record<string, unknown>;
  /** Lazy accessor for heavyweight binary content. Reads from disk on each call. */
  content?: () => AsyncGenerator<Uint8Array>;
};

/** Filter parameters for `list()` and `remove()`. */
export type ListParams = {
  /** URI mask. If it ends with `*`, used as a prefix match. Otherwise exact match. */
  uri?: string;
  /** Return entries whose stamp matches this value or falls within this range (inclusive). */
  include?: Stamp | [Stamp, Stamp];
  /** Exclude entries whose stamp matches this value or falls within this range (inclusive). */
  exclude?: Stamp | [Stamp, Stamp];
};

/** A named store that tracks per-URI updates with metadata and optional binary content. */
export interface ScanStore {
  readonly name: string;

  /** Stream-write entries. Index is updated per batch and at the end. Yields stored entries. */
  store(updates: Iterable<Update> | AsyncIterable<Update>): AsyncGenerator<Update>;

  /** List entries matching the given filters. Includes soft-deleted entries. Content is lazy. */
  list(params?: ListParams): AsyncGenerator<Update>;

  /** Soft-delete entries matching the given filters. Yields the removed entries. */
  remove(params?: ListParams): AsyncGenerator<Update>;

  /** Get the timestamp of the last completed scan, or `null` if never scanned. */
  getLastScan(): Promise<Stamp | null>;

  /** Set the timestamp of the last completed scan. */
  setLastScan(stamp: Stamp): Promise<void>;

  /** Physically delete entries soft-removed before the given date. Returns count deleted. */
  prune(before: Stamp): Promise<number>;

  /** Reconstruct _index.json from individual entry files. */
  rebuildIndex(): Promise<void>;
}

/** Registry that manages named ScanStore instances. Modeled after the Indexer interface. */
export interface ScanRegistry {
  /** Create a new named store. Throws if a store with this name already exists. */
  createStore(name: string): Promise<ScanStore>;

  /** Get an existing store by name, or `null` if it doesn't exist. */
  getStore(name: string): Promise<ScanStore | null>;

  /** Check whether a store with the given name exists. */
  hasStore(name: string): Promise<boolean>;

  /** List the names of all existing stores. */
  getStoreNames(): Promise<string[]>;

  /** Delete a store and all its data. */
  deleteStore(name: string): Promise<void>;

  /** Persist any pending state. */
  flush(): Promise<void>;

  /** Close all stores and release resources. */
  close(): Promise<void>;
}

/** Options for creating a FilesApi-backed ScanRegistry. */
export type ScanRegistryOptions = {
  files: FilesApi;
  prefix?: string;
};
