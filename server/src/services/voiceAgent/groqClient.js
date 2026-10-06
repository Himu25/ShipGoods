import { AGENT_INSTRUCTIONS_HI, REFUSE_HI, looksLikeInjection, sanitizeAssistantText } from "./guardrails.js";
import { AGENT_TOOLS, executeAgentTool } from "./tools.js";
import { GENERIC_TROUBLE_REPLY_HI } from "./constants.js";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_TOOL_LOOPS = 4;

function toOpenAiTools() {
  return AGENT_TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

async function callGroq(messages, tools) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");
  if (!model) throw new Error("GROQ_MODEL is not configured");

  const res = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq chat-completions failed: ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * One turn of the trip-assistant conversation: guardrail check on the
 * incoming utterance, then Groq + tool-call loop (tools go through
 * tools.js -> tripService.js, never touching Mongo/Redis directly from
 * here), then output sanitization.
 */
export async function runAgentTurn({ ctx, history, userText }) {
  if (looksLikeInjection(userText)) {
    return { reply: REFUSE_HI, toolCalls: [], refused: true };
  }

  const messages = [
    { role: "system", content: AGENT_INSTRUCTIONS_HI },
    ...history,
    { role: "user", content: userText },
  ];
  const tools = toOpenAiTools();
  const toolCalls = [];

  for (let i = 0; i < MAX_TOOL_LOOPS; i += 1) {
    const data = await callGroq(messages, tools);
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error("Groq returned no message");

    if (!choice.tool_calls?.length) {
      const reply = sanitizeAssistantText(choice.content || "", REFUSE_HI);
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
      const executed = await executeAgentTool(name, args, ctx).catch(() => ({
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
    reply: GENERIC_TROUBLE_REPLY_HI,
    toolCalls,
    refused: false,
  };
}
