import { decodeMsgpack, encodeMsgpack } from "@statewalker/webrun-msgpack";
import type { BlobCodec } from "./codec.js";

async function* singleton<T>(value: T): AsyncGenerator<T> {
  yield value;
}

async function concat(chunks: Uint8Array[]): Promise<Uint8Array> {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function* emitOnce(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/**
 * Default blob codec. Writes the meta as a single length-prefixed msgpack frame
 * and decodes it back by reading one frame. Handles any JSON-serialisable shape
 * (text, chunk lists, arbitrary Record<string, unknown>).
 */
export function msgpackCodec<M>(): BlobCodec<M> {
  return {
    async encode(meta: M): Promise<Uint8Array> {
      const frames: Uint8Array[] = [];
      for await (const f of encodeMsgpack(singleton(meta))) frames.push(f);
      return concat(frames);
    },
    async decode(bytes: Uint8Array): Promise<M> {
      for await (const v of decodeMsgpack<M>(emitOnce(bytes))) return v;
      throw new Error("msgpack codec: blob is empty");
    },
  };
}
