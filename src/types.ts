import type { ContentDocument } from "@repo/content-blocks";
import type { EmbedFn, Indexer } from "@repo/indexer-api";

export interface StoredBlock {
  blockId: string;
  documentId: string;
  uri: string;
  title?: string;
  content: string;
}

export interface StoredDocument {
  documentId: string;
  uri: string;
  blocks: StoredBlock[];
  raw: ContentDocument;
}

export interface SearchHit {
  blockId: string;
  documentId: string;
  uri: string;
  title?: string;
  content: string;
  score: number;
}

export interface ContentStorage {
  get(key: string): Promise<string | null>;
  set(key: string, content: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): AsyncIterable<string>;
}

export interface ContentManagerOptions {
  indexer: Indexer;
  storage: ContentStorage;
  normalize?: (content: string) => Promise<string>;
  embed?: EmbedFn;
  embeddingDimensions?: number;
}

export interface ContentManager {
  setRawContent(params: {
    uri: string;
    content: string;
  }): Promise<StoredDocument>;
  removeContent(uri: string): Promise<void>;
  getDocumentById(documentId: string): Promise<StoredDocument | null>;
  getDocumentByUri(uri: string): Promise<StoredDocument | null>;
  getBlockById(blockId: string): Promise<StoredBlock | null>;
  search(query: string, options?: { topK?: number }): Promise<SearchHit[]>;
  close(): Promise<void>;
}
