import type { ChunkOptions } from "@repo/indexer-chunker";
import { chunkMarkdown } from "@repo/indexer-chunker";
import { collectString, decodeText, encodeMsgpack } from "@repo/streams";
import type { ScanStore, Update } from "./scan-store.js";
import type { ScannerOptions } from "./scanner.js";
import { Scanner } from "./scanner.js";

export type ContentSplitterOptions = ScannerOptions & {
  /** Chunking configuration. */
  chunkOptions: ChunkOptions;
};

/** Chunk data shape stored via msgpack. */
export type ChunkData = { index: number; content: string };

/**
 * Scanner that splits extracted content into chunks.
 *
 * Reads content from the upstream "content" store, splits it using
 * `chunkMarkdown()` from `@repo/indexer-chunker`, and stores serialized
 * chunks as msgpack frames in the "chunks" store.
 */
export class ContentSplitterScanner extends Scanner {
  private readonly chunkOptions: ChunkOptions;

  constructor(store: ScanStore, options: ContentSplitterOptions) {
    super(store, options);
    this.chunkOptions = options.chunkOptions;
  }

  async processEntry(upstream: Update): Promise<Update | null> {
    if (!upstream.content) return null;
    const text = await collectString(decodeText(upstream.content()));
    if (!text) return null;

    const chunks = chunkMarkdown(text, this.chunkOptions);
    const payload: ChunkData[] = chunks.map((c) => ({
      index: c.index,
      content: c.content,
    }));

    return {
      uri: upstream.uri,
      stamp: upstream.stamp,
      meta: {
        chunkCount: chunks.length,
        targetChars: this.chunkOptions.targetChars,
      },
      content: () => encodeMsgpack(toAsync(payload)),
    };
  }

  async removeEntry(_uri: string): Promise<void> {}
}

async function* toAsync<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}
