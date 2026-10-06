import {
  AGENT_INSTRUCTIONS_EN,
  REFUSE_EN,
  looksLikeInjection,
  sanitizeAssistantText,
} from "./guardrails.js";
import { executeTool, GROK_TOOLS } from "./toolRouter.js";

const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const MAX_TOOL_LOOPS = 4;

/** GROK_TOOLS (toolRouter.js) are in the flat Realtime-API shape used by
 * the old grokClient.js. Chat-completions wants OpenAI's nested shape. */
function toOpenAiTools() {
  return GROK_TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function systemPrompt(callType) {
  const framing =
    callType === "eta"
      ? "This call type is 'eta': the driver is on the way, not yet arrived."
      : "This call type is 'arrival': the driver has arrived at pickup.";
  return `${AGENT_INSTRUCTIONS_EN}\n\n${framing}`;
}

async function callGrok(messages, tools) {
  const apiKey = process.env.XAI_API_KEY;
  const model = process.env.GROK_MODEL;
  if (!apiKey) throw new Error("XAI_API_KEY is not configured");
  if (!model) throw new Error("GROK_MODEL is not configured");

  const res = await fetch(XAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Grok chat-completions failed: ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * Runs one full turn: given conversation history (OpenAI `messages` shape,
 * without the system prompt) plus the latest user utterance, returns the
 * assistant's final text reply and the tool calls made along the way.
 * Tool execution reuses toolRouter.js's executeTool() unchanged — nothing
 * about guardrails or business logic differs from the old realtime path.
 */
export async function runGrokTurn({ ctx, callType, history, userText }) {
  if (looksLikeInjection(userText)) {
    return { reply: REFUSE_EN, toolCalls: [], refused: true };
  }

  const messages = [
    { role: "system", content: systemPrompt(callType) },
    ...history,
    { role: "user", content: userText },
  ];
  const tools = toOpenAiTools();
  const toolCalls = [];

  for (let i = 0; i < MAX_TOOL_LOOPS; i += 1) {
    const data = await callGrok(messages, tools);
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error("Grok returned no message");

    if (!choice.tool_calls?.length) {
      const reply = sanitizeAssistantText(choice.content || "", REFUSE_EN);
      return { reply, toolCalls, refused: false };
    }

    messages.push(choice);
    for (const call of choice.tool_calls) {
      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      const name = call.function?.name;
      const executed = await executeTool(name, args, ctx).catch(() => ({
        ok: false,
        result: { error: "tool_failed" },
      }));
      toolCalls.push({ name, args, result: executed.result, ok: executed.ok });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(executed.result),
      });
    }
  }

  return {
    reply: "Sorry, I'm having trouble with that right now. I'll let your driver know.",
    toolCalls,
    refused: false,
  };
}
