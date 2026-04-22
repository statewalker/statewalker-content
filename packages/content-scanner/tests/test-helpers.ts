import { encodeFloat32Arrays, encodeMsgpack } from "@statewalker/webrun-msgpack";
import type { Update } from "../src/scan-store.js";
import type { UpdateSource } from "../src/scanner.js";

/** Collect all items from an async iterable into an array. */
export async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

/** Get an element by index, throwing if undefined. */
export function at<T>(arr: T[], index: number): T {
  const item = arr[index];
  if (item === undefined) throw new Error(`no element at index ${index}`);
  return item;
}

/** Invoke content() on an Update, throwing if content is absent. */
export function contentOf(update: Update): AsyncGenerator<Uint8Array> {
  if (!update.content) throw new Error("expected content");
  return update.content();
}

/** Create a default Update with optional overrides. */
export function makeUpdate(overrides: Partial<Update> = {}): Update {
  return {
    uri: "/docs/file.txt",
    stamp: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

/** Create an UpdateSource from a plain array of Updates. */
export function makeSource(entries: Update[]): UpdateSource {
  return function* () {
    yield* entries;
  };
}

const DEFAULT_STAMP = new Date("2026-04-01T00:00:00Z");

/** Create an UpdateSource that yields entries with text as binary content. */
export function makeContentSource(entries: Array<{ uri: string; text: string }>): UpdateSource {
  return async function* () {
    for (const e of entries) {
      const encoded = new TextEncoder().encode(e.text);
      yield {
        uri: e.uri,
        stamp: DEFAULT_STAMP,
        async *content() {
          yield encoded;
        },
      };
    }
  };
}

/** Create an UpdateSource that yields entries with chunks as msgpack stream. */
export function makeChunksSource(
  entries: Array<{
    uri: string;
    chunks: Array<{ index: number; content: string }>;
  }>,
): UpdateSource {
  return async function* () {
    for (const e of entries) {
      yield {
        uri: e.uri,
        stamp: DEFAULT_STAMP,
        content: () => encodeMsgpack(toAsync(e.chunks)),
      };
    }
  };
}

/** Create an UpdateSource that yields entries with embeddings as Float32Array stream. */
export function makeEmbeddingsSource(
  entries: Array<{ uri: string; embeddings: Float32Array[] }>,
): UpdateSource {
  return async function* () {
    for (const e of entries) {
      yield {
        uri: e.uri,
        stamp: DEFAULT_STAMP,
        content: () => encodeFloat32Arrays(toAsync(e.embeddings)),
      };
    }
  };
}

async function* toAsync<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}
