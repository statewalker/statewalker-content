import type {
  DocumentPath,
  Index,
  IndexedBlock,
  PathSelector,
} from "@repo/indexer-api";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { ContentFtsIndexerScanner } from "../src/content-fts-indexer-scanner.js";
import { FilesScanRegistry } from "../src/files-scan-registry.js";
import type { ScanStore } from "../src/scan-store.js";
import type { UpdateSource } from "../src/scanner.js";
import { collect, makeChunksSource } from "./test-helpers.js";

/** Minimal mock Index that records addDocument/deleteDocuments calls. */
function createMockIndex() {
  const documents = new Map<string, IndexedBlock[]>();
  const index: Partial<Index> = {
    async addDocument(blocks: IndexedBlock[]) {
      if (blocks.length === 0) return;
      const path = blocks[0]?.path;
      if (path) documents.set(path, blocks);
    },
    async deleteDocuments(
      selectors: PathSelector[] | AsyncIterable<PathSelector>,
    ) {
      const sels = Array.isArray(selectors)
        ? selectors
        : await collect(selectors);
      for (const sel of sels) {
        documents.delete(sel.path);
      }
    },
  };
  return { index: index as Index, documents };
}

describe("ContentFtsIndexerScanner", () => {
  let storeFiles: MemFilesApi;
  let registry: FilesScanRegistry;
  let store: ScanStore;

  beforeEach(async () => {
    storeFiles = new MemFilesApi();
    registry = new FilesScanRegistry({ files: storeFiles, prefix: "scan" });
    store = await registry.createStore("fts-index");
  });

  it("indexes chunks into the Index", async () => {
    const { index, documents } = createMockIndex();
    const scanner = new ContentFtsIndexerScanner(store, { index });

    const source = makeChunksSource([
      {
        uri: "/docs/readme.md",
        chunks: [
          { index: 0, content: "Hello" },
          { index: 1, content: "World" },
        ],
      },
    ]);

    await collect(scanner.scan(source));

    expect(documents.size).toBe(1);
    const blocks = documents.get("/docs/readme.md" as DocumentPath);
    expect(blocks).toHaveLength(2);
    expect(blocks?.[0]?.blockId).toBe("/docs/readme.md:0");
    expect(blocks?.[1]?.blockId).toBe("/docs/readme.md:1");
    expect(blocks?.[0]?.content).toBe("Hello");

    // Store tracks the indexed URI
    const stored = await collect(store.list());
    expect(stored).toHaveLength(1);
  });

  it("removes documents from Index on cascade removal", async () => {
    const { index, documents } = createMockIndex();
    const scanner = new ContentFtsIndexerScanner(store, { index });

    // First index
    await collect(
      scanner.scan(
        makeChunksSource([
          { uri: "/docs/readme.md", chunks: [{ index: 0, content: "Hello" }] },
        ]),
      ),
    );
    expect(documents.size).toBe(1);

    // Then remove
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

  it("generates consistent block IDs", async () => {
    const { index, documents } = createMockIndex();
    const scanner = new ContentFtsIndexerScanner(store, { index });

    await collect(
      scanner.scan(
        makeChunksSource([
          {
            uri: "/docs/readme.md",
            chunks: [
              { index: 0, content: "A" },
              { index: 1, content: "B" },
              { index: 2, content: "C" },
            ],
          },
        ]),
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
