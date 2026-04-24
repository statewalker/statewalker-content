/**
 * Binary codec for a layer's meta payload. Sync or async — BlobStore always awaits.
 * Separate from Store so one layer can swap codecs (msgpack → raw Float32 for embeddings)
 * without reimplementing persistence.
 */
export interface BlobCodec<M> {
  encode(meta: M): Uint8Array | Promise<Uint8Array>;
  decode(bytes: Uint8Array): M | Promise<M>;
}
