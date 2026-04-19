import type { ILlmApi } from "../llm-api.js";
import type { LlmMessage } from "../messages/message-types.js";
import type { ReasonEvent } from "./reason-events.js";
import {
  reasonAssistant,
  reasonError,
  reasonReasoningDelta,
  reasonStart,
  reasonStop,
  reasonTextDelta,
  reasonToolCall,
  reasonToolResult,
} from "./reason-events.js";
import {
  detectDoomLoop,
  isAuthError,
  serializeError,
  serializeToolResult,
} from "./reason-utils.js";

export interface ReasonLoopParams {
  /** Function that returns the current message history. */
  getMessages: () => LlmMessage[];
  modelId: string;
  llm: ILlmApi;
  system: string;
  maxSteps?: number;
  /** Maximum number of outer loop iterations (each may contain multiple tool calls). */
  maxIterations?: number;
  signal?: AbortSignal;
  onAuthError?: () => void;
}

/**
 * Runs the agentic reasoning loop as an AsyncGenerator.
 *
 * Each iteration calls `llm.streamChatCompletion()` once, yields
 * ReasonEvent messages for each stream part, and continues if the LLM
 * finishes with tool-calls.
 *
 * Callers should iterate the generator and apply events to their domain model.
 * To abort, pass a signal via params or call `generator.return()`.
 */
export async function* reasonLoop(params: ReasonLoopParams): AsyncGenerator<ReasonEvent> {
  const {
    getMessages,
    modelId,
    llm,
    system,
    maxSteps = 15,
    maxIterations = 10,
    signal,
    onAuthError,
  } = params;

  let step = 0;
  let hadToolCalls = false;

  try {
    yield reasonStart();

    while (true) {
      signal?.throwIfAborted();
      step++;

      const messages = getMessages();

      // Signal the start of a new assistant message
      yield reasonAssistant();

      const stream = llm.streamChatCompletion({
        model: modelId,
        system,
        messages,
        signal,
        maxSteps,
      });

      let finishReason = "unknown";
      let stepTextChars = 0;
      let stepToolCalls = 0;
      let stepToolResults = 0;
      // Track whether we need a new assistant message before the next
      // text/reasoning delta. This is set after tool-result events which
      // create a tool message, breaking the assistant message continuity.
      let needAssistant = false;

      for await (const part of stream) {
        signal?.throwIfAborted();

        switch (part.type) {
          case "reasoning":
            if (part.textDelta) {
              if (needAssistant) {
                yield reasonAssistant();
                needAssistant = false;
              }
              yield reasonReasoningDelta(part.textDelta);
            }
            break;

          case "text-delta":
            if (part.textDelta) {
              if (needAssistant) {
                yield reasonAssistant();
                needAssistant = false;
              }
              yield reasonTextDelta(part.textDelta);
              stepTextChars += part.textDelta.length;
            }
            break;

          case "tool-call":
            if (needAssistant) {
              yield reasonAssistant();
              needAssistant = false;
            }
            yield reasonToolCall({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.args,
            });
            stepToolCalls++;
            hadToolCalls = true;
            break;

          case "tool-result":
            yield reasonToolResult({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              result: serializeToolResult(part.result),
            });
            stepToolResults++;
            // After a tool-result, the last message is a tool message.
            // The next text/reasoning/tool-call needs a new assistant message.
            needAssistant = true;
            break;

          case "step-finish":
            finishReason = part.finishReason;
            break;
        }
      }

      console.log(
        `[reason-loop] step ${step} stream ended — finishReason=${finishReason}, textChars=${stepTextChars}, toolCalls=${stepToolCalls}, toolResults=${stepToolResults}`,
      );

      // If model finished without requesting tool calls, we're done.
      // When this follows previous tool-call steps, the text response
      // is the summarization — the assistant synthesized tool results.
      if (finishReason !== "tool-calls") {
        if (hadToolCalls && stepTextChars > 0) {
          console.log("[reason-loop] summarization complete");
        }
        break;
      }

      // Guard against infinite tool-call loops
      if (detectDoomLoop(getMessages())) {
        yield reasonError("Stopped: repeated identical tool calls detected");
        break;
      }

      // Guard against runaway iteration count
      if (step >= maxIterations) {
        console.log(`[reason-loop] maxIterations (${maxIterations}) reached, stopping`);
        break;
      }
    }

    yield reasonStop();
  } catch (err) {
    if (!signal?.aborted) {
      yield reasonStop(serializeError(err));
      console.log("[reason-loop] error caught:", err, "| isAuth:", isAuthError(err));
      if (isAuthError(err)) {
        onAuthError?.();
      }
    } else {
      yield reasonStop();
    }
  }
}
