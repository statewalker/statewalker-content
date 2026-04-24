import { sha1Uuid } from "@statewalker/shared-ids";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { BlobStore } from "../src/stores/blob.js";
import { float32Codec } from "../src/stores/codec-float32.js";
import { msgpackCodec } from "../src/stores/codec-msgpack.js";
import type { ContentEntry, VecsEntry } from "../src/types.js";

describe("BlobStore", () => {
  it("writes one blob per URI at {prefix}/{dd}/{hash}.bin", async () => {
    const files = new MemFilesApi();
    const store = new BlobStore<ContentEntry>({
      files,
      prefix: "/s",
      codec: msgpackCodec(),
    });
    await store.put([{ uri: "doc.md", meta: { text: "hello", format: "markdown" } }]);
    const hash = await sha1Uuid("doc.md");
    const expectedPath = `/s/${hash.slice(0, 2)}/${hash}.bin`;
    expect(await files.exists(expectedPath)).toBe(true);
  });

  it("round-trips meta via the msgpack codec", async () => {
    const store = new BlobStore<ContentEntry>({
      files: new MemFilesApi(),
      prefix: "/s",
      codec: msgpackCodec(),
    });
    await store.put([{ uri: "a", meta: { text: "body", format: "markdown" } }]);
    const e = await store.get("a");
    expect(e?.meta).toEqual({ text: "body", format: "markdown" });
  });

  it("tombstones remove the blob and skip codec encoding", async () => {
    const files = new MemFilesApi();
    const store = new BlobStore<ContentEntry>({
      files,
      prefix: "/s",
      codec: msgpackCodec(),
    });
    await store.put([{ uri: "a", meta: { text: "body", format: "markdown" } }]);
    const hash = await sha1Uuid("a");
    const blobP = `/s/${hash.slice(0, 2)}/${hash}.bin`;
    expect(await files.exists(blobP)).toBe(true);

    await store.put([{ uri: "a", tombstone: true }]);
    expect(await files.exists(blobP)).toBe(false);
    const e = await store.get("a");
    expect(e?.tombstone).toBe(true);
    expect(e?.meta).toBeUndefined();
  });

  it("since yields entries in stamp order, reading blobs lazily on each yield", async () => {
    const store = new BlobStore<ContentEntry>({
      files: new MemFilesApi(),
      prefix: "/s",
      codec: msgpackCodec(),
    });
    await store.put([
      { uri: "a", meta: { text: "A", format: "markdown" } },
      { uri: "b", meta: { text: "B", format: "markdown" } },
      { uri: "c", meta: { text: "C", format: "markdown" } },
    ]);
    const texts: string[] = [];
    for await (const e of store.since(0, 10)) {
      if (e.meta) texts.push(e.meta.text);
    }
    expect(texts).toEqual(["A", "B", "C"]);
  });

  it("works with the float32 codec for embeddings", async () => {
    const store = new BlobStore<VecsEntry>({
      files: new MemFilesApi(),
      prefix: "/v",
      codec: float32Codec(),
    });
    await store.put([
      {
        uri: "doc",
        meta: { vecs: [Float32Array.of(0.1, 0.2, 0.3), Float32Array.of(0.4, 0.5, 0.6)] },
      },
    ]);
    const e = await store.get("doc");
    expect(e?.meta?.vecs.length).toBe(2);
    expect(Array.from(e?.meta?.vecs[0] ?? [])).toEqual([
      0.10000000149011612, 0.20000000298023224, 0.30000001192092896,
    ]);
  });

  it("persists across a simulated restart", async () => {
    const files = new MemFilesApi();
    const first = new BlobStore<ContentEntry>({
      files,
      prefix: "/s",
      codec: msgpackCodec(),
    });
    await first.put([{ uri: "a", meta: { text: "body", format: "markdown" } }]);
    const topFirst = (await first.get("a"))?.stamp as number;
    await first.advance("t", topFirst);

    const second = new BlobStore<ContentEntry>({
      files,
      prefix: "/s",
      codec: msgpackCodec(),
    });
    const reopened = await second.get("a");
    expect(reopened?.meta?.text).toBe("body");
    expect(await second.cursor("t")).toBe(topFirst);
  });
});
