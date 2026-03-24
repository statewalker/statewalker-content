import type { StreamPart } from "../llm-api.js";
import { serializeToolResult } from "./reason-utils.js";

/**
 * Callback interface for receiving reasoning stream output.
 * Domain models implement this to receive LLM stream events
 * without depending on any specific SDK.
 */
export interface ReasoningSink {
  /** Called when streaming begins. */
  onStart(): void;
  /** Called when streaming ends (with optional error). */
  onStop(error?: string): void;
  /** Ensure the last message is an assistant message (create one if needed). */
  ensureAssistantMessage(): void;
  /** Append a text delta to the current assistant message. */
  appendText(delta: string): void;
  /** Append a reasoning delta to the current assistant message. */
  appendReasoning(delta: string): void;
  /** Append a tool-call part to the current assistant message. */
  appendToolCall(call: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): void;
  /** Add a tool-result message after a tool call. */
  addToolResult(result: {
    toolCallId: string;
    toolName: string;
    result: unknown;
  }): void;
  /** Set an error message. */
  setError(error: string): void;
}

/**
 * Dispatch a single StreamPart event to a ReasoningSink.
 * Handles text, reasoning, tool-call, and tool-result parts.
 */
export function processStreamPart(part: StreamPart, sink: ReasoningSink): void {
  switch (part.type) {
    case "reasoning":
      if (part.textDelta) {
        sink.ensureAssistantMessage();
        sink.appendReasoning(part.textDelta);
      }
      break;

    case "text-delta":
      if (part.textDelta) {
        sink.ensureAssistantMessage();
        sink.appendText(part.textDelta);
      }
      break;

    case "tool-call":
      sink.ensureAssistantMessage();
      sink.appendToolCall({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.args,
      });
      console.log(`[stream-processor] tool-call: ${part.toolName}`);
      break;

    case "tool-result":
      sink.addToolResult({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: serializeToolResult(part.result),
      });
      console.log(`[stream-processor] tool-result: ${part.toolName}`);
      break;
  }
}
