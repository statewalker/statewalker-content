import { createFlexSearchIndexer } from "@repo/indexer-mem-flexsearch";
import { describe, expect, it } from "vitest";
import { createContentManager } from "../src/content-manager.js";
import type { ContentStorage } from "../src/types.js";

function createMemoryStorage(): ContentStorage {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, content: string) {
      store.set(key, content);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async *list() {
      for (const key of store.keys()) {
        yield key;
      }
    },
  };
}

describe("content-manager", () => {
  it("should store and retrieve a document by URI", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    const doc = await manager.setRawContent({
      uri: "file:///test.md",
      content:
        "# Hello\n\nThis is a test document.\n\n# World\n\nAnother section.",
    });

    expect(doc.uri).toBe("file:///test.md");
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(typeof doc.documentId).toBe("string");

    const retrieved = await manager.getDocumentByUri("file:///test.md");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.documentId).toBe(doc.documentId);
    expect(retrieved?.blocks.length).toBe(doc.blocks.length);

    await manager.close();
  });

  it("should store and retrieve a document by documentId", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    const doc = await manager.setRawContent({
      uri: "file:///test.md",
      content: "# Title\n\nContent here.",
    });

    const retrieved = await manager.getDocumentById(doc.documentId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.uri).toBe("file:///test.md");

    await manager.close();
  });

  it("should assign string block IDs with documentId prefix", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    const doc = await manager.setRawContent({
      uri: "file:///multi.md",
      content:
        "# First\n\nFirst block.\n\n# Second\n\nSecond block.\n\n# Third\n\nThird block.",
    });

    expect(doc.blocks.length).toBe(3);
    for (let i = 0; i < doc.blocks.length; i++) {
      const block = doc.blocks[i];
      expect(block).toBeDefined();
      expect(block?.blockId).toContain(":");
      expect(block?.blockId.endsWith(`:${i}`)).toBe(true);
      expect(block?.documentId).toBe(doc.documentId);
    }

    await manager.close();
  });

  it("should retrieve a block by blockId", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    const doc = await manager.setRawContent({
      uri: "file:///blocks.md",
      content: "# Alpha\n\nAlpha content.\n\n# Beta\n\nBeta content.",
    });

    const secondBlock = doc.blocks[1];
    expect(secondBlock).toBeDefined();
    const block = await manager.getBlockById(secondBlock?.blockId ?? "");
    expect(block).not.toBeNull();
    expect(block?.title).toBe("Beta");
    expect(block?.content).toContain("Beta content");

    await manager.close();
  });

  it("should search and find matching blocks", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    await manager.setRawContent({
      uri: "file:///animals.md",
      content:
        "# Cats\n\nCats are furry animals that purr.\n\n# Dogs\n\nDogs are loyal companions that bark.",
    });

    await manager.setRawContent({
      uri: "file:///plants.md",
      content:
        "# Roses\n\nRoses are red flowers.\n\n# Tulips\n\nTulips bloom in spring.",
    });

    const hits = await manager.search({ queries: ["cats furry"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.uri).toBe("file:///animals.md");

    await manager.close();
  });

  it("should remove content and no longer find it", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    await manager.setRawContent({
      uri: "file:///ephemeral.md",
      content:
        "# Temporary\n\nThis content is ephemeral and should be removed.",
    });

    const before = await manager.getDocumentByUri("file:///ephemeral.md");
    expect(before).not.toBeNull();

    await manager.removeContent("file:///ephemeral.md");

    const after = await manager.getDocumentByUri("file:///ephemeral.md");
    expect(after).toBeNull();

    const hits = await manager.search({ queries: ["ephemeral"] });
    expect(hits).toEqual([]);

    await manager.close();
  });

  it("should handle re-indexing the same URI", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    const doc1 = await manager.setRawContent({
      uri: "file:///mutable.md",
      content: "# Version 1\n\nOriginal content.",
    });

    const doc2 = await manager.setRawContent({
      uri: "file:///mutable.md",
      content: "# Version 2\n\nUpdated content.\n\n# Extra\n\nMore stuff.",
    });

    // Same URI produces same hash-based documentId
    expect(doc2.documentId).toBe(doc1.documentId);
    expect(doc2.blocks.length).toBe(2);

    // New doc should be retrievable
    const newDoc = await manager.getDocumentByUri("file:///mutable.md");
    expect(newDoc).not.toBeNull();
    expect(newDoc?.documentId).toBe(doc2.documentId);

    await manager.close();
  });

  it("should handle multiple documents with distinct documentIds", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    const doc1 = await manager.setRawContent({
      uri: "file:///a.md",
      content: "# A\n\nDocument A.",
    });
    const doc2 = await manager.setRawContent({
      uri: "file:///b.md",
      content: "# B\n\nDocument B.",
    });
    const doc3 = await manager.setRawContent({
      uri: "file:///c.md",
      content: "# C\n\nDocument C.",
    });

    expect(doc1.documentId).not.toBe(doc2.documentId);
    expect(doc2.documentId).not.toBe(doc3.documentId);

    // All retrievable
    expect(await manager.getDocumentById(doc1.documentId)).not.toBeNull();
    expect(await manager.getDocumentById(doc2.documentId)).not.toBeNull();
    expect(await manager.getDocumentById(doc3.documentId)).not.toBeNull();

    await manager.close();
  });

  it("should return null for nonexistent document/block", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    expect(await manager.getDocumentById("nonexistent")).toBeNull();
    expect(await manager.getDocumentByUri("file:///nope.md")).toBeNull();
    expect(await manager.getBlockById("nonexistent:0")).toBeNull();

    await manager.close();
  });

  it("should return empty results for search with no content", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({ indexer, storage });

    const hits = await manager.search({ queries: ["anything"] });
    expect(hits).toEqual([]);

    await manager.close();
  });

  it("should use normalize function when provided", async () => {
    const indexer = createFlexSearchIndexer();
    const storage = createMemoryStorage();
    const manager = createContentManager({
      indexer,
      storage,
      normalize: async (content: string) => content.toUpperCase(),
    });

    const doc = await manager.setRawContent({
      uri: "file:///norm.md",
      content: "# hello\n\nworld",
    });

    expect(doc.blocks.length).toBeGreaterThan(0);
    const allContent = doc.blocks.map((b) => b.content).join(" ");
    expect(allContent).toContain("WORLD");

    await manager.close();
  });

  it("should persist and restore documents across ContentManager instances", async () => {
    const storage = createMemoryStorage();

    // First instance: store documents
    const indexer1 = createFlexSearchIndexer();
    const manager1 = createContentManager({ indexer: indexer1, storage });

    const doc = await manager1.setRawContent({
      uri: "file:///persist.md",
      content: "# Persistent\n\nThis survives restart.",
    });
    expect(doc.blocks.length).toBeGreaterThan(0);
    await manager1.close();

    // Second instance: same storage, fresh indexer
    const indexer2 = createFlexSearchIndexer();
    const manager2 = createContentManager({ indexer: indexer2, storage });

    // Document should be loadable from storage
    const restored = await manager2.getDocumentByUri("file:///persist.md");
    expect(restored).not.toBeNull();
    expect(restored?.uri).toBe("file:///persist.md");
    expect(restored?.blocks.length).toBe(doc.blocks.length);

    // Block lookup should work
    const firstBlock = doc.blocks[0];
    expect(firstBlock).toBeDefined();
    const block = await manager2.getBlockById(firstBlock?.blockId ?? "");
    expect(block).not.toBeNull();
    expect(block?.title).toBe("Persistent");

    await manager2.close();
  });
});
