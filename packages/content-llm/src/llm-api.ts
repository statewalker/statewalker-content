import type { ToolSet } from "ai";
import type { z } from "zod";
import type { LlmMessage } from "./messages/message-types.js";

export type { ToolSet } from "ai";

export type StreamPart =
  | { type: "text-delta"; textDelta: string }
  | { type: "reasoning"; textDelta: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      result: unknown;
    }
  | { type: "step-finish"; finishReason: string };

export interface ChatCompletionOptions {
  model: string;
  messages: LlmMessage[];
  system?: string;
  signal?: AbortSignal;
  tools?: ToolSet;
  maxSteps?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface TextCompletionOptions {
  model: string;
  messages: LlmMessage[];
  system?: string;
  signal?: AbortSignal;
}

export interface ObjectCompletionOptions<T> {
  model: string;
  messages: LlmMessage[];
  schema: z.ZodType<T>;
  schemaName?: string;
  schemaDescription?: string;
  signal?: AbortSignal;
}

export interface ConnectOptions {
  provider: string;
  apiKey: string;
}

export interface ILlmApi {
  /** Connect to the LLM provider with credentials. */
  connect(options: ConnectOptions): void;
  /** Disconnect from the LLM provider, clearing credentials. */
  disconnect(): void;
  /**
   * Register tools for use in chat completions.
   * Returns a cleanup function that unregisters the tools.
   */
  registerTools(tools: ToolSet): () => void;
  /** Returns the merged set of all currently registered tools. */
  getRegisteredTools(): ToolSet;

  streamChatCompletion(options: ChatCompletionOptions): AsyncGenerator<StreamPart>;
  generateText(options: TextCompletionOptions): Promise<string>;
  /** Generate a structured object from an LLM using a Zod schema. */
  generateObject<T>(options: ObjectCompletionOptions<T>): Promise<T>;
  fetchModels(signal?: AbortSignal): Promise<string[]>;
}
