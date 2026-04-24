import { sha1Bytes } from "@statewalker/shared-ids";
import type { FilesApi } from "@statewalker/webrun-files";
import { readFile } from "@statewalker/webrun-files";
import type { Store } from "./store.js";
import type { FileEntry } from "./types.js";

export type ScanFilesOptions = {
  /** Exclude paths before any I/O by returning `false`. */
  filter?: (path: string) => boolean;
};

/**
 * Walk `root` on `files`, comparing each file against the store's last recorded
 * entry. Writes changed files, tombstones disappeared files. No-op for unchanged
 * files (matching size + mtime + hash). Callers trigger this; periodic scheduling
 * lives in the caller, not here.
 */
export async function scanFiles(
  files: FilesApi,
  root: string,
  own: Store<FileEntry>,
  options?: ScanFilesOptions,
): Promise<void> {
  const filter = options?.filter;
  const seen = new Set<string>();
  const writes: { uri: string; meta: { size: number; mtime: number; hash: string } }[] = [];

  for await (const info of files.list(root, { recursive: true })) {
    if (info.kind !== "file") continue;
    if (filter && !filter(info.path)) continue;
    seen.add(info.path);

    const size = info.size ?? 0;
    const mtime = info.lastModified ?? 0;
    const prev = await own.get(info.path);

    if (
      prev &&
      !prev.tombstone &&
      prev.meta &&
      prev.meta.size === size &&
      prev.meta.mtime === mtime
    ) {
      continue;
    }

    const hash = await sha1Bytes((await readFile(files, info.path)) as Uint8Array<ArrayBuffer>);
    if (prev && !prev.tombstone && prev.meta && prev.meta.hash === hash) continue;

    writes.push({ uri: info.path, meta: { size, mtime, hash } });
  }

  // Tombstone entries that exist in the store but were not seen this pass.
  const tombstones: { uri: string; tombstone: true }[] = [];
  for await (const entry of own.since(0, Number.POSITIVE_INFINITY)) {
    if (entry.tombstone) continue;
    if (!seen.has(entry.uri)) tombstones.push({ uri: entry.uri, tombstone: true });
  }

  if (writes.length > 0 || tombstones.length > 0) {
    await own.put([...writes, ...tombstones]);
  }
}
