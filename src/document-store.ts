import type { ContentBlock, ContentDocument } from "@repo/content-blocks";
import type { ContentStorage, StoredBlock, StoredDocument } from "./types.js";

/** Flatten a ContentDocument tree into a list of {title, content} pairs. */
function flattenBlocks(
  doc: ContentDocument,
): Array<{ title?: string; content: string }> {
  const result: Array<{ title?: string; content: string }> = [];

  function walkBlock(block: ContentBlock): void {
    if (block.content.trim() || block.title) {
      result.push({ title: block.title, content: block.content });
    }
    if (block.children) {
      for (const child of block.children) {
        walkBlock(child);
      }
    }
  }

  for (const section of doc.content) {
    for (const block of section.blocks) {
      walkBlock(block);
    }
  }

  return result;
}

/** Simple hash of a string to produce a deterministic document ID */
function hashUri(uri: string): string {
  let hash = 0;
  for (let i = 0; i < uri.length; i++) {
    const ch = uri.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(36);
}

function makeBlockId(documentId: string, blockPos: number): string {
  return `${documentId}:${blockPos}`;
}

function parseBlockId(
  blockId: string,
): { documentId: string; blockPos: number } | null {
  const sep = blockId.lastIndexOf(":");
  if (sep === -1) return null;
  const documentId = blockId.slice(0, sep);
  const blockPos = Number.parseInt(blockId.slice(sep + 1), 10);
  if (Number.isNaN(blockPos)) return null;
  return { documentId, blockPos };
}

/** Metadata index persisted to storage */
interface IndexData {
  entries: Array<{ uri: string; documentId: string }>;
}

const INDEX_KEY = "__index__";

export class DocumentStore {
  private uriToDocId = new Map<string, string>();
  private documents = new Map<string, StoredDocument>();
  private readonly storage: ContentStorage;
  private loaded = false;

  constructor(storage: ContentStorage) {
    this.storage = storage;
  }

  /** Load index from storage. Must be called before any read/write operations. */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const indexJson = await this.storage.get(INDEX_KEY);
    if (!indexJson) return;

    const data = JSON.parse(indexJson) as IndexData;

    for (const entry of data.entries) {
      this.uriToDocId.set(entry.uri, entry.documentId);

      // Load document content from storage
      const docJson = await this.storage.get(`doc:${entry.documentId}`);
      if (docJson) {
        const raw = JSON.parse(docJson) as ContentDocument;
        const flatBlocks = flattenBlocks(raw);
        const storedBlocks: StoredBlock[] = flatBlocks.map((b, i) => ({
          blockId: makeBlockId(entry.documentId, i),
          documentId: entry.documentId,
          uri: entry.uri,
          title: b.title,
          content: b.content,
        }));
        this.documents.set(entry.documentId, {
          documentId: entry.documentId,
          uri: entry.uri,
          blocks: storedBlocks,
          raw,
        });
      }
    }
  }

  /** Save index to storage */
  private async saveIndex(): Promise<void> {
    const entries: Array<{ uri: string; documentId: string }> = [];
    for (const [uri, documentId] of this.uriToDocId) {
      entries.push({ uri, documentId });
    }
    const data: IndexData = { entries };
    await this.storage.set(INDEX_KEY, JSON.stringify(data));
  }

  async store(uri: string, doc: ContentDocument): Promise<StoredDocument> {
    await this.load();

    // Remove old entry if URI already stored
    const oldDocId = this.uriToDocId.get(uri);
    if (oldDocId !== undefined) {
      await this.removeByUri(uri);
    }

    const documentId = hashUri(uri);

    // Handle hash collision: if a different URI already uses this documentId, append a suffix
    let finalDocId = documentId;
    if (this.documents.has(documentId)) {
      let suffix = 1;
      while (this.documents.has(`${documentId}_${suffix}`)) {
        suffix++;
      }
      finalDocId = `${documentId}_${suffix}`;
    }

    this.uriToDocId.set(uri, finalDocId);

    const flatBlocks = flattenBlocks(doc);
    const storedBlocks: StoredBlock[] = flatBlocks.map((b, i) => ({
      blockId: makeBlockId(finalDocId, i),
      documentId: finalDocId,
      uri,
      title: b.title,
      content: b.content,
    }));

    const stored: StoredDocument = {
      documentId: finalDocId,
      uri,
      blocks: storedBlocks,
      raw: doc,
    };
    this.documents.set(finalDocId, stored);

    // Persist document content and index
    await this.storage.set(`doc:${finalDocId}`, JSON.stringify(doc));
    await this.saveIndex();

    return stored;
  }

  async remove(uri: string): Promise<string[]> {
    await this.load();
    return this.removeByUri(uri);
  }

  private async removeByUri(uri: string): Promise<string[]> {
    const documentId = this.uriToDocId.get(uri);
    if (documentId === undefined) return [];

    const doc = this.documents.get(documentId);
    const blockIds = doc ? doc.blocks.map((b) => b.blockId) : [];

    this.uriToDocId.delete(uri);
    this.documents.delete(documentId);

    // Remove from storage
    await this.storage.delete(`doc:${documentId}`);
    await this.saveIndex();

    return blockIds;
  }

  async getById(documentId: string): Promise<StoredDocument | null> {
    await this.load();
    return this.documents.get(documentId) ?? null;
  }

  async getByUri(uri: string): Promise<StoredDocument | null> {
    await this.load();
    const documentId = this.uriToDocId.get(uri);
    if (documentId === undefined) return null;
    return this.documents.get(documentId) ?? null;
  }

  async getBlock(blockId: string): Promise<StoredBlock | null> {
    await this.load();
    const parsed = parseBlockId(blockId);
    if (!parsed) return null;

    const doc = this.documents.get(parsed.documentId);
    if (!doc) return null;

    return doc.blocks[parsed.blockPos] ?? null;
  }

  async *listUris(): AsyncGenerator<{ uri: string; documentId: string }> {
    await this.load();
    for (const [uri, documentId] of this.uriToDocId) {
      yield { uri, documentId };
    }
  }
}
