import { createDefaultRegistry } from "@statewalker/content-extractors/extractors";
import { createFlexSearchIndexer } from "@statewalker/indexer-mem-flexsearch";
import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { createDefaultStores, createPipeline } from "../src/pipeline.js";

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 2000, intervalMs = 10 } = {},
): Promise<void> => {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
};

describe("pipeline cascade", () => {
  it("propagates a new file through content, chunks, fts-receipt without an orchestrator", async () => {
    const files = new MemFilesApi();
    const indexer = createFlexSearchIndexer();
    const index = await indexer.createIndex({ name: "content", fulltext: { language: "en" } });
    const extractors = createDefaultRegistry();
    const stores = createDefaultStores({
      files,
      prefix: "/.state/content",
      withFtsIndex: true,
    });
    const pipeline = createPipeline({
      files,
      root: "/",
      filter: (p) => !p.startsWith("/.state/"),
      extractors,
      chunkOptions: { targetChars: 200 },
      ftsIndex: index,
      stores,
      pauseMs: 0,
    });

    await writeText(files, "/doc.md", "# Doc\n\nsome body text.");
    await pipeline.scanFiles();

    // scanFiles wrote to the files store; trackers are subscribed — wait for the
    // fts-receipt store to show the entry without us ever calling catchUpAll.
    await waitFor(async () => {
      const receipt = await stores.fts?.get("/doc.md");
      return !!receipt && !receipt.tombstone;
    });

    const content = await stores.content.get("/doc.md");
    expect(content?.meta?.text).toContain("Doc");
    const chunks = await stores.chunks.get("/doc.md");
    expect(chunks?.meta?.chunks.length ?? 0).toBeGreaterThan(0);

    await pipeline.close();
  });

  it("cascades tombstones through the pipeline and deletes docs from the FTS index", async () => {
    const files = new MemFilesApi();
    const indexer = createFlexSearchIndexer();
    const index = await indexer.createIndex({ name: "content", fulltext: { language: "en" } });
    const extractors = createDefaultRegistry();
    const stores = createDefaultStores({
      files,
      prefix: "/.state/content",
      withFtsIndex: true,
    });
    const pipeline = createPipeline({
      files,
      root: "/",
      filter: (p) => !p.startsWith("/.state/"),
      extractors,
      chunkOptions: { targetChars: 200 },
      ftsIndex: index,
      stores,
      pauseMs: 0,
    });

    await writeText(files, "/gone.md", "# Gone\n\nContent to be removed.");
    await pipeline.scanFiles();
    await pipeline.catchUpAll();

    const hitsBefore: unknown[] = [];
    for await (const r of index.search({ queries: ["Gone"], topK: 5 })) hitsBefore.push(r);
    expect(hitsBefore.length).toBeGreaterThan(0);

    await files.remove("/gone.md");
    await pipeline.scanFiles();
    await pipeline.catchUpAll();

    expect((await stores.content.get("/gone.md"))?.tombstone).toBe(true);
    expect((await stores.chunks.get("/gone.md"))?.tombstone).toBe(true);
    expect((await stores.fts?.get("/gone.md"))?.tombstone).toBe(true);

    const hitsAfter: unknown[] = [];
    for await (const r of index.search({ queries: ["Gone"], topK: 5 })) hitsAfter.push(r);
    expect(hitsAfter).toHaveLength(0);

    await pipeline.close();
  });

  it("rebuild-from-scratch: resetting the first tracker's cursor reprocesses every upstream entry", async () => {
    const files = new MemFilesApi();
    const indexer = createFlexSearchIndexer();
    const index = await indexer.createIndex({ name: "content", fulltext: { language: "en" } });
    const extractors = createDefaultRegistry();
    const stores = createDefaultStores({
      files,
      prefix: "/.state/content",
      withFtsIndex: true,
    });
    const pipeline = createPipeline({
      files,
      root: "/",
      filter: (p) => !p.startsWith("/.state/"),
      extractors,
      chunkOptions: { targetChars: 200 },
      ftsIndex: index,
      stores,
      pauseMs: 0,
    });

    await writeText(files, "/a.md", "# A\n\nbody A.");
    await writeText(files, "/b.md", "# B\n\nbody B.");
    await pipeline.scanFiles();
    await pipeline.catchUpAll();

    const extractCursorA = await stores.files.cursor("extract");
    expect(extractCursorA).toBeGreaterThan(0);

    // Reset every layer's cursor; catchUpAll should replay everything.
    await stores.files.advance("extract", 0);
    await stores.content.advance("split", 0);
    await stores.chunks.advance("fts", 0);
    await pipeline.catchUpAll();

    const extractCursorB = await stores.files.cursor("extract");
    expect(extractCursorB).toBe(extractCursorA);
    expect(await stores.content.get("/a.md")).toBeDefined();
    expect(await stores.content.get("/b.md")).toBeDefined();

    await pipeline.close();
  });

  it("embeddings round-trip through BlobStore(float32) and vecIndex with matching block IDs", async () => {
    const files = new MemFilesApi();
    const indexer = createFlexSearchIndexer();
    const index = await indexer.createIndex({
      name: "content",
      fulltext: { language: "en" },
      // The flexsearch impl may or may not support an embedding sub-index;
      // vecIndex only runs if we pass it as `vecIndex` below, so we keep both pointers.
    });
    const extractors = createDefaultRegistry();
    const stores = createDefaultStores({
      files,
      prefix: "/.state/content",
      withFtsIndex: true,
      withEmbeddings: true,
      withVecIndex: true,
    });

    const fakeEmbed = async (text: string): Promise<Float32Array> => {
      // Deterministic 4-dim hash so we can assert presence/order without cosine math.
      const vec = new Float32Array(4);
      for (let i = 0; i < text.length; i++) {
        const slot = i % 4;
        vec[slot] = (vec[slot] ?? 0) + text.charCodeAt(i);
      }
      return vec;
    };

    const pipeline = createPipeline({
      files,
      root: "/",
      filter: (p) => !p.startsWith("/.state/"),
      extractors,
      chunkOptions: { targetChars: 60 },
      ftsIndex: index,
      vecIndex: index,
      embed: fakeEmbed,
      stores,
      pauseMs: 0,
    });

    await writeText(files, "/doc.md", "alpha beta gamma delta epsilon zeta eta theta");
    await pipeline.scanFiles();
    await pipeline.catchUpAll();

    const vecsEntry = await stores.embeddings?.get("/doc.md");
    expect(vecsEntry?.meta?.vecs.length).toBeGreaterThan(0);
    expect(vecsEntry?.meta?.vecs[0]?.length).toBe(4);

    // Sanity: the vec-receipt store reflects the indexing step.
    const vecReceipt = await stores.vec?.get("/doc.md");
    expect(vecReceipt).toBeDefined();
    expect(vecReceipt?.tombstone).toBeUndefined();

    // Block-ID invariant (embed-transform produces the same count as split chunks).
    const chunks = await stores.chunks.get("/doc.md");
    const vecs = await stores.embeddings?.get("/doc.md");
    expect(vecs?.meta?.vecs.length).toBe(chunks?.meta?.chunks.length);

    await pipeline.close();
  });

  it("pacing: pauseMs yields to the event loop between batches", async () => {
    // Use the embed transform in isolation with a MemStore-like upstream to avoid
    // depending on the full pipeline just to time the sleep. Verify via a
    // side-effect that captures microtask-boundary crossings.
    let externalTicks = 0;
    const interval = setInterval(() => {
      externalTicks += 1;
    }, 5);
    try {
      const files = new MemFilesApi();
      const indexer = createFlexSearchIndexer();
      const index = await indexer.createIndex({ name: "content", fulltext: { language: "en" } });
      const extractors = createDefaultRegistry();
      const stores = createDefaultStores({
        files,
        prefix: "/.state/content",
        withFtsIndex: true,
      });
      const pipeline = createPipeline({
        files,
        root: "/",
        filter: (p) => !p.startsWith("/.state/"),
        extractors,
        chunkOptions: { targetChars: 200 },
        ftsIndex: index,
        stores,
        batchSize: 2,
        pauseMs: 20,
      });

      for (let i = 0; i < 6; i++) {
        await writeText(files, `/file-${i}.md`, `# File ${i}\n\nbody ${i}.`);
      }
      await pipeline.scanFiles();
      await pipeline.catchUpAll();

      // We wrote 6 files through two layers with batchSize=2 and pauseMs=20ms.
      // That's at least (6/2 - 1) = 2 pauses per layer × 3 heavy layers = 6×20ms = 120ms
      // of sleep — the 5ms-interval timer should have fired during that window.
      expect(externalTicks).toBeGreaterThan(2);

      await pipeline.close();
    } finally {
      clearInterval(interval);
    }
  });
});
