/**
 * Monotonic integer stamp allocator. Seeded from `Date.now()` on first use; restart-safe
 * when the store persists `current()` and re-seeds via `seed()` on reload.
 * Every call to `next()` returns a strictly larger integer than the previous call.
 */
export interface StampAllocator {
  /** Returns the next stamp (strictly > previously returned values). */
  next(): number;
  /** Returns the most recently returned stamp without advancing. */
  current(): number;
  /**
   * Re-seed after loading a persisted counter. Future `next()` calls return at least
   * `max(value + 1, Date.now())`, so a stale clock never regresses the counter.
   */
  seed(value: number): void;
}

/** Default `StampAllocator` — pure, no I/O; caller persists `current()`. */
export function createStampAllocator(initial = 0): StampAllocator {
  let counter = Math.max(initial, Date.now());
  return {
    next: () => {
      const now = Date.now();
      counter = Math.max(counter + 1, now);
      return counter;
    },
    current: () => counter,
    seed: (value: number) => {
      counter = Math.max(value, Date.now() - 1);
    },
  };
}
