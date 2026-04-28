import { findDirty } from "../graph/selector-helpers.js";
import type { GraphStore } from "../store/types.js";
import type { Update } from "../types/update.js";
import type { WorkerDefinition, WorkerParams } from "../types/worker.js";
import { sha256Hex } from "../util/hash.js";

export interface EmbedderOptions {
  /** Embedding function — must run before the stamp is minted to keep txns short. */
  embed: (text: string, opts: { signal: AbortSignal }) => Promise<Float32Array>;
  /** Optional metadata attached to each emitted embedding update. */
  model?: string;
  /** Optional graph; when provided, the selector finds pending chunk:// URIs. */
  graph?: GraphStore;
  name?: string;
  version?: string;
}

function embeddingUri(chunkUri: string): string {
  return `embedding://${chunkUri}`;
}

function makeEmbedderSelector(graph: GraphStore | undefined): WorkerDefinition["selector"] {
  if (!graph) {
    return async function* () {
      // Driven externally (test harness).
    };
  }
  return (ctx) =>
    findDirty(graph, {
      forWorker: ctx.workerName,
      forVersion: ctx.workerVersion,
      uriLike: "chunk:///%",
      limit: ctx.limit,
    });
}

function vectorHashSync(vec: Float32Array): string {
  // Cheap fingerprint; sha256 over the bytes.
  // Returns a string usable for the no-op rule.
  const buf = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
  let acc = 0n;
  for (let i = 0; i < buf.length; i++) {
    acc = ((acc << 7n) ^ BigInt(buf[i] ?? 0)) & 0xffffffffffffffffn;
  }
  return acc.toString(16);
}

/**
 * Consumes `chunk://**` updates and emits `embedding://...` updates. Mints one
 * stamp per item AFTER the embedding call to keep the logical transaction
 * boundary tight (the slow API call happens outside the txn).
 */
export function createEmbedder(opts: EmbedderOptions): WorkerDefinition {
  const name = opts.name ?? "embedder";
  const version = opts.version ?? "v1";
  const model = opts.model ?? "unknown";

  return {
    name,
    version,
    description: "Embeds chunk:// updates into embedding:// vectors.",
    inputPattern: "chunk://**",
    outputPattern: "embedding://**",
    scopeExpr: "uri",
    selector: makeEmbedderSelector(opts.graph),
    run: async function* (
      params: WorkerParams,
      input: AsyncIterable<Update>,
    ): AsyncGenerator<Update> {
      for await (const chunk of input) {
        if (params.signal.aborted) return;

        // If the selector handed us a chunk URI without text in attributes,
        // re-read the live state to get the chunk body.
        if (
          chunk.uri.startsWith("chunk:") &&
          (chunk.attributes === undefined ||
            (chunk.attributes as Record<string, unknown>).text === undefined)
        ) {
          const live = await params.read(chunk.uri);
          if (live?.attributes) {
            chunk.attributes = live.attributes as Record<string, unknown>;
          }
        }

        if (chunk.status === "removed") {
          const stamp = await params.stamp();
          yield {
            uri: embeddingUri(chunk.uri),
            stamp,
            status: "removed",
            scope: chunk.uri,
            role: "embedding",
          };
          continue;
        }

        const text = ((chunk.attributes as Record<string, unknown>)?.text as string) ?? "";
        // Slow work outside the logical transaction.
        const vector = await opts.embed(text, { signal: params.signal });
        if (params.signal.aborted) return;

        const hash = vectorHashSync(vector) || (await sha256Hex(text));
        const stamp = await params.stamp();
        yield {
          uri: embeddingUri(chunk.uri),
          stamp,
          status: "updated",
          hash,
          scope: chunk.uri,
          role: "embedding",
          attributes: {
            vector: Array.from(vector),
            model,
            sourceChunkUri: chunk.uri,
          },
        };
      }
    },
  };
}
