import type {
  ContentMessage,
  ContentMessageProps,
} from "@repo/content-blocks";
import type { FilesApi } from "@statewalker/webrun-files";

/**
 * Groups all the information the scanner needs to walk a single directory tree.
 * Extracted as a type so collections can be registered, stored, and passed around
 * independently of the scanner instance that processes them.
 */
export type CollectionConfig = {
  /** Namespaces tracking records so multiple independent file trees can coexist in one scanner without URI collisions. */
  collectionId: string;
  /** Decouples the scanner from any specific file-system backend -- the same scanning logic works for browser, Node, or remote storage. */
  files: FilesApi;
  /** Limits the scan scope within a potentially larger FilesApi -- only files under this subtree are tracked. */
  root: string;
};

/**
 * Captures everything the scanner needs to decide whether a file has changed
 * between scans. Persisted as JSON so change detection survives process restarts
 * and works across async scan intervals.
 */
export type FileMetadata = {
  /** Combines `collectionId` and `filePath` into a single key -- used as the primary identity for change tracking. Format: `"{collectionId}:{path}"`. */
  uri: string;
  /** Links this record back to its collection so bulk operations (delete-all, list-by-collection) can filter without parsing the URI. */
  collectionId: string;
  /** Preserved separately from URI so callers can resolve the file against its collection's FilesApi without reverse-engineering the URI format. */
  path: string;
  /** Enables content-level change detection -- two files with the same size/mtime but different hashes are still flagged as changed. Empty when hashing is skipped. */
  hash: string;
  /** Used as a cheap first-pass change signal before the more expensive SHA-1 hash; if size hasn't changed, the file may still be unmodified. */
  size: number;
  /** Combined with `size` for a fast "dirty check" -- if neither changed, the scanner skips hashing entirely to save I/O. */
  lastModified: number;
  /** Records when this file was last observed so `getChanges(since)` can return only entries newer than a caller's checkpoint. */
  scanTime: string;
  /** Distinguishes "deleted" from "active" files -- non-null means the file disappeared and the record is kept only so downstream consumers can learn about the removal before `cleanupRemoved` purges it. */
  removalTime: string | null;
};

/**
 * Lets callers tune the scan without forking the scanning logic -- all knobs
 * are optional so the defaults work for most cases.
 */
export type ScanOptions = {
  /** Controls back-pressure: the scanner pauses every N files so large trees don't starve the event loop. Default: 50. */
  batchSize?: number;
  /** Cooperates with `batchSize` to throttle I/O -- useful when scanning over a network or shared file system where burst reads cause contention. Default: 0. */
  sleepMs?: number;
  /** Lets the caller exclude paths (e.g., `node_modules`, dotfiles) before any I/O happens, avoiding wasted reads and hash computations. */
  filter?: (path: string) => boolean;
  /** Trades accuracy for speed: when true, changes are detected by size + mtime only, skipping the SHA-1 read. Useful for quick "something changed" checks. Default: false. */
  skipHash?: boolean;
};

/**
 * Defines the lifecycle stages of a scan as a closed set so consumers can
 * exhaustively switch on event type without guessing. The four values map
 * to the scan's natural phases: start, per-file change, per-file removal, finish.
 */
export type ScanEventType =
  | "scan-started"
  | "content-changed"
  | "content-removed"
  | "scan-done";

// --------------------------------------------------------------
// Typed scan messages — so consumers get compile-time guarantees
// on the shape of every event the scanner emits.
// --------------------------------------------------------------

/**
 * Narrows `ContentMessageProps` to the exact fields every scan event carries.
 * Consumers can destructure `props` without casting or null-checking `type`/`stage`,
 * and TypeScript will catch mismatches if the scanner's output format changes.
 */
export interface ScanMessageProps extends ContentMessageProps {
  /** Always `"tool:content-scanner"` — identifies this message source in a mixed-message stream. */
  role: "tool:content-scanner";
  /** Always `"scanning"` — all scan events belong to the same processing phase. */
  stage: "scanning";
  /** Discriminates the four lifecycle phases; consumers can `switch` exhaustively on this. */
  type: ScanEventType;
  /** Which collection this event belongs to — present on every event so consumers never need to track scan context. */
  collection: string;
  /** The `{collectionId}:{filePath}` of the affected file. Present on `content-changed` and `content-removed`, absent on `scan-started` and `scan-done`. */
  uri?: string;
}

/**
 * The concrete message type yielded by `ContentScanner.scan()` and related methods.
 * Extends `ContentMessage` with a narrowed `props` so callers get full type safety
 * on the event shape without downcasting. Scanner events always have empty `blocks`
 * since they carry metadata, not content.
 */
export interface ScanMessage extends ContentMessage {
  props: ScanMessageProps;
}
