import type { FilesApi } from "@statewalker/webrun-files";
import { readText } from "@statewalker/webrun-files";
import { findDirty } from "../../graph/selector-helpers.js";
import type { GraphStore } from "../../store/types.js";
import type { Update } from "../../types/update.js";
import type { WorkerDefinition, WorkerParams } from "../../types/worker.js";
import { sha256Hex } from "../../util/hash.js";

export interface ExtractorOptions {
  files: FilesApi;
  /**
   * Optional graph; if provided, the extractor's selector uses `findDirty` to
   * yield pending file:// URIs matching its pattern. Without it, the selector is
   * empty and the extractor must be fed via an external input stream (useful for
   * unit tests).
   */
  graph?: GraphStore;
  /** Optional override of worker name/version. */
  name?: string;
  version?: string;
}

export interface ExtractorSpec extends ExtractorOptions {
  /** Worker name (defaults to spec.defaultName). */
  defaultName: string;
  /** Worker version. */
  defaultVersion: string;
  /** SQL-LIKE pattern matching the file URIs this extractor handles. */
  uriLike: string;
  /** RegExp tested against the path; only matches are extracted. */
  pathPattern: RegExp;
  /** Mime declared on the produced text:// update. */
  mime: string;
  /**
   * Transform raw file text into the extracted body that gets indexed.
   * For markdown / plain text this can be the identity; for html, strip tags.
   */
  transform(raw: string): string;
}

function fileToTextUri(uri: string): string {
  return uri.replace(/^file:/, "text:");
}

function makeSelector(spec: ExtractorSpec): WorkerDefinition["selector"] {
  const graph = spec.graph;
  if (!graph) {
    return async function* () {
      // No graph wired; selector is empty (driven externally for unit tests).
    };
  }
  return (ctx) =>
    findDirty(graph, {
      forWorker: ctx.workerName,
      forVersion: ctx.workerVersion,
      uriLike: spec.uriLike,
      limit: ctx.limit,
    });
}

/**
 * Build a content extractor that consumes `file://**` URIs matching the spec's
 * `pathPattern`, reads bytes via `FilesApi`, and emits a `text://...` URI carrying
 * the extracted text and a real content hash.
 */
export function createExtractor(spec: ExtractorSpec): WorkerDefinition {
  const name = spec.name ?? spec.defaultName;
  const version = spec.version ?? spec.defaultVersion;
  const files = spec.files;

  return {
    name,
    version,
    description: `Extracts plain text from files matching ${spec.uriLike}.`,
    inputPattern: spec.uriLike,
    outputPattern: "text://**",
    scopeExpr: "uri",
    selector: makeSelector(spec),
    run: async function* (
      params: WorkerParams,
      input: AsyncIterable<Update>,
    ): AsyncGenerator<Update> {
      for await (const file of input) {
        if (params.signal.aborted) return;
        const path = file.uri.replace(/^file:\/\//, "");
        if (!spec.pathPattern.test(path)) continue;

        if (file.status === "removed") {
          const stamp = await params.stamp();
          yield {
            uri: fileToTextUri(file.uri),
            stamp,
            status: "removed",
            scope: file.uri,
          };
          continue;
        }

        // Slow work BEFORE minting stamp.
        const raw = await readText(files, path);
        const body = spec.transform(raw);
        const hash = await sha256Hex(body);

        const stamp = await params.stamp();
        yield {
          uri: fileToTextUri(file.uri),
          stamp,
          status: file.status === "added" ? "added" : "updated",
          hash,
          scope: file.uri,
          attributes: {
            text: body,
            mime: spec.mime,
            sourceUri: file.uri,
          },
        };
      }
    },
  };
}
