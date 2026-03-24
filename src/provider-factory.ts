import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderV3 } from "@ai-sdk/provider";
import type { EmbeddingModel } from "ai";

export type ProviderName = "google" | "anthropic" | "openai";

export const PROVIDER_NAMES: ProviderName[] = ["google", "anthropic", "openai"];

/**
 * Create an AI SDK provider from a provider name and API key.
 * Maps provider strings to the correct `@ai-sdk/*` package.
 */
export function createProvider(name: ProviderName, apiKey: string): ProviderV3 {
  switch (name) {
    case "google":
      return createGoogleGenerativeAI({ apiKey });
    case "anthropic":
      return createAnthropic({ apiKey });
    case "openai":
      return createOpenAI({ apiKey });
    default:
      throw new Error(`Unknown provider: ${name as string}`);
  }
}

/**
 * Create an embedding model using the provider-specific API.
 * In AI SDK v6, outputDimensionality for Google is passed as providerOptions
 * at embed() call time, not at model creation.
 */
export function createEmbeddingModel(
  name: ProviderName,
  apiKey: string,
  modelId: string,
): EmbeddingModel {
  switch (name) {
    case "google": {
      const provider = createGoogleGenerativeAI({ apiKey });
      return provider.embeddingModel(modelId);
    }
    case "openai": {
      const provider = createOpenAI({ apiKey });
      return provider.textEmbeddingModel(modelId);
    }
    case "anthropic":
      throw new Error("Anthropic does not support embedding models");
    default:
      throw new Error(`Unknown provider: ${name as string}`);
  }
}
