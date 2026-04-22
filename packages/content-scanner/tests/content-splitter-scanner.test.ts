import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { decodeMsgpack } from "@statewalker/webrun-msgpack";
import { collect as collectStream } from "@statewalker/webrun-streams";
import { beforeEach, describe, expect, it } from "vitest";
import { ContentSplitterScanner } from "../src/content-splitter-scanner.js";
import { FilesScanRegistry } from "../src/files-scan-registry.js";
import type { ScanStore } from "../src/scan-store.js";
import type { UpdateSource } from "../src/scanner.js";
import { collect, makeContentSource } from "./test-helpers.js";

describe("ContentSplitterScanner", () => {
  let storeFiles: MemFilesApi;
  let registry: FilesScanRegistry;
  let store: ScanStore;

  beforeEach(async () => {
    storeFiles = new MemFilesApi();
    registry = new FilesScanRegistry({ files: storeFiles, prefix: "scan" });
    store = await registry.createStore("chunks");
  });

  it("splits content into chunks", async () => {
    const longText = `# Title\n\n${"Some content paragraph. ".repeat(200)}`;
    const scanner = new ContentSplitterScanner(store, {
      chunkOptions: { targetChars: 500 },
    });

    const source = makeContentSource([{ uri: "/doc.md", text: longText }]);
    await collect(scanner.scan(source));

    const stored = await collect(store.list());
    expect(stored).toHaveLength(1);
    const entry = stored[0];
    expect(entry?.meta?.chunkCount).toBeGreaterThan(1);
    expect(entry?.meta?.targetChars).toBe(500);

    // Verify chunks are serialized as msgpack stream
    if (!entry?.content) throw new Error("expected content");
    const chunks = await collectStream(
      decodeMsgpack<{ index: number; content: string }>(entry.content()),
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.index).toBe(0);
    expect(typeof chunks[0]?.content).toBe("string");
  });

  it("respects configurable chunk options", async () => {
    const text = "Word ".repeat(1000);
    const scanner = new ContentSplitterScanner(store, {
      chunkOptions: { targetChars: 200 },
    });

    const source = makeContentSource([{ uri: "/doc.md", text }]);
    await collect(scanner.scan(source));

    const stored = await collect(store.list());
    expect(stored[0]?.meta?.targetChars).toBe(200);
  });

  it("handles removal cascade", async () => {
    const scanner = new ContentSplitterScanner(store, {
      chunkOptions: { targetChars: 500 },
    });

    // First split content
    const text = `# Hello\n\n${"Content. ".repeat(100)}`;
    await collect(scanner.scan(makeContentSource([{ uri: "/doc.md", text }])));
    expect(await collect(store.list())).toHaveLength(1);

    // Then remove
    const removeSource: UpdateSource = async function* () {
      yield {
        uri: "/doc.md",
        stamp: new Date("2026-04-02T00:00:00Z"),
        removed: new Date("2026-04-02T00:00:00Z"),
      };
    };
    await collect(scanner.scan(removeSource));

    const stored = await collect(store.list());
    const removed = stored.filter((s) => s.removed);
    expect(removed).toHaveLength(1);
  });

  it("skips entries without content", async () => {
    const scanner = new ContentSplitterScanner(store, {
      chunkOptions: { targetChars: 500 },
    });

    const source: UpdateSource = async function* () {
      yield { uri: "/no-content.md", stamp: new Date() };
    };
    await collect(scanner.scan(source));

    expect(await collect(store.list())).toHaveLength(0);
  });
});
