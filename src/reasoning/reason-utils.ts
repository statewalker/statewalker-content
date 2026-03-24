import type { LlmMessage } from "../messages/message-types.js";

/**
 * Normalize a tool result into a JSON-safe value.
 * Handles Error, Uint8Array, Date, class instances.
 */
export function serializeToolResult(result: unknown): unknown {
  if (result == null) return null;
  if (result instanceof Error) return { error: result.message };
  if (result instanceof Uint8Array)
    return { base64: btoa(String.fromCharCode(...result)) };
  if (result instanceof Date) return result.toISOString();
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }
  if (typeof result !== "object") return result;

  // MCP shape: { content: [{ type: "text", text: "..." }] }
  const obj = result as Record<string, unknown>;
  if ("toolResult" in obj) return serializeToolResult(obj.toolResult);
  if ("content" in obj && Array.isArray(obj.content)) {
    const texts: string[] = [];
    for (const part of obj.content) {
      if (
        part != null &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        texts.push(part.text);
      }
    }
    if (texts.length > 0) {
      const combined = texts.join("");
      try {
        return JSON.parse(combined);
      } catch {
        return combined;
      }
    }
  }

  // Plain objects — JSON round-trip to strip non-serializable fields
  try {
    return JSON.parse(JSON.stringify(result));
  } catch {
    return String(result);
  }
}

export function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Detect HTTP 401 / 403 authentication errors from the LLM provider.
 */
export function isAuthError(err: unknown): boolean {
  if (err == null) return false;
  const obj = err as Record<string, unknown>;
  if (obj.statusCode === 401 || obj.statusCode === 403) return true;
  if (obj.status === 401 || obj.status === 403) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(401|403)\b/.test(msg) || /\bUnauthorized\b/i.test(msg);
}

/**
 * Check last N tool calls — if all identical (same tool + args), it's a doom loop.
 * Also detects "varied doom loops" where the same tool is called repeatedly
 * with different args (e.g., searching for the same concept with slight variations).
 * Works with any message type that has role and content fields.
 */
export function detectDoomLoop(
  messages: LlmMessage[],
  threshold = 3,
  sameToolThreshold = 6,
): boolean {
  const toolCalls: string[] = [];
  const toolNames: string[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant" || typeof msg.content === "string")
      continue;
    for (const part of msg.content) {
      if (part.type === "tool-call") {
        toolCalls.unshift(`${part.toolName}:${JSON.stringify(part.args)}`);
        toolNames.unshift(part.toolName);
      }
    }
  }

  // Check for identical consecutive tool calls
  if (toolCalls.length >= threshold) {
    const tail = toolCalls.slice(-threshold);
    if (new Set(tail).size === 1) return true;
  }

  // Check for same tool called too many times with different args
  // (varied doom loop — model keeps searching with slight variations)
  if (toolNames.length >= sameToolThreshold) {
    const tail = toolNames.slice(-sameToolThreshold);
    if (new Set(tail).size === 1) return true;
  }

  return false;
}
