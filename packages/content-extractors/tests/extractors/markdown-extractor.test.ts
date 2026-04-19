import { describe, expect, it } from "vitest";
import { markdownExtractor } from "../../src/extractors/markdown-extractor.js";

function toChunks(...strings: string[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return strings.map((s) => encoder.encode(s));
}

describe("markdownExtractor", () => {
  it("returns markdown content as-is", async () => {
    const chunks = toChunks("# Hello\n\nWorld");
    const result = await markdownExtractor(chunks);
    expect(result).toBe("# Hello\n\nWorld");
  });

  it("handles multiple chunks", async () => {
    const chunks = toChunks("# Title\n\n", "Paragraph text");
    const result = await markdownExtractor(chunks);
    expect(result).toBe("# Title\n\nParagraph text");
  });

  it("handles empty input", async () => {
    const result = await markdownExtractor([]);
    expect(result).toBe("");
  });
});
