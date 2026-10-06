import WebSocket from "ws";
import {
  AGENT_INSTRUCTIONS,
  GREETING_HINDI,
  looksLikeInjection,
  REFUSE_HINDI,
  sanitizeAssistantText,
} from "./guardrails.js";
import { executeTool, GROK_TOOLS } from "./toolRouter.js";

const GROK_REALTIME_URL =
  "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
export const PCM_RATE = 24000;
const MAX_CALL_MS = 90 * 1000;

function buildTools() {
  const tools = [...GROK_TOOLS];
  const collectionId = process.env.XAI_RAG_COLLECTION_ID;
  if (collectionId) {
    tools.unshift({
      type: "file_search",
      vector_store_ids: [collectionId],
      max_num_results: 5,
    });
  }
  return tools;
}

export function createGrokSession({ ctx, onAudio, onEvent, onFatal }) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    onFatal(new Error("XAI_API_KEY is not configured"));
    return {
      sendAudio() {},
      close() {},
    };
  }

  const grok = new WebSocket(GROK_REALTIME_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const pendingCalls = new Set();
  let closed = false;
  let greetingSent = false;
  const hangupTimer = setTimeout(() => {
    onEvent({ type: "timeout" });
    close("duration_cap");
  }, MAX_CALL_MS);

  const send = (payload) => {
    if (grok.readyState === WebSocket.OPEN) {
      grok.send(JSON.stringify(payload));
    }
  };

  const close = (reason) => {
    if (closed) return;
    closed = true;
    clearTimeout(hangupTimer);
    try {
      grok.close();
    } catch {
      /* ignore */
    }
    onEvent({ type: "closed", reason });
  };

  const flushResponse = () => {
    setTimeout(() => {
      if (!closed && pendingCalls.size === 0) {
        send({ type: "response.create" });
      }
    }, 40);
  };

  const handleFunctionCall = async (event) => {
    const callId = event.call_id;
    const name = event.name;
    pendingCalls.add(callId);
    let args = {};
    try {
      args = event.arguments ? JSON.parse(event.arguments) : {};
    } catch {
      args = {};
    }

    let output;
    try {
      const executed = await executeTool(name, args, ctx);
      output = executed.result;
    } catch {
      output = { error: "tool_failed" };
    }

    send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    pendingCalls.delete(callId);
    flushResponse();
  };

  grok.on("open", () => {
    send({
      type: "session.update",
      session: {
        voice: "eve",
        instructions: AGENT_INSTRUCTIONS,
        turn_detection: { type: "server_vad" },
        tools: buildTools(),
        audio: {
          input: {
            format: { type: "audio/pcm", rate: PCM_RATE },
            transcription: {
              language_hint: "hi",
              keyterms: [
                "ShipGoods",
                "saman",
                "pickup",
                "driver",
                "number plate",
              ],
            },
          },
          output: {
            format: { type: "audio/pcm", rate: PCM_RATE },
          },
        },
      },
    });
    setTimeout(() => {
      if (greetingSent || closed) return;
      greetingSent = true;
      send({
        type: "conversation.item.create",
        item: {
          type: "force_message",
          role: "assistant",
          interruptible: false,
          content: [{ type: "output_text", text: GREETING_HINDI }],
        },
      });
      onEvent({ type: "transcript", role: "assistant", text: GREETING_HINDI });
    }, 600);
  });

  grok.on("message", async (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (
      (event.type === "session.updated" || event.type === "session.created") &&
      !greetingSent
    ) {
      greetingSent = true;
      send({
        type: "conversation.item.create",
        item: {
          type: "force_message",
          role: "assistant",
          interruptible: false,
          content: [{ type: "output_text", text: GREETING_HINDI }],
        },
      });
      onEvent({ type: "transcript", role: "assistant", text: GREETING_HINDI });
    }

    if (
      event.type === "response.output_audio.delta" ||
      event.type === "response.audio.delta"
    ) {
      if (event.delta) onAudio(event.delta);
    }

    if (event.type === "response.function_call_arguments.done") {
      await handleFunctionCall(event);
    }

    const userText =
      event.transcript ||
      event.text ||
      event.item?.content?.[0]?.transcript ||
      event.item?.content?.[0]?.text;

    if (
      event.type === "conversation.item.input_audio_transcription.completed" ||
      event.type === "conversation.item.input_audio_transcription.updated"
    ) {
      if (userText) {
        if (looksLikeInjection(userText)) {
          onEvent({ type: "transcript", role: "user", text: userText });
          send({
            type: "conversation.item.create",
            item: {
              type: "force_message",
              role: "assistant",
              interruptible: true,
              content: [{ type: "output_text", text: REFUSE_HINDI }],
            },
          });
          onEvent({ type: "transcript", role: "assistant", text: REFUSE_HINDI });
          return;
        }
        onEvent({ type: "transcript", role: "user", text: userText });
      }
    }

    if (
      event.type === "response.output_audio_transcript.done" ||
      event.type === "response.audio_transcript.done"
    ) {
      const spoken = sanitizeAssistantText(userText || event.transcript || "");
      if (spoken) {
        onEvent({ type: "transcript", role: "assistant", text: spoken });
      }
    }

    if (event.type === "error") {
      onEvent({ type: "grok_error", error: event.error || event });
    }
  });

  grok.on("error", (err) => {
    onFatal(err);
  });

  grok.on("close", () => {
    close("grok_closed");
  });

  return {
    sendAudio(base64Pcm) {
      if (!base64Pcm || closed) return;
      send({
        type: "input_audio_buffer.append",
        audio: base64Pcm,
      });
    },
    close,
    get closed() {
      return closed;
    },
  };
}
