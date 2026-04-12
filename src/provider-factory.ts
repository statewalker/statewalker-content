/**
 * Re-exports from @statewalker/ai-provider.
 * Previously a duplicate factory — now consolidated.
 */
export {
  type ProviderName,
  PROVIDER_NAMES,
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
export function createRemoteProvider(name: PN, apiKey: string): ProviderV3 {
  switch (name) {
    case "anthropic":
      return createAnthropic({ apiKey });
    case "google":
      return createGoogleGenerativeAI({ apiKey });
    case "openai":
      return createOpenAI({ apiKey });
    default:
      throw new Error(`Unknown provider: ${name as string}`);
  }
}
