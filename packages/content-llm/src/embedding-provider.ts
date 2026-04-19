import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { EmbeddingModel } from "ai";
import { embedMany } from "ai";
import type { EmbeddingProvider } from "./types.js";

export function createEmbeddingProvider(options: {
  model: EmbeddingModel;
  modelName?: string;
  dimensions?: number;
  providerOptions?: ProviderOptions;
  batchSize?: number;
}): EmbeddingProvider {
  const dimensions = options.dimensions ?? 1536;
  const modelName = options.modelName ?? "unknown";
  const batchSize = options.batchSize ?? 128;

  return {
    model: modelName,
    dimensions,
    async embed(texts) {
      if (texts.length === 0) return [];

      const allEmbeddings: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const { embeddings } = await embedMany({
          model: options.model,
          values: batch,
          providerOptions: options.providerOptions,
        });
        allEmbeddings.push(...embeddings);
      }
      return allEmbeddings.map((e) => new Float32Array(e));
    },
  };
}
