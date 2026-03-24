// Content parts — SDK-agnostic message building blocks.

export interface TextPart {
  type: "text";
  text: string;
}

export interface ToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ReasoningPart {
  type: "reasoning";
  text: string;
}

export interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
}

export type AssistantContentPart = TextPart | ReasoningPart | ToolCallPart;

// Message types (SDK-agnostic).
// Domain layers may extend these with extra fields (e.g. time, stage)
// and pass them directly thanks to TypeScript structural subtyping.

export interface LlmSystemMessage {
  role: "system";
  content: string;
}

export interface LlmUserMessage {
  role: "user";
  content: string;
}

export interface LlmAssistantMessage {
  role: "assistant";
  content: string | AssistantContentPart[];
}

export interface LlmToolMessage {
  role: "tool";
  content: ToolResultPart[];
}

export type LlmMessage =
  | LlmSystemMessage
  | LlmUserMessage
  | LlmAssistantMessage
  | LlmToolMessage;

export type LlmMessageRole = LlmMessage["role"];

// Helpers

export function getTextContent(message: LlmMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function getReasoningContent(message: LlmMessage): string {
  if (typeof message.content === "string") return "";
  return message.content
    .filter((p): p is ReasoningPart => p.type === "reasoning")
    .map((p) => p.text)
    .join("");
}
