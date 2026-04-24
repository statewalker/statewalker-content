/**
 * A tracked item in a layer's store. Every layer parameterises the meta type;
 * tombstones carry no meta.
 */
export type Entry<M = Record<string, unknown>> = {
  uri: string;
  stamp: number;
  tombstone?: true;
  meta?: M;
};

/** A transform pulls upstream entries and returns downstream entries sans stamp. */
export type Transform<U extends Entry, D extends Entry> = (
  upstream: U,
) => Promise<Omit<D, "stamp"> | null>;

/** Files-tracker meta: what `scanFiles` records per URI. */
export type FileMeta = {
  size: number;
  mtime: number;
  hash: string;
};

/** Extract-tracker meta: text payload + detected format. */
export type ContentMeta = {
  text: string;
  format: string;
};

/** A single chunk produced by `split`. */
export type Chunk = {
  i: number;
  text: string;
};

/** Split-tracker meta: an ordered list of chunks. */
export type ChunksMeta = {
  chunks: Chunk[];
};

/** Embed-tracker meta: one embedding per chunk, same order as the chunks list. */
export type VecsMeta = {
  vecs: Float32Array[];
};

/** FTS/vec indexer receipt meta: intentionally empty. */
export type Receipt = Record<string, never>;

export type FileEntry = Entry<FileMeta>;
export type ContentEntry = Entry<ContentMeta>;
export type ChunksEntry = Entry<ChunksMeta>;
export type VecsEntry = Entry<VecsMeta>;
export type ReceiptEntry = Entry<Receipt>;
