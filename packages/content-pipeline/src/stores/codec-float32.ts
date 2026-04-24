import type { VecsMeta } from "../types.js";
import type { BlobCodec } from "./codec.js";

/**
 * Raw Float32 codec for embeddings meta. Format: `[count: u32 LE][dim: u32 LE][flat Float32 bytes]`.
 * All vectors must share one `dim`. Decoding wraps the buffer in a single Float32Array and
 * slices into N views — zero per-array framing, zero element copies.
 */
export function float32Codec(): BlobCodec<VecsMeta> {
  return {
    encode(meta: VecsMeta): Uint8Array {
      const vecs = meta.vecs;
      if (vecs.length === 0) {
        const empty = new ArrayBuffer(8);
        new DataView(empty).setUint32(0, 0, true);
        new DataView(empty).setUint32(4, 0, true);
        return new Uint8Array(empty);
      }
      const dim = vecs[0]?.length ?? 0;
      for (let i = 1; i < vecs.length; i++) {
        if (vecs[i]?.length !== dim) {
          throw new Error(
            `float32 codec: vectors must share dimension, got ${vecs[i]?.length} vs ${dim} at index ${i}`,
          );
        }
      }
      const header = 8;
      const bodyBytes = vecs.length * dim * 4;
      const out = new Uint8Array(header + bodyBytes);
      const view = new DataView(out.buffer);
      view.setUint32(0, vecs.length, true);
      view.setUint32(4, dim, true);
      let off = header;
      for (const v of vecs) {
        out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), off);
        off += dim * 4;
      }
      return out;
    },
    decode(bytes: Uint8Array): VecsMeta {
      if (bytes.length < 8) {
        throw new Error("float32 codec: blob is shorter than the 8-byte header");
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count = view.getUint32(0, true);
      const dim = view.getUint32(4, true);
      const expected = 8 + count * dim * 4;
      if (bytes.length !== expected) {
        throw new Error(
          `float32 codec: blob size ${bytes.length} does not match header (count=${count}, dim=${dim}, expected=${expected})`,
        );
      }
      const vecs: Float32Array[] = [];
      // Copy the body into its own ArrayBuffer so Float32Array alignment is guaranteed.
      const body = new Uint8Array(
        bytes.buffer.slice(bytes.byteOffset + 8, bytes.byteOffset + expected),
      );
      const base = new Float32Array(body.buffer);
      for (let i = 0; i < count; i++) {
        vecs.push(base.subarray(i * dim, (i + 1) * dim));
      }
      return { vecs };
    },
  };
}
