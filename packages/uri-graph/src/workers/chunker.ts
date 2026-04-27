import { findDirty } from "../graph/selector-helpers.js";
import type { GraphStore } from "../store/types.js";
import type { Update } from "../types/update.js";
import type { WorkerDefinition, WorkerParams } from "../types/worker.js";
import { sha256Hex } from "../util/hash.js";

export interface ChunkerOptions {
  /** Maximum characters per chunk. Default 1000. */
  chunkSize?: number;
  /** Optional graph; if provided, the selector uses `findDirty` to yield pending text:// URIs. */
  graph?: GraphStore;
  name?: string;
  version?: string;
}

function chunkUri(textUri: string, index: number): string {
  // chunk:///path#i — simple URI scheme.
  return `chunk:${textUri.slice("text:".length)}#${index}`;
}

function chunkIndex(uri: string): number {
  const m = /#(\d+)$/.exec(uri);
  return m && m[1] !== undefined ? Number(m[1]) : -1;
}

function makeChunkerSelector(graph: GraphStore | undefined): WorkerDefinition["selector"] {
  if (!graph) {
    return async function* () {
      // Driven externally (test harness).
    };
  }
  return (ctx) =>
    findDirty(graph, {
      forWorker: ctx.workerName,
      forVersion: ctx.workerVersion,
      uriLike: "text:///%",
      limit: ctx.limit,
    });
}

function splitText(text: string, size: number): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

/**
 * Format-agnostic chunker: consumes `text://` URIs, splits each document into
 * fixed-size character chunks, and yields `chunk://...` URIs under one stamp
 * shared by all chunks of one document. Removed inputs cascade to their prior
 * chunks via `priorOutputs`.
 */
export function createChunker(opts: ChunkerOptions = {}): WorkerDefinition {
  const chunkSize = opts.chunkSize ?? 1000;
  const name = opts.name ?? "chunker";
  const version = opts.version ?? "v1";

  return {
    name,
    version,
    description: "Splits text:// URIs into fixed-size chunks; format-agnostic.",
    inputPattern: "text://**",
    outputPattern: "chunk://**",
    scopeExpr: "uri",
    selector: makeChunkerSelector(opts.graph),
    run: async function* (
      params: WorkerParams,
      input: AsyncIterable<Update>,
    ): AsyncGenerator<Update> {
      for await (const doc of input) {
        // findDirty doesn't carry the document text in attributes by default for
        // text URIs that were committed by the extractor. Re-read the latest state.
        if (
          doc.uri.startsWith("text:") &&
          (doc.attributes === undefined ||
            (doc.attributes as Record<string, unknown>).text === undefined)
        ) {
          const live = await params.read(doc.uri);
          if (live?.attributes) {
            doc.attributes = live.attributes as Record<string, unknown>;
          }
        }
        if (params.signal.aborted) return;
        const prior = await params.priorOutputs(doc.uri);
        if (doc.status === "removed") {
          const stamp = await params.stamp();
          for (const old of prior) {
            yield {
              uri: old.uri,
              stamp,
              status: "removed",
              scope: doc.uri,
              role: "chunk",
            };
          }
          continue;
        }

        const text = ((doc.attributes as Record<string, unknown>)?.text as string) ?? "";
        const chunks = splitText(text, chunkSize);
        const stamp = await params.stamp();

        const priorChunkUris = new Set(prior.map((p) => p.uri));
        for (const [i, chunk] of chunks.entries()) {
          const uri = chunkUri(doc.uri, i);
          const hash = await sha256Hex(chunk);
          yield {
            uri,
            stamp,
            status: priorChunkUris.has(uri) ? "updated" : "added",
            hash,
            scope: doc.uri,
            role: "chunk",
            attributes: { text: chunk, index: i },
          };
        }

        // Cascade removals for indices beyond current count.
        const currentMax = chunks.length;
        for (const old of prior) {
          const idx = chunkIndex(old.uri);
          if (idx >= currentMax) {
            yield {
              uri: old.uri,
              stamp,
              status: "removed",
              scope: doc.uri,
              role: "chunk",
            };
          }
        }
      }
    },
  };
}
