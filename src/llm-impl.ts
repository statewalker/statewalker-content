import type { ProviderV3 } from "@ai-sdk/provider";
import {
  generateObject,
  generateText,
  stepCountIs,
  streamText,
  type ToolSet,
} from "ai";
import type {
  ChatCompletionOptions,
  ConnectOptions,
  ILlmApi,
  ObjectCompletionOptions,
  StreamPart,
  TextCompletionOptions,
} from "./llm-api.js";
import { toCoreMessages } from "./messages/message-convert.js";
import { createProvider, type ProviderName } from "./provider-factory.js";

export class LlmApi implements ILlmApi {
  private provider: ProviderV3 | undefined;
  private toolSets: ToolSet[] = [];

  connect(options: ConnectOptions): void {
    this.provider = createProvider(
      options.provider as ProviderName,
      options.apiKey,
    );
  }

  disconnect(): void {
    this.provider = undefined;
  }

  registerTools(tools: ToolSet): () => void {
    this.toolSets.push(tools);
    return () => {
      const idx = this.toolSets.indexOf(tools);
      if (idx >= 0) this.toolSets.splice(idx, 1);
    };
  }

  getRegisteredTools(): ToolSet {
    const merged: ToolSet = {};
    for (const ts of this.toolSets) {
      Object.assign(merged, ts);
    }
    return merged;
  }

  private getTools(extra?: ToolSet): ToolSet | undefined {
    const merged = this.getRegisteredTools();
    if (extra) {
      Object.assign(merged, extra);
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private requireProvider(): ProviderV3 {
    if (!this.provider) {
      throw new Error("LlmApi not connected. Call connect() first.");
    }
    return this.provider;
  }

  async *streamChatCompletion(
    options: ChatCompletionOptions,
  ): AsyncGenerator<StreamPart> {
    const provider = this.requireProvider();
    const tools = this.getTools(options.tools);
    const maxSteps = options.maxSteps ?? 2;
    const messages = toCoreMessages(options.messages);
    console.log(
      "[LlmApi] streamChatCompletion — model:",
      options.model,
      "| tools:",
      tools ? Object.keys(tools) : "none",
      "| maxSteps:",
      maxSteps,
    );
    const result = streamText({
      model: provider.languageModel(options.model),
      system: options.system,
      messages,
      abortSignal: options.signal,
      tools,
      stopWhen: stepCountIs(maxSteps),
      providerOptions: options.providerOptions as import("@ai-sdk/provider-utils").ProviderOptions,
    });
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta":
          yield { type: "reasoning", textDelta: part.text };
          break;
        case "text-delta":
          yield { type: "text-delta", textDelta: part.text };
          break;
        case "tool-call":
          yield {
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: (part.input ?? {}) as Record<string, unknown>,
          };
          break;
        case "tool-result":
          yield {
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            result: part.output,
          };
          break;
        case "finish-step":
          yield {
            type: "step-finish",
            finishReason: part.finishReason,
          };
          break;
      }
    }
  }

  async generateObject<T>(options: ObjectCompletionOptions<T>): Promise<T> {
    const provider = this.requireProvider();
    const messages = toCoreMessages(options.messages);
    const result = await generateObject({
      model: provider.languageModel(options.model),
      messages,
      schema: options.schema,
      schemaName: options.schemaName,
      schemaDescription: options.schemaDescription,
      abortSignal: options.signal,
    });
    return result.object;
  }

  async generateText(options: TextCompletionOptions): Promise<string> {
    const provider = this.requireProvider();
    const messages = toCoreMessages(options.messages);
    const result = await generateText({
      model: provider.languageModel(options.model),
      system: options.system,
      messages,
      abortSignal: options.signal,
    });
    return result.text;
  }

  async fetchModels(_signal?: AbortSignal): Promise<string[]> {
    // Direct providers don't have a standardized model listing API.
    // Models are configured explicitly by the user.
    return [];
  }
}
