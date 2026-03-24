import type { ContentMessage, ContentMessageProps } from "@repo/content-blocks";

// ---------------------------------------------------------------------------
// Event type keys — discriminant for ReasonEvent union
// ---------------------------------------------------------------------------

export type ReasonEventType =
  | "reason:start"
  | "reason:stop"
  | "reason:assistant"
  | "reason:text-delta"
  | "reason:reasoning-delta"
  | "reason:tool-call"
  | "reason:tool-result"
  | "reason:error";

// ---------------------------------------------------------------------------
// Per-event prop interfaces (extend ContentMessageProps)
// ---------------------------------------------------------------------------

export interface ReasonProps extends ContentMessageProps {
  type: ReasonEventType;
}

export interface ReasonStartProps extends ReasonProps {
  type: "reason:start";
  role: "system";
}

export interface ReasonStopProps extends ReasonProps {
  type: "reason:stop";
  role: "system";
  error?: string;
}

export interface ReasonAssistantProps extends ReasonProps {
  type: "reason:assistant";
  role: "assistant";
}

export interface ReasonTextDeltaProps extends ReasonProps {
  type: "reason:text-delta";
  role: "assistant";
}

export interface ReasonReasoningDeltaProps extends ReasonProps {
  type: "reason:reasoning-delta";
  role: "assistant";
}

export interface ReasonToolCallProps extends ReasonProps {
  type: "reason:tool-call";
  role: "assistant";
  toolCallId: string;
  toolName: string;
}

export interface ReasonToolResultProps extends ReasonProps {
  type: "reason:tool-result";
  role: "tool";
  toolCallId: string;
  toolName: string;
}

export interface ReasonErrorProps extends ReasonProps {
  type: "reason:error";
  role: "system";
}

// ---------------------------------------------------------------------------
// Per-event message types (ContentMessage with typed props)
// ---------------------------------------------------------------------------

export interface ReasonStartEvent extends ContentMessage {
  props: ReasonStartProps;
}

export interface ReasonStopEvent extends ContentMessage {
  props: ReasonStopProps;
}

export interface ReasonAssistantEvent extends ContentMessage {
  props: ReasonAssistantProps;
}

export interface ReasonTextDeltaEvent extends ContentMessage {
  props: ReasonTextDeltaProps;
}

export interface ReasonReasoningDeltaEvent extends ContentMessage {
  props: ReasonReasoningDeltaProps;
}

export interface ReasonToolCallEvent extends ContentMessage {
  props: ReasonToolCallProps;
}

export interface ReasonToolResultEvent extends ContentMessage {
  props: ReasonToolResultProps;
}

export interface ReasonErrorEvent extends ContentMessage {
  props: ReasonErrorProps;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type ReasonEvent =
  | ReasonStartEvent
  | ReasonStopEvent
  | ReasonAssistantEvent
  | ReasonTextDeltaEvent
  | ReasonReasoningDeltaEvent
  | ReasonToolCallEvent
  | ReasonToolResultEvent
  | ReasonErrorEvent;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function msg<P extends ReasonProps>(
  props: P,
  content = "",
): ContentMessage & { props: P } {
  return { props, blocks: [{ content }] };
}

export function reasonStart(): ReasonStartEvent {
  return msg({ type: "reason:start", role: "system", time: now() });
}

export function reasonStop(error?: string): ReasonStopEvent {
  return msg(
    { type: "reason:stop", role: "system", time: now(), error },
    error ?? "",
  );
}

export function reasonAssistant(): ReasonAssistantEvent {
  return msg({ type: "reason:assistant", role: "assistant", time: now() });
}

export function reasonTextDelta(delta: string): ReasonTextDeltaEvent {
  return msg(
    { type: "reason:text-delta", role: "assistant", time: now() },
    delta,
  );
}

export function reasonReasoningDelta(delta: string): ReasonReasoningDeltaEvent {
  return msg(
    { type: "reason:reasoning-delta", role: "assistant", time: now() },
    delta,
  );
}

export function reasonToolCall(call: {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}): ReasonToolCallEvent {
  return msg(
    {
      type: "reason:tool-call",
      role: "assistant",
      time: now(),
      toolCallId: call.toolCallId,
      toolName: call.toolName,
    },
    JSON.stringify(call.args),
  );
}

export function reasonToolResult(result: {
  toolCallId: string;
  toolName: string;
  result: unknown;
}): ReasonToolResultEvent {
  return msg(
    {
      type: "reason:tool-result",
      role: "tool",
      time: now(),
      toolCallId: result.toolCallId,
      toolName: result.toolName,
    },
    JSON.stringify(result.result),
  );
}

export function reasonError(error: string): ReasonErrorEvent {
  return msg({ type: "reason:error", role: "system", time: now() }, error);
}
