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
}

export class ContentManagerScanner {
  private readonly contentManager: ContentManager;
  private readonly scanner: ContentScanner;
  private readonly extractors: ExtractorRegistry;
  private readonly files: FilesApi;
  private readonly collectionId: string;
  private readonly filter?: (path: string) => boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: ContentManagerScannerOptions) {
    this.contentManager = options.contentManager;
    this.scanner = options.scanner;
    this.extractors = options.extractors;
    this.files = options.files;
    this.collectionId = options.collectionId ?? "default";
    this.filter = options.filter;
  }

  async *scan(): AsyncGenerator<ScanEvent> {
    yield { type: "scan-started" };

    let changed = 0;
    let removed = 0;
    let scanned = 0;
    let errors = 0;

    for await (const msg of this.scanner.scan({
      collectionId: this.collectionId,
      options: { filter: this.filter },
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

    const doScan = async () => {
      if (this.running) return;
      this.running = true;
      try {
        for await (const _event of this.scan()) {
          /* consume events */
        }
      } finally {
        this.running = false;
      }
    };

    this.timer = setInterval(doScan, interval);
    void doScan();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
