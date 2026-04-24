import type { Entry } from "./types.js";

/**
 * Payload written to a store. The stamp is allocated by the store, not the caller.
 * Tombstones and live entries share this shape.
 */
export type StoreWrite<E extends Entry> = Omit<E, "stamp">;

export type StampListener = (stamp: number) => void;
export type Unsubscribe = () => void;

/** A per-URI manifest of entries with monotonic stamps and per-listener cursors. */
export interface Store<E extends Entry> {
  /** Lookup by URI. Returns the latest entry (live or tombstone) or undefined. */
  get(uri: string): Promise<E | undefined>;

  /**
   * Write entries. Each entry receives a fresh monotonic stamp, even within a single batch.
   * Listeners are notified once with the new highest stamp after the batch is committed.
   */
  put(entries: StoreWrite<E>[]): Promise<void>;

  /** Yield entries with `stamp > cursor`, ordered by stamp ascending, up to `limit` items. */
  since(cursor: number, limit: number): AsyncGenerator<E>;

  /** Get the persisted cursor for the given listener name. Defaults to 0 if unknown. */
  cursor(name: string): Promise<number>;

  /** Persist a new cursor for the named listener. */
  advance(name: string, stamp: number): Promise<void>;

  /** Subscribe to stamp-advancement notifications. Returns an unsubscribe function. */
  onStampUpdate(listener: StampListener): Unsubscribe;

  /** Release any resources held by the store. Idempotent. */
  close(): Promise<void>;
}

export type { StampAllocator } from "./stores/stamp.js";
export { createStampAllocator } from "./stores/stamp.js";
