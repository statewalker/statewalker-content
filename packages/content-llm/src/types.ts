export type MarkdownNormalizer = {
  normalize(markdown: string, context?: { sourcePath?: string }): Promise<string>;
};

export type EmbeddingProvider = {
  embed(texts: string[]): Promise<Float32Array[]>;
  model: string;
  dimensions: number;
};

export type ContentSummarizer = {
  summarize(text: string, maxTokens?: number): Promise<string>;
};
