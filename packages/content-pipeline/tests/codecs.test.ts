import { describe, expect, it } from "vitest";
import { float32Codec } from "../src/stores/codec-float32.js";
import { msgpackCodec } from "../src/stores/codec-msgpack.js";
import type { ChunksMeta } from "../src/types.js";

describe("msgpackCodec", () => {
  it("round-trips a chunk list preserving order and types", async () => {
    const codec = msgpackCodec<ChunksMeta>();
    const meta: ChunksMeta = {
      chunks: [
        { i: 0, text: "alpha" },
        { i: 1, text: "beta" },
        { i: 2, text: "gamma" },
      ],
    };
    const bytes = await codec.encode(meta);
    const decoded = await codec.decode(bytes);
    expect(decoded).toEqual(meta);
  });

  it("round-trips generic meta shapes", async () => {
    const codec = msgpackCodec<Record<string, unknown>>();
    const meta = { size: 42, mtime: 1_700_000_000, nested: { a: [1, 2, 3] } };
    const bytes = await codec.encode(meta);
    expect(await codec.decode(bytes)).toEqual(meta);
  });
});

describe("float32Codec", () => {
  it("round-trips embeddings preserving values and order", async () => {
    const codec = float32Codec();
    const meta = {
      vecs: [Float32Array.of(1, 2, 3), Float32Array.of(4, 5, 6), Float32Array.of(7, 8, 9)],
    };
    const bytes = await codec.encode(meta);
    const decoded = await codec.decode(bytes);
    expect(decoded.vecs.length).toBe(3);
    expect(Array.from(decoded.vecs[0] as Float32Array)).toEqual([1, 2, 3]);
    expect(Array.from(decoded.vecs[1] as Float32Array)).toEqual([4, 5, 6]);
    expect(Array.from(decoded.vecs[2] as Float32Array)).toEqual([7, 8, 9]);
  });

  it("encodes empty vec list as a valid header-only blob", async () => {
    const codec = float32Codec();
    const bytes = await codec.encode({ vecs: [] });
    expect(bytes.length).toBe(8);
    const decoded = await codec.decode(bytes);
    expect(decoded.vecs).toEqual([]);
  });

  it("throws on mismatched dimensions at encode time", () => {
    const codec = float32Codec();
    expect(() => codec.encode({ vecs: [Float32Array.of(1, 2, 3), Float32Array.of(4, 5)] })).toThrow(
      /share dimension/,
    );
  });

  it("throws on corrupted header at decode time", () => {
    const codec = float32Codec();
    // Header claims 10 vecs of dim 3 but body is empty.
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setUint32(0, 10, true);
    new DataView(buf.buffer).setUint32(4, 3, true);
    expect(() => codec.decode(buf)).toThrow(/size/);
  });
});
