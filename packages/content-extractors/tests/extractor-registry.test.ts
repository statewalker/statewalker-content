import { describe, expect, it } from "vitest";
import { ExtractorRegistry } from "../src/extractor-registry.js";
import type { ContentExtractor } from "../src/types.js";

const dummyExtractor: ContentExtractor = async () => "dummy";
const specificExtractor: ContentExtractor = async () => "specific";
const htmlExtractor: ContentExtractor = async () => "html";

describe("ExtractorRegistry", () => {
  describe("getByPath", () => {
    it("returns the more specific pattern match", () => {
      const registry = new ExtractorRegistry();
      registry.registerByPattern("*.md", dummyExtractor);
      registry.registerByPattern("*.plan.md", specificExtractor);

      const result = registry.getByPath("foo.plan.md");
      expect(result).toBe(specificExtractor);
    });

    it("returns the general pattern when no specific match", () => {
      const registry = new ExtractorRegistry();
      registry.registerByPattern("*.md", dummyExtractor);
      registry.registerByPattern("*.plan.md", specificExtractor);

      const result = registry.getByPath("readme.md");
      expect(result).toBe(dummyExtractor);
    });

    it("returns undefined for unknown extensions", () => {
      const registry = new ExtractorRegistry();
      registry.registerByPattern("*.md", dummyExtractor);

      const result = registry.getByPath("unknown.xyz");
      expect(result).toBeUndefined();
    });

    it("handles paths with directories", () => {
      const registry = new ExtractorRegistry();
      registry.registerByPattern("*.md", dummyExtractor);

      const result = registry.getByPath("/some/path/readme.md");
      expect(result).toBe(dummyExtractor);
    });
  });

  describe("getByMime", () => {
    it("returns registered extractor for mime type", () => {
      const registry = new ExtractorRegistry();
      registry.registerByMime("text/html", htmlExtractor);

      const result = registry.getByMime("text/html");
      expect(result).toBe(htmlExtractor);
    });

    it("returns undefined for unregistered mime type", () => {
      const registry = new ExtractorRegistry();

      const result = registry.getByMime("text/html");
      expect(result).toBeUndefined();
    });
  });

  describe("get", () => {
    it("tries path first, then mime", () => {
      const registry = new ExtractorRegistry();
      registry.registerByPattern("*.md", dummyExtractor);
      registry.registerByMime("text/markdown", specificExtractor);

      const result = registry.get("readme.md", "text/markdown");
      expect(result).toBe(dummyExtractor);
    });

    it("falls back to mime when path has no match", () => {
      const registry = new ExtractorRegistry();
      registry.registerByMime("text/html", htmlExtractor);

      const result = registry.get("unknown.xyz", "text/html");
      expect(result).toBe(htmlExtractor);
    });

    it("returns undefined when neither matches", () => {
      const registry = new ExtractorRegistry();

      const result = registry.get("unknown.xyz");
      expect(result).toBeUndefined();
    });
  });
});
