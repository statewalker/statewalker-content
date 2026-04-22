import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { decodeFloat32Arrays } from "@statewalker/webrun-msgpack";
import { collect as collectStream } from "@statewalker/webrun-streams";
import { beforeEach, describe, expect, it } from "vitest";
import { ContentEmbedderScanner } from "../src/content-embedder-scanner.js";
import { FilesScanRegistry } from "../src/files-scan-registry.js";
import type { ScanStore } from "../src/scan-store.js";
import type { UpdateSource } from "../src/scanner.js";
import { collect, makeChunksSource } from "./test-helpers.js";

/** Mock embed function that returns a fixed-size vector. */
async function mockEmbed(text: string): Promise<Float32Array> {
  const dim = 4;
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    arr[i] = (text.charCodeAt(i % text.length) || 0) / 256;
  }
  return arr;
}

describe("ContentEmbedderScanner", () => {
  let storeFiles: MemFilesApi;
  let registry: FilesScanRegistry;
  let store: ScanStore;

  beforeEach(async () => {
    storeFiles = new MemFilesApi();
    registry = new FilesScanRegistry({ files: storeFiles, prefix: "scan" });
    store = await registry.createStore("embeddings");
  });

  it("generates embeddings for chunks", async () => {
    const scanner = new ContentEmbedderScanner(store, {
      embed: mockEmbed,
      model: "test-model",
      dimensions: 4,
    });

    const source = makeChunksSource([
      {
        uri: "/doc.md",
        chunks: [
          { index: 0, content: "Hello world" },
          { index: 1, content: "Goodbye world" },
        ],
      },
    ]);

    await collect(scanner.scan(source));

    const stored = await collect(store.list());
    expect(stored).toHaveLength(1);
    expect(stored[0]?.meta?.model).toBe("test-model");
    expect(stored[0]?.meta?.dimensions).toBe(4);
    expect(stored[0]?.meta?.chunkCount).toBe(2);

    // Decode embeddings from stored content via Float32Array stream
    const entry = stored[0];
    if (!entry?.content) throw new Error("expected content");
    const embeddings = await collectStream(decodeFloat32Arrays(entry.content()));
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]?.length).toBe(4);
  });

  it("handles removal cascade", async () => {
    const scanner = new ContentEmbedderScanner(store, {
      embed: mockEmbed,
    });

    await collect(
      scanner.scan(
        makeChunksSource([{ uri: "/doc.md", chunks: [{ index: 0, content: "Hello" }] }]),
      ),
    );
    expect(await collect(store.list())).toHaveLength(1);

    const removeSource: UpdateSource = async function* () {
      yield {
        uri: "/doc.md",
        stamp: new Date("2026-04-02T00:00:00Z"),
        removed: new Date("2026-04-02T00:00:00Z"),
      };
    };
    await collect(scanner.scan(removeSource));

    const stored = await collect(store.list());
    expect(stored.filter((s) => s.removed)).toHaveLength(1);
  });

  it("skips entries without content", async () => {
    const scanner = new ContentEmbedderScanner(store, {
      embed: mockEmbed,
    });

    const source: UpdateSource = async function* () {
      yield { uri: "/no-content.md", stamp: new Date() };
    };
    await collect(scanner.scan(source));

    expect(await collect(store.list())).toHaveLength(0);
  });
});
