import type { FilesApi } from "@statewalker/webrun-files";
import type { Update } from "../types/update.js";
import type { WorkerDefinition, WorkerParams } from "../types/worker.js";

export interface FileWatcherOptions {
  files: FilesApi;
  rootPath: string;
  /** Worker name; defaults to `file-watcher`. */
  name?: string;
  /** Worker version; defaults to `v1`. */
  version?: string;
}

interface FileFingerprint {
  size: number;
  mtime: number;
  path: string;
}

function fileUri(path: string): string {
  // Maps virtual path '/a/b.md' → 'file:///a/b.md' (three slashes per RFC 8089).
  return `file://${path}`;
}

function fingerprint(size: number, mtime: number): string {
  return `${size}:${mtime}`;
}

/**
 * Source worker that scans all files under `rootPath` via `FilesApi`. Emits
 * `file://<path>` URIs with status added/updated/removed based on a
 * `(size, mtime)` fingerprint diffed against committed state.
 *
 * The watcher does NOT read file bytes; downstream extractors do that work.
 */
export function createFileWatcher(opts: FileWatcherOptions): WorkerDefinition {
  const { files, rootPath } = opts;
  const name = opts.name ?? "file-watcher";
  const version = opts.version ?? "v1";

  return {
    name,
    version,
    description: `Polls FilesApi at ${rootPath}; emits file:// URIs on change.`,
    outputPattern: "file://**",
    selector: async function* () {
      yield { uri: `tick://${name}`, stamp: 0, status: "updated" };
    },
    run: async function* (
      params: WorkerParams,
      input: AsyncIterable<Update>,
    ): AsyncGenerator<Update> {
      for await (const _tick of input) {
        if (params.signal.aborted) return;
        // Snapshot the FS.
        const found = new Map<string, FileFingerprint>();
        for await (const info of files.list(rootPath, { recursive: true })) {
          if (info.kind !== "file") continue;
          found.set(info.path, {
            path: info.path,
            size: info.size ?? 0,
            mtime: info.lastModified ?? 0,
          });
        }

        // Snapshot prior known files from the graph.
        const known = new Map<string, FileFingerprint>();
        for await (const view of params.find("file:///%")) {
          const path = view.uri.replace(/^file:\/\//, "");
          const attrs = (view.attributes ?? {}) as Partial<FileFingerprint>;
          known.set(path, {
            path,
            size: attrs.size ?? 0,
            mtime: attrs.mtime ?? 0,
          });
        }

        const stamp = await params.stamp();

        // Emit added / updated.
        for (const [path, info] of found) {
          const prev = known.get(path);
          const changed = !prev || prev.size !== info.size || prev.mtime !== info.mtime;
          if (!changed) continue;
          yield {
            uri: fileUri(path),
            stamp,
            status: prev ? "updated" : "added",
            hash: fingerprint(info.size, info.mtime),
            attributes: {
              path: info.path,
              size: info.size,
              mtime: info.mtime,
            },
          };
        }

        // Emit removed.
        for (const path of known.keys()) {
          if (found.has(path)) continue;
          yield {
            uri: fileUri(path),
            stamp,
            status: "removed",
          };
        }
      }
    },
  };
}
