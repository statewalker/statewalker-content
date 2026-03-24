import { describe, expect, it } from "vitest";
import type {
  ContentSummarizer,
  EmbeddingProvider,
  MarkdownNormalizer,
} from "../src/index.js";
import {
  createContentSummarizer,
  createEmbeddingProvider,
  createMarkdownNormalizer,
} from "../src/index.js";

describe("content-llm exports", () => {
  it("exports all factory functions", () => {
    expect(createMarkdownNormalizer).toBeTypeOf("function");
    expect(createEmbeddingProvider).toBeTypeOf("function");
    expect(createContentSummarizer).toBeTypeOf("function");
  });

  it("createMarkdownNormalizer returns correct shape", () => {
    const normalizer: MarkdownNormalizer = createMarkdownNormalizer({
      model: {} as Parameters<typeof createMarkdownNormalizer>[0]["model"],
    });
    expect(normalizer).toHaveProperty("normalize");
    expect(normalizer.normalize).toBeTypeOf("function");
  });

  it("createEmbeddingProvider returns correct shape", () => {
    const provider: EmbeddingProvider = createEmbeddingProvider({
      model: {} as Parameters<typeof createEmbeddingProvider>[0]["model"],
      modelName: "test-embedding",
      dimensions: 768,
    });
    expect(provider).toHaveProperty("embed");
    expect(provider).toHaveProperty("model");
    expect(provider).toHaveProperty("dimensions");
    expect(provider.embed).toBeTypeOf("function");
    expect(provider.model).toBe("test-embedding");
    expect(provider.dimensions).toBe(768);
  });

  it("createEmbeddingProvider uses defaults", () => {
    const provider: EmbeddingProvider = createEmbeddingProvider({
      model: {} as Parameters<typeof createEmbeddingProvider>[0]["model"],
    });
    expect(provider.model).toBe("unknown");
    expect(provider.dimensions).toBe(1536);
  });

  it("createContentSummarizer returns correct shape", () => {
    const summarizer: ContentSummarizer = createContentSummarizer({
      model: {} as Parameters<typeof createContentSummarizer>[0]["model"],
    });
    expect(summarizer).toHaveProperty("summarize");
    expect(summarizer.summarize).toBeTypeOf("function");
  });
});
