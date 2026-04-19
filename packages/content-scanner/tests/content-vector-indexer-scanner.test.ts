import type { DocumentPath, Index, IndexedBlock, PathSelector } from "@statewalker/indexer-api";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { ContentVectorIndexerScanner } from "../src/content-vector-indexer-scanner.js";
import { FilesScanRegistry } from "../src/files-scan-registry.js";
import type { ScanStore } from "../src/scan-store.js";
import type { UpdateSource } from "../src/scanner.js";
import { collect, makeEmbeddingsSource } from "./test-helpers.js";

function createMockIndex() {
  const documents = new Map<string, IndexedBlock[]>();
  const index: Partial<Index> = {
    async addDocument(blocks: IndexedBlock[]) {
      if (blocks.length === 0) return;
      const path = blocks[0]?.path;
      if (path) documents.set(path, blocks);
    },
    async deleteDocuments(selectors: PathSelector[] | AsyncIterable<PathSelector>) {
      const sels = Array.isArray(selectors) ? selectors : await collect(selectors);
      for (const sel of sels) {
        documents.delete(sel.path);
      }
    },
  };
  return { index: index as Index, documents };
}

describe("ContentVectorIndexerScanner", () => {
  let storeFiles: MemFilesApi;
  let registry: FilesScanRegistry;
  let store: ScanStore;

  beforeEach(async () => {
    storeFiles = new MemFilesApi();
    registry = new FilesScanRegistry({ files: storeFiles, prefix: "scan" });
    store = await registry.createStore("vec-index");
  });

  it("indexes embeddings into the Index", async () => {
    const { index, documents } = createMockIndex();
    const scanner = new ContentVectorIndexerScanner(store, { index });

    const emb1 = new Float32Array([0.1, 0.2, 0.3]);
    const emb2 = new Float32Array([0.4, 0.5, 0.6]);

    await collect(
      scanner.scan(makeEmbeddingsSource([{ uri: "/docs/readme.md", embeddings: [emb1, emb2] }])),
    );

    expect(documents.size).toBe(1);
    const blocks = documents.get("/docs/readme.md" as DocumentPath);
    expect(blocks).toHaveLength(2);
    expect(blocks?.[0]?.embedding).toBeDefined();
    expect(blocks?.[0]?.embedding?.length).toBe(3);
  });

  it("removes documents from Index on cascade removal", async () => {
    const { index, documents } = createMockIndex();
    const scanner = new ContentVectorIndexerScanner(store, { index });

    const emb = new Float32Array([0.1, 0.2]);
    await collect(
      scanner.scan(makeEmbeddingsSource([{ uri: "/docs/readme.md", embeddings: [emb] }])),
    );
    expect(documents.size).toBe(1);

    const removeSource: UpdateSource = async function* () {
      yield {
        uri: "/docs/readme.md",
        stamp: new Date("2026-04-02T00:00:00Z"),
        removed: new Date("2026-04-02T00:00:00Z"),
      };
    };
    await collect(scanner.scan(removeSource));
    expect(documents.size).toBe(0);
  });

  it("uses same block ID pattern as FTS indexer", async () => {
    const { index, documents } = createMockIndex();
    const scanner = new ContentVectorIndexerScanner(store, { index });

    const emb1 = new Float32Array([0.1]);
    const emb2 = new Float32Array([0.2]);
    const emb3 = new Float32Array([0.3]);

    await collect(
      scanner.scan(
        makeEmbeddingsSource([{ uri: "/docs/readme.md", embeddings: [emb1, emb2, emb3] }]),
      ),
    );

    const blocks = documents.get("/docs/readme.md" as DocumentPath);
    expect(blocks?.map((b) => b.blockId)).toEqual([
      "/docs/readme.md:0",
      "/docs/readme.md:1",
      "/docs/readme.md:2",
    ]);
  });
});
