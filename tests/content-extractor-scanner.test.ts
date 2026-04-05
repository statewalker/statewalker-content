import { ExtractorRegistry } from "@repo/content-extractors";
import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { ContentExtractorScanner } from "../src/content-extractor-scanner.js";
import { FilesScanRegistry } from "../src/files-scan-registry.js";
import type { ScanStore } from "../src/scan-store.js";
import { collect, makeSource } from "./test-helpers.js";

describe("ContentExtractorScanner", () => {
  let contentFiles: MemFilesApi;
  let storeFiles: MemFilesApi;
  let registry: FilesScanRegistry;
  let store: ScanStore;
  let extractors: ExtractorRegistry;

  beforeEach(async () => {
    contentFiles = new MemFilesApi();
    storeFiles = new MemFilesApi();
    registry = new FilesScanRegistry({ files: storeFiles, prefix: "scan" });
    store = await registry.createStore("content");

    extractors = new ExtractorRegistry();
    extractors.registerByPattern("*.md", async (content) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of content) chunks.push(chunk);
      return new TextDecoder().decode(Buffer.concat(chunks));
    });
    extractors.registerByPattern("*.txt", async (content) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of content) chunks.push(chunk);
      return new TextDecoder().decode(Buffer.concat(chunks));
    });
  });

  it("extracts content from changed files", async () => {
    await writeText(contentFiles, "/docs/readme.md", "# Hello World");

    const scanner = new ContentExtractorScanner(store, {
      files: contentFiles,
      extractors,
    });

    const source = makeSource([
      { uri: "/docs/readme.md", stamp: new Date("2026-04-01T00:00:00Z") },
    ]);

    const events = await collect(scanner.scan(source));
    const processed = events.filter((e) => e.type === "entry-processed");
    expect(processed).toHaveLength(1);

    const stored = await collect(store.list());
    expect(stored).toHaveLength(1);
    expect(stored[0]?.meta?.format).toBe("markdown");

    // Read extracted content
    const entry = stored[0];
    if (!entry?.content) throw new Error("expected content");
    const chunks = await collect(entry.content());
    const text = new TextDecoder().decode(chunks[0]);
    expect(text).toBe("# Hello World");
  });

  it("skips files without extractor", async () => {
    await writeText(contentFiles, "/data/file.bin", "binary data");

    const scanner = new ContentExtractorScanner(store, {
      files: contentFiles,
      extractors,
    });

    const source = makeSource([
      { uri: "/data/file.bin", stamp: new Date("2026-04-01T00:00:00Z") },
    ]);

    await collect(scanner.scan(source));

    const stored = await collect(store.list());
    expect(stored).toHaveLength(0);
  });

  it("handles removal cascade", async () => {
    await writeText(contentFiles, "/docs/readme.md", "# Hello");

    const scanner = new ContentExtractorScanner(store, {
      files: contentFiles,
      extractors,
    });

    // First extract content
    await collect(
      scanner.scan(
        makeSource([
          { uri: "/docs/readme.md", stamp: new Date("2026-04-01T00:00:00Z") },
        ]),
      ),
    );
    expect(await collect(store.list())).toHaveLength(1);

    // Then remove
    await collect(
      scanner.scan(
        makeSource([
          {
            uri: "/docs/readme.md",
            stamp: new Date("2026-04-02T00:00:00Z"),
            removed: new Date("2026-04-02T00:00:00Z"),
          },
        ]),
      ),
    );

    const stored = await collect(store.list());
    const removed = stored.filter((s) => s.removed);
    expect(removed).toHaveLength(1);
  });
});
