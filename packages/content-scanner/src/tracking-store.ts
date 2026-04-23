import { sha1Uuid } from "@statewalker/shared-ids";
import type { FilesApi } from "@statewalker/webrun-files";
import { readText, writeText } from "@statewalker/webrun-files";
import type { FileMetadata } from "./types.js";

/**
 * Abstracts metadata persistence behind a simple CRUD interface so the
 * ContentScanner doesn't need to know how or where tracking data is stored.
 * Uses a two-level hash directory (`{dd}/{hash}.json`) to avoid
 * file-system performance degradation from too many files in one folder.
 * Backed by FilesApi, so it works identically across browser, Node, and
 * remote storage backends.
 */
export class TrackingStore {
  constructor(
    private readonly files: FilesApi,
    private readonly prefix: string,
  ) {}

  /** Derives a deterministic, collision-free file path from a URI so each metadata record has a stable storage location regardless of special characters in the original path. */
  async pathFor(uri: string): Promise<string> {
    const hash = await sha1Uuid(uri);
    const dd = hash.slice(0, 2);
    return `${this.prefix}/tracking/${dd}/${hash}.json`;
  }

  /** Loads a single record by URI so the scanner can compare current file-system state against the last-known snapshot and decide whether the file changed. */
  async get(params: { uri: string }): Promise<FileMetadata | undefined> {
    const path = await this.pathFor(params.uri);
    if (!(await this.files.exists(path))) return undefined;
    const text = await readText(this.files, path);
    if (!text) return undefined;
    return JSON.parse(text) as FileMetadata;
  }

  /** Persists a metadata snapshot so future scans have a baseline to diff against. Called after every file is processed, whether changed or not, to keep `scanTime` current. */
  async set(params: { metadata: FileMetadata }): Promise<void> {
    const path = await this.pathFor(params.metadata.uri);
    await writeText(this.files, path, JSON.stringify(params.metadata));
  }

  /** Removes a single tracking record when its file is purged during cleanup or collection removal. Returns true so callers can count successful deletions. */
  async delete(params: { uri: string }): Promise<boolean> {
    const path = await this.pathFor(params.uri);
    return this.files.remove(path);
  }

  /** Streams all records without loading them into memory at once -- essential for large collections where the full set wouldn't fit comfortably in RAM. */
  async *listAll(): AsyncGenerator<FileMetadata> {
    const trackingDir = `${this.prefix}/tracking`;
    if (!(await this.files.exists(trackingDir))) return;

    for await (const info of this.files.list(trackingDir, {
      recursive: true,
    })) {
      if (info.kind !== "file" || !info.path.endsWith(".json")) continue;
      const text = await readText(this.files, info.path);
      if (!text) continue;
      yield JSON.parse(text) as FileMetadata;
    }
  }

  /** Filters to a single collection so the scanner can detect removals (files present in the store but missing from the latest file-system listing). */
  async *listByCollection(params: { collectionId: string }): AsyncGenerator<FileMetadata> {
    for await (const meta of this.listAll()) {
      if (meta.collectionId === params.collectionId) {
        yield meta;
      }
    }
  }

  /** Wipes all tracking state for a collection -- called when a collection is unregistered so orphaned records don't pollute future scans or change queries. */
  async deleteByCollection(params: { collectionId: string }): Promise<number> {
    let count = 0;
    const toDelete: string[] = [];
    for await (const meta of this.listAll()) {
      if (meta.collectionId === params.collectionId) {
        toDelete.push(meta.uri);
      }
    }
    for (const uri of toDelete) {
      const deleted = await this.delete({ uri });
      if (deleted) count++;
    }
    return count;
  }

  /** Purges old removal records that are past the retention window, preventing unbounded store growth while still giving `getChanges` consumers time to observe deletions. */
  async deleteRemovedBefore(params: { before: string }): Promise<number> {
    let count = 0;
    const beforeTime = new Date(params.before).getTime();
    const toDelete: string[] = [];
    for await (const meta of this.listAll()) {
      if (meta.removalTime !== null && new Date(meta.removalTime).getTime() < beforeTime) {
        toDelete.push(meta.uri);
      }
    }
    for (const uri of toDelete) {
      const deleted = await this.delete({ uri });
      if (deleted) count++;
    }
    return count;
  }
}
