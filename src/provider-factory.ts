/**
 * Re-exports from @statewalker/ai-provider.
 * Previously a duplicate factory — now consolidated.
 */
export {
  PROVIDER_NAMES,
  type ProviderName,
  verifyModelAccess,
} from "@statewalker/ai-provider";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderV3 } from "@ai-sdk/provider";
import type { ProviderName as PN } from "@statewalker/ai-provider";

/**
 * Create a remote AI SDK provider from a provider name and API key.
 * Used internally by LlmApi.connect().
 */
export function createRemoteProvider(
  name: PN,
  apiKey: string,
  baseURL?: string,
): ProviderV3 {
  switch (name) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL });
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL });
    case "openai":
      return createOpenAI({ apiKey, baseURL });
    case "openai-compatible":
      if (!baseURL) {
        throw new Error("openai-compatible provider requires baseURL");
      }
      return createOpenAI({ apiKey, baseURL });
    default:
      throw new Error(`Unknown provider: ${name as string}`);
  }
}
