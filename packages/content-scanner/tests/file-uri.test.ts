import { describe, expect, it } from "vitest";
import { encodeUri, parseUri } from "../src/file-uri.js";

describe("file-uri", () => {
  describe("encodeUri", () => {
    it("produces collectionId:path format", () => {
      expect(encodeUri("docs", "/readme.md")).toBe("docs:/readme.md");
    });

    it("handles empty path", () => {
      expect(encodeUri("col", "")).toBe("col:");
    });
  });

  describe("parseUri", () => {
    it("round-trips with encodeUri", () => {
      const uri = encodeUri("myCol", "/some/file.txt");
      const parsed = parseUri(uri);
      expect(parsed.collectionId).toBe("myCol");
      expect(parsed.path).toBe("/some/file.txt");
    });

    it("handles paths containing colons", () => {
      const uri = encodeUri("col", "/path/to:file:with:colons.txt");
      const parsed = parseUri(uri);
      expect(parsed.collectionId).toBe("col");
      expect(parsed.path).toBe("/path/to:file:with:colons.txt");
    });

    it("throws on URI without colon", () => {
      expect(() => parseUri("nocolon")).toThrow("Invalid file URI");
    });
  });
});
