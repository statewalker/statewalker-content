import { describe, expect, it } from "vitest";
import { createMemoryFtsBackend } from "../../src/workers/index-backends/memory-fts.js";
import { createMemoryVectorBackend } from "../../src/workers/index-backends/memory-vector.js";

describe("memory FTS backend", () => {
  it("indexes documents per scope and finds matches", () => {
    const fts = createMemoryFtsBackend();
    fts.upsert("doc:a", ["hello world", "foo bar"]);
    fts.upsert("doc:b", ["hello there"]);
    const hits = fts
      .query("hello")
      .map((h) => h.scope)
      .sort();
    expect(hits).toEqual(["doc:a", "doc:b"]);
  });

  it("delete removes a scope's entries", () => {
    const fts = createMemoryFtsBackend();
    fts.upsert("doc:a", ["hello"]);
    fts.upsert("doc:b", ["hello"]);
    fts.remove("doc:a");
    const hits = fts.query("hello").map((h) => h.scope);
    expect(hits).toEqual(["doc:b"]);
  });

  it("upsert replaces existing entries for a scope", () => {
    const fts = createMemoryFtsBackend();
    fts.upsert("doc:a", ["banana"]);
    fts.upsert("doc:a", ["apple"]);
    expect(fts.query("banana").length).toBe(0);
    expect(fts.query("apple").length).toBe(1);
  });
});

describe("memory vector backend", () => {
  it("stores vectors and finds nearest", () => {
    const vec = createMemoryVectorBackend();
    vec.upsert("v:a", new Float32Array([1, 0]));
    vec.upsert("v:b", new Float32Array([0, 1]));
    vec.upsert("v:c", new Float32Array([0.9, 0.1]));
    const top = vec.search(new Float32Array([1, 0]), 2);
    expect(top[0]?.id).toBe("v:a");
    expect(top[1]?.id).toBe("v:c");
  });

  it("delete removes the vector", () => {
    const vec = createMemoryVectorBackend();
    vec.upsert("v:a", new Float32Array([1]));
    vec.upsert("v:b", new Float32Array([1]));
    vec.remove("v:a");
    const top = vec.search(new Float32Array([1]), 5);
    expect(top.map((t) => t.id)).toEqual(["v:b"]);
  });
});
