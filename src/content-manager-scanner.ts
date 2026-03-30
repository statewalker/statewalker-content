import type { ExtractorRegistry } from "@repo/content-extractors";
import type { ContentScanner } from "@repo/content-scanner";
import { parseUri } from "@repo/content-scanner";
import type { FilesApi } from "@statewalker/webrun-files";
import { readFile } from "@statewalker/webrun-files";
import type { ContentManager } from "./types.js";

export type ScanEvent =
  | { type: "scan-started" }
  | { type: "file-changed"; uri: string }
  | { type: "file-removed"; uri: string }
  | { type: "file-skipped"; uri: string; reason: string }
  | { type: "file-error"; uri: string; error: string }
  | {
      type: "scan-done";
      stats: {
        scanned: number;
        changed: number;
        removed: number;
        errors: number;
      };
    };

export interface ContentManagerScannerOptions {
  contentManager: ContentManager;
  scanner: ContentScanner;
  extractors: ExtractorRegistry;
  /** File system to read files from (resolved from URIs) */
  files: FilesApi;
  /** Collection ID for scanning (default: "default") */
  collectionId?: string;
  /** Path filter — return false to skip a file */
  filter?: (path: string) => boolean;
  /** Yield control every N processed files (default: 50) */
  batchSize?: number;
  /** Milliseconds to sleep between batches (default: 10) */
  sleepMs?: number;
  /** Optional error handler (default: logs to console) */
  onError?: (error: unknown) => void;
}

export class ContentManagerScanner {
  private readonly contentManager: ContentManager;
  private readonly scanner: ContentScanner;
  private readonly extractors: ExtractorRegistry;
  private readonly files: FilesApi;
  private readonly collectionId: string;
  private readonly filter?: (path: string) => boolean;
  private readonly batchSize: number;
  private readonly sleepMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopped = false;
  private onError: (error: unknown) => void;

  constructor(options: ContentManagerScannerOptions) {
    this.contentManager = options.contentManager;
    this.scanner = options.scanner;
    this.extractors = options.extractors;
    this.files = options.files;
    this.collectionId = options.collectionId ?? "default";
    this.filter = options.filter;
    this.batchSize = options.batchSize ?? 50;
    this.sleepMs = options.sleepMs ?? 10;
    this.onError =
      options.onError ??
      ((error: unknown) =>
        console.error("ContentManagerScanner error:", error));
  }

  async *scan(): AsyncGenerator<ScanEvent> {
    yield { type: "scan-started" };

    let changed = 0;
    let removed = 0;
    let scanned = 0;
    let errors = 0;
    let processed = 0;

    for await (const msg of this.scanner.scan({
      collectionId: this.collectionId,
      options: {
        filter: this.filter,
        batchSize: this.batchSize,
        sleepMs: this.sleepMs,
      },
    })) {
      const eventType = msg.props.type;
      const uri = msg.props.uri;

      if (eventType === "content-changed" && uri) {
        scanned++;
        const { path: filePath } = parseUri(uri);

        try {
          const bytes = await readFile(this.files, filePath);
          const extractor = this.extractors.get(filePath);

          if (extractor) {
            const result = await extractor([bytes]);
            const text = typeof result === "string" ? result : String(result);
            await this.contentManager.setRawContent({ uri, content: text });
            changed++;
            yield { type: "file-changed", uri };
          } else {
            yield { type: "file-skipped", uri, reason: "no extractor" };
          }
        } catch (err) {
          errors++;
          yield { type: "file-error", uri, error: String(err) };
        }

        // Yield control periodically during extraction/indexing
        processed++;
        if (this.sleepMs > 0 && processed % this.batchSize === 0) {
          await new Promise((r) => setTimeout(r, this.sleepMs));
        }
      } else if (eventType === "content-removed" && uri) {
        scanned++;
        try {
          await this.contentManager.removeContent(uri);
          removed++;
          yield { type: "file-removed", uri };
        } catch (err) {
          errors++;
          yield { type: "file-error", uri, error: String(err) };
        }
      }
    }

    yield {
      type: "scan-done",
      stats: { scanned, changed, removed, errors },
    };
  }

  start(options?: { intervalMs?: number }): void {
    const interval = options?.intervalMs ?? 30_000;
    this.stop();
    this.stopped = false;

    const doScan = async () => {
      if (this.running || this.stopped) return;
      this.running = true;
      try {
        for await (const _event of this.scan()) {
          if (this.stopped) break;
          /* consume events */
        }
      } catch (err) {
        this.onError(err);
      } finally {
        this.running = false;
      }
      if (!this.stopped) {
        this.timer = setTimeout(doScan, interval);
      }
    };

    void doScan();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
