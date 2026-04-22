import { decodeMsgpack, encodeFloat32Arrays } from "@statewalker/webrun-msgpack";
import { collect } from "@statewalker/webrun-streams";
import type { ChunkData } from "./content-splitter-scanner.js";
import type { ScanStore, Update } from "./scan-store.js";
import type { ScannerOptions } from "./scanner.js";
import { Scanner } from "./scanner.js";

export type EmbedFn = (text: string) => Promise<Float32Array>;

export type ContentEmbedderOptions = ScannerOptions & {
  /** Function to generate embeddings for a text chunk. */
  embed: EmbedFn;
  /** Model name for metadata. */
  model?: string;
  /** Embedding dimensionality for metadata. */
  dimensions?: number;
};

/**
 * Scanner that generates embeddings for content chunks.
 *
 * Reads chunks from the upstream "chunks" store via msgpack stream,
 * generates embeddings for each chunk, and stores them as Float32Array
 * stream in the "embeddings" store.
 */
export class ContentEmbedderScanner extends Scanner {
  private readonly embed: EmbedFn;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(store: ScanStore, options: ContentEmbedderOptions) {
    super(store, options);
    this.embed = options.embed;
    this.model = options.model ?? "unknown";
    this.dimensions = options.dimensions ?? 0;
  }

  async processEntry(upstream: Update): Promise<Update | null> {
    if (!upstream.content) return null;

    // Stream-decode chunks from upstream msgpack frames
    const chunks = await collect(decodeMsgpack<ChunkData>(upstream.content()));
    if (chunks.length === 0) return null;

    // Generate embeddings for each chunk
    const embeddings: Float32Array[] = [];
    for (const chunk of chunks) {
      const embedding = await this.embed(chunk.content);
      embeddings.push(embedding);
    }

    return {
      uri: upstream.uri,
      stamp: upstream.stamp,
      meta: {
        model: this.model,
        dimensions: this.dimensions || (embeddings[0]?.length ?? 0),
        chunkCount: embeddings.length,
      },
      content: () => encodeFloat32Arrays(toAsync(embeddings)),
    };
  }

  async removeEntry(_uri: string): Promise<void> {}
}

async function* toAsync<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}
