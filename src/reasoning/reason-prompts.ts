/**
 * Stage-specific system prompt builders for the FSM-based reasoning cycle.
 */

export function buildPlanningSystemPrompt(base: string): string {
  return `${base}

## Your Task
Analyze the user's latest message and the conversation history. Decide how to proceed:

1. **responseFound** — You can answer directly without using any tools. The user is asking a question you know the answer to, making small talk, or the conversation context already contains the information needed.

2. **apply** — You need to use tools to fulfill the request. Outline a concrete step-by-step plan: which tools to call, in what order, and what information to extract. Be specific about tool names and expected arguments.

3. **notEnoughInformation** — The request is too vague or ambiguous to act on, and you need clarification from the user.

Respond with a JSON object matching the required schema.`;
}

export function buildExecutionSystemPrompt(
  base: string,
  plan?: { analysis?: string; plan?: string },
): string {
  let prompt = `${base}

## Current Stage: Execution
You are in the execution stage of a reasoning cycle. You may make multiple consecutive tool calls to fulfill the user's request. Chain tool calls as needed — for example, list a directory first, then read specific files based on the results.

After each tool result, decide whether you need more information (make another tool call) or have enough to stop. Do not output a final text response — that will be handled by the summarization stage.`;

  if (plan?.analysis || plan?.plan) {
    prompt += "\n\n## Planning Context";
    if (plan.analysis) {
      prompt += `\nAnalysis: ${plan.analysis}`;
    }
    if (plan.plan) {
      prompt += `\nExecution plan: ${plan.plan}`;
    }
    prompt +=
      "\n\nFollow this plan step by step. Use the available tools to gather all needed information.";
  }

  return prompt;
}

export function buildSummarizationSystemPrompt(
  base: string,
  path: string,
): string {
  switch (path) {
    case "responseFound":
      return `${base}

## Current Stage: Response
Answer the user's message directly. Be helpful, clear, and concise.`;

    case "notEnoughInformation":
      return `${base}

## Current Stage: Clarification
The user's request needs clarification before you can proceed. Ask a focused question to understand what they need. Be specific about what information is missing.`;

    default:
      return `${base}

## Current Stage: Summary
You have just completed tool operations. Synthesize the results into a clear, user-friendly response. Do not repeat raw tool output — the user already sees it as rich visual components. Instead, provide context, interpretation, or a brief summary of what was accomplished.`;
  }
}
