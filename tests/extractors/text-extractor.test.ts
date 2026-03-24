import { describe, expect, it } from "vitest";
import { textExtractor } from "../../src/extractors/text-extractor.js";

function toChunks(...strings: string[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return strings.map((s) => encoder.encode(s));
}

describe("textExtractor", () => {
  it("decodes a single chunk", async () => {
    const chunks = toChunks("Hello, world!");
    const result = await textExtractor(chunks);
    expect(result).toBe("Hello, world!");
  });

  it("decodes multiple chunks", async () => {
    const chunks = toChunks("Hello, ", "world!");
    const result = await textExtractor(chunks);
    expect(result).toBe("Hello, world!");
  });

  it("handles empty input", async () => {
    const result = await textExtractor([]);
    expect(result).toBe("");
  });

  it("handles async iterable input", async () => {
    async function* generate() {
      const encoder = new TextEncoder();
      yield encoder.encode("async ");
      yield encoder.encode("content");
    }
    const result = await textExtractor(generate());
    expect(result).toBe("async content");
  });
});
