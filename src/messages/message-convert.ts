import type {
  AssistantModelMessage,
  ModelMessage,
  ToolResultPart as SdkToolResultPart,
} from "ai";
import type {
  AssistantContentPart,
  LlmMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from "./message-types.js";

/**
 * Convert LlmMessage[] to Vercel AI SDK ModelMessage[].
 * Strips reasoning parts from assistant messages (they should not be
 * sent back to the LLM). Extra fields (time, stage, etc.) are ignored.
 */
export function toCoreMessages(messages: LlmMessage[]): ModelMessage[] {
  return messages.map(toCoreMessage);
}

function toCoreMessage(msg: LlmMessage): ModelMessage {
  switch (msg.role) {
    case "system":
      return { role: "system", content: msg.content };
    case "user":
      return { role: "user", content: msg.content };
    case "assistant": {
      if (typeof msg.content === "string" || !Array.isArray(msg.content)) {
        return {
          role: "assistant",
          content: typeof msg.content === "string" ? msg.content : "",
        };
      }
      return {
        role: "assistant",
        content: msg.content
          .filter((part) => part.type !== "reasoning")
          .map((part) => {
            if (part.type === "text") {
              return { type: "text" as const, text: part.text };
            }
            return {
              type: "tool-call" as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.args ?? {},
            };
          }),
      };
    }
    case "tool":
      return {
        role: "tool",
        content: (Array.isArray(msg.content) ? msg.content : []).map((part) => ({
          type: "tool-result" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: {
            type: "json" as const,
            value: (part.result ?? null) as import("ai").JSONValue,
          },
        })),
      };
  }
}

/**
 * Convert a Vercel AI SDK ModelMessage to an LlmMessage.
 */
export function fromCoreMessage(msg: ModelMessage): LlmMessage {
  switch (msg.role) {
    case "system":
      return {
        role: "system",
        content: typeof msg.content === "string" ? msg.content : "",
      };
    case "user":
      return {
        role: "user",
        content: typeof msg.content === "string" ? msg.content : "",
      };
    case "assistant":
      return {
        role: "assistant",
        content: convertAssistantContent(msg),
      };
    case "tool":
      return {
        role: "tool",
        content: Array.isArray(msg.content)
          ? msg.content
              .filter((p): p is SdkToolResultPart => p.type === "tool-result")
              .map(
                (p): ToolResultPart => ({
                  type: "tool-result",
                  toolCallId: p.toolCallId,
                  toolName: p.toolName,
                  result: extractToolOutput(p.output),
                }),
              )
          : [],
      };
  }
}

function convertAssistantContent(
  msg: AssistantModelMessage,
): string | AssistantContentPart[] {
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.content)) return "";

  const parts: AssistantContentPart[] = [];
  for (const p of msg.content) {
    if (p.type === "text") {
      parts.push({ type: "text", text: p.text } satisfies TextPart);
    } else if (p.type === "tool-call") {
      parts.push({
        type: "tool-call",
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        args: p.input as Record<string, unknown>,
      } satisfies ToolCallPart);
    }
  }
  return parts.length === 1 && parts[0]?.type === "text"
    ? parts[0]?.text
    : parts;
}

function extractToolOutput(output: SdkToolResultPart["output"]): unknown {
  if (output.type === "json") return output.value;
  if (output.type === "text") return output.value;
  return undefined;
}
