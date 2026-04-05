import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { FilesScanRegistry } from "../src/files-scan-registry.js";
import { FilesScanner } from "../src/files-scanner.js";
import type { ScanStore } from "../src/scan-store.js";
import type { ScannerEvent } from "../src/scanner.js";
import { collect } from "./test-helpers.js";

describe("FilesScanner", () => {
  let contentFiles: MemFilesApi;
  let storeFiles: MemFilesApi;
  let registry: FilesScanRegistry;
  let store: ScanStore;

  beforeEach(async () => {
    contentFiles = new MemFilesApi();
    storeFiles = new MemFilesApi();
    registry = new FilesScanRegistry({ files: storeFiles, prefix: "scan" });
    store = await registry.createStore("files");

    // Create some test files
    await writeText(contentFiles, "/project/readme.md", "# Hello");
    await writeText(contentFiles, "/project/src/index.ts", "export {}");
    await writeText(contentFiles, "/project/.git/config", "gitconfig");
  });

  it("detects new files on first scan", async () => {
    const scanner = new FilesScanner(store, {
      files: contentFiles,
      root: "/project",
      filter: (p) => !p.includes("/.git/"),
    });

    const events = await collect(scanner.scan());
    const processed = events.filter(
      (e): e is Extract<ScannerEvent, { type: "entry-processed" }> =>
        e.type === "entry-processed",
    );
    expect(processed).toHaveLength(2);

    const stored = await collect(store.list());
    expect(stored).toHaveLength(2);
    const uris = stored.map((s) => s.uri).sort();
    expect(uris.some((u) => u.includes("readme.md"))).toBe(true);
    expect(uris.some((u) => u.includes("index.ts"))).toBe(true);
  });

  it("detects file modifications on re-scan", async () => {
    const scanner = new FilesScanner(store, {
      files: contentFiles,
      root: "/project",
      filter: (p) => !p.includes("/.git/"),
    });

    // First scan
    await collect(scanner.scan());

    // Modify a file
    await writeText(contentFiles, "/project/readme.md", "# Updated");

    // Second scan
    await collect(scanner.scan());

    const stored = await collect(store.list());
    expect(stored).toHaveLength(2);
  });

  it("detects file removal", async () => {
    const scanner = new FilesScanner(store, {
      files: contentFiles,
      root: "/project",
      filter: (p) => !p.includes("/.git/"),
    });

    // First scan
    await collect(scanner.scan());
    expect(await collect(store.list())).toHaveLength(2);

    // Remove a file
    await contentFiles.remove("/project/readme.md");

    // Second scan
    await collect(scanner.scan());

    const stored = await collect(store.list());
    const removed = stored.filter((s) => s.removed);
    expect(removed).toHaveLength(1);
    expect(removed.some((r) => r.uri.includes("readme.md"))).toBe(true);
  });

  it("respects filter function", async () => {
    const scanner = new FilesScanner(store, {
      files: contentFiles,
      root: "/project",
      filter: (p) => p.endsWith(".ts"),
    });

    await collect(scanner.scan());

    const stored = await collect(store.list());
    expect(stored).toHaveLength(1);
    expect(stored.some((s) => s.uri.includes("index.ts"))).toBe(true);
  });

  it("stores file metadata (size, lastModified, hash)", async () => {
    const scanner = new FilesScanner(store, {
      files: contentFiles,
      root: "/project",
      filter: (p) => p.includes("readme.md"),
    });

    await collect(scanner.scan());

    const stored = await collect(store.list());
    expect(stored).toHaveLength(1);
    const meta = stored[0]?.meta;
    expect(meta).toBeDefined();
    expect(typeof meta?.size).toBe("number");
    expect(typeof meta?.hash).toBe("string");
    expect((meta?.hash as string).length).toBeGreaterThan(0);
  });

  it("skipHash mode detects changes by size/mtime only", async () => {
    const scanner = new FilesScanner(store, {
      files: contentFiles,
      root: "/project",
      filter: (p) => p.includes("readme.md"),
      skipHash: true,
    });

    await collect(scanner.scan());

    const stored = await collect(store.list());
    expect(stored).toHaveLength(1);
    expect(stored[0]?.meta?.hash).toBe("");
  });
});
