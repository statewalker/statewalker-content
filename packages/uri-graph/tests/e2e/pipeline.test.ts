import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newNodeTursoDb } from "@statewalker/db-turso-node";
import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { afterEach, describe, expect, it } from "vitest";
import { createOrchestrator } from "../../src/orchestrator/orchestrator.js";
import { createInMemoryPersistence } from "../../src/store/memory/files-persistence.js";
import { MemoryGraphStore } from "../../src/store/memory/store.js";
import { SqlGraphStore } from "../../src/store/sql/store.js";
import type { GraphStore } from "../../src/store/types.js";
import { openGraphStore } from "../../src/store/types.js";
import { createChunker } from "../../src/workers/chunker.js";
import { createEmbedder } from "../../src/workers/embedder.js";
import { createMarkdownExtractor } from "../../src/workers/extractors/markdown-extractor.js";
import { createFileWatcher } from "../../src/workers/file-watcher.js";
import { createMemoryFtsBackend } from "../../src/workers/index-backends/memory-fts.js";
import { createMemoryVectorBackend } from "../../src/workers/index-backends/memory-vector.js";
import { createIndexer } from "../../src/workers/indexer.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
});

interface E2EHarness {
  store: GraphStore;
  files: MemFilesApi;
  fts: ReturnType<typeof createMemoryFtsBackend>;
  vector: ReturnType<typeof createMemoryVectorBackend>;
  cleanup: () => Promise<void>;
}

async function makeMemoryHarness(): Promise<E2EHarness> {
  const files = new MemFilesApi();
  const store = await openGraphStore(new MemoryGraphStore(createInMemoryPersistence("graph")));
  return {
    store,
    files,
    fts: createMemoryFtsBackend(),
    vector: createMemoryVectorBackend(),
    async cleanup() {
      await (store as unknown as { close(): Promise<void> }).close();
    },
  };
}

async function makeSqlHarness(): Promise<E2EHarness> {
  const dir = mkdtempSync(join(tmpdir(), "uri-graph-e2e-"));
  tmpDirs.push(dir);
  const db = await newNodeTursoDb({ path: join(dir, "graph.db") });
  const store = await openGraphStore(new SqlGraphStore({ db }));
  return {
    store,
    files: new MemFilesApi(),
    fts: createMemoryFtsBackend(),
    vector: createMemoryVectorBackend(),
    async cleanup() {
      await db.close();
    },
  };
}

async function runToFixpoint(
  store: GraphStore,
  files: MemFilesApi,
  fts: ReturnType<typeof createMemoryFtsBackend>,
  vector: ReturnType<typeof createMemoryVectorBackend>,
  maxRounds = 30,
): Promise<void> {
  const orch = createOrchestrator({ graph: store, pollMs: 5 });
  await orch.registerWorker(createFileWatcher({ files, rootPath: "/" }));
  await orch.registerWorker(createMarkdownExtractor({ files, graph: store }));
  await orch.registerWorker(createChunker({ chunkSize: 5, graph: store }));
  await orch.registerWorker(
    createEmbedder({
      graph: store,
      embed: async (text: string) => new Float32Array([text.length, text.charCodeAt(0) || 0]),
    }),
  );
  await orch.registerWorker(createIndexer({ graph: store, fts, vector }));

  const ac = new AbortController();
  const startPromise = orch.start(ac.signal);

  // Poll until any indexer outputs exist or timeout.
  for (let i = 0; i < maxRounds * 10; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const seen: string[] = [];
    for await (const v of store.find("index://%")) seen.push(v.uri);
    if (seen.length >= 2) break;
  }
  ac.abort();
  await startPromise;
}

async function indexUris(store: GraphStore): Promise<string[]> {
  const out: string[] = [];
  for await (const v of store.find("index://%")) {
    if (v.status !== "removed") out.push(v.uri);
  }
  return out.sort();
}

describe("E2E pipeline (memory store)", () => {
  it("two markdown files → fts + vector indexes built", async () => {
    const h = await makeMemoryHarness();
    try {
      await writeText(h.files, "/a.md", "hello world");
      await writeText(h.files, "/b.md", "another doc");
      await runToFixpoint(h.store, h.files, h.fts, h.vector);
      const indexes = await indexUris(h.store);
      expect(indexes).toContain("index://fts/text:///a.md");
      expect(indexes).toContain("index://fts/text:///b.md");
      expect(indexes).toContain("index://vector/text:///a.md");
      expect(indexes).toContain("index://vector/text:///b.md");
      expect(h.fts.query("hello").map((x) => x.scope)).toContain("text:///a.md");
    } finally {
      await h.cleanup();
    }
  }, 30000);

  it("non-markdown files do not produce indexes", async () => {
    const h = await makeMemoryHarness();
    try {
      await writeText(h.files, "/c.png", "binary-ish");
      await runToFixpoint(h.store, h.files, h.fts, h.vector, 5);
      const indexes = await indexUris(h.store);
      expect(indexes).toEqual([]);
    } finally {
      await h.cleanup();
    }
  }, 15000);
});

describe("E2E pipeline (sql store)", () => {
  it("two markdown files → fts + vector indexes built", async () => {
    const h = await makeSqlHarness();
    try {
      await writeText(h.files, "/a.md", "hello world");
      await writeText(h.files, "/b.md", "another doc");
      await runToFixpoint(h.store, h.files, h.fts, h.vector);
      const indexes = await indexUris(h.store);
      expect(indexes).toContain("index://fts/text:///a.md");
      expect(indexes).toContain("index://fts/text:///b.md");
      expect(indexes).toContain("index://vector/text:///a.md");
      expect(indexes).toContain("index://vector/text:///b.md");
    } finally {
      await h.cleanup();
    }
  }, 30000);
});
