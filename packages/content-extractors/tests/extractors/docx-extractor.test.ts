import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { docxExtractor } from "../../src/extractors/docx-extractor.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures");

describe("docxExtractor", () => {
  it("extracts text from a DOCX file", async () => {
    const bytes = await readFile(resolve(fixturesDir, "sample.docx"));
    const result = await docxExtractor([new Uint8Array(bytes)]);
    expect(typeof result).toBe("string");
    expect(result as string).toContain("Test Document");
    expect(result as string).toContain("test paragraph");
    expect(result as string).toContain("**bold text**");
  });

  it("converts bold formatting to markdown", async () => {
    const bytes = await readFile(resolve(fixturesDir, "sample.docx"));
    const result = (await docxExtractor([new Uint8Array(bytes)])) as string;
    expect(result).toContain("**bold text**");
  });
});
