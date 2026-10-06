import express from "express";
import VoiceCall from "../models/VoiceCall.js";
import getRedisClient from "../redisClient.js";
import { getIO } from "../services/socketService.js";
import { runAgentTurn } from "../services/voiceAgent/groqClient.js";

const router = express.Router();

/**
 * Vapi "Custom LLM" endpoint — OpenAI chat-completions shaped in and out.
 * Vapi owns STT/TTS/turn-taking (this is what actually fixed the
 * robotic-sounding voice — Vapi's voice providers vs. Sarvam directly);
 * this endpoint is still the entire brain — same Hindi Groq agent,
 * guardrails, and Google Maps-backed tools (getDriverLocation,
 * getDestinationETA, findCarLandmark, etc.) used by the browser-STT
 * pipeline, unchanged. Only the transport changed.
 *
 * NOTE: exact field paths for call metadata (voiceCallId/bookingId/
 * driverId/userId, set when the browser starts the call) are checked
 * defensively below since they weren't verified against a live Vapi
 * request in this session — adjust once ngrok shows a real payload.
 */
router.post("/voice/custom-llm", async (req, res) => {
  const wantsStream = req.body?.stream === true;
  console.log(
    `custom-llm hit: stream=${wantsStream} messages=${req.body?.messages?.length} metadata=${JSON.stringify(
      req.body?.call?.metadata || req.body?.metadata || null
    )}`
  );

  const fallback = (content) => {
    if (wantsStream) {
      // Vapi (like most OpenAI-compatible voice platforms) defaults to
      // requesting a stream for low-latency playback. A single plain
      // JSON response to a streaming request is likely why dynamic
      // turns were silently failing — this sends one SSE chunk with
      // the full text, which satisfies a stream-shaped client even
      // though we're not token-streaming internally.
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const base = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: req.body?.model || "shipgoods-voice-agent",
      };
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    return res.status(200).json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.body?.model || "shipgoods-voice-agent",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    });
  };

  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const meta =
      req.body?.call?.metadata || req.body?.metadata || req.body?.assistantOverrides?.metadata || {};
    const { voiceCallId, bookingId, userId } = meta;

    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    const userText = lastUserIndex >= 0 ? String(messages[lastUserIndex].content || "") : "";
    const history = messages
      .filter((m, i) => i !== lastUserIndex && m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const ctx = { callId: voiceCallId, bookingId, userId, redis: getRedisClient(), io: getIO() };
    const { reply, toolCalls } = await runAgentTurn({ ctx, history, userText });

    if (voiceCallId) {
      VoiceCall.findOneAndUpdate(
        { _id: voiceCallId, status: "ringing" },
        { status: "active", answeredAt: new Date() }
      ).catch(() => {});
      VoiceCall.findByIdAndUpdate(voiceCallId, {
        $push: {
          transcript: {
            $each: [
              { role: "user", text: userText },
              { role: "assistant", text: reply },
            ],
          },
          toolCalls: {
            $each: toolCalls.map((tc) => ({
              name: tc.name,
              args: tc.args,
              result: tc.result,
              ok: tc.ok,
            })),
          },
        },
      }).catch((err) => console.error("VoiceCall transcript save failed:", err.message));
    }

    return fallback(reply);
  } catch (err) {
    console.error("custom-llm error:", err.message);
    return fallback("Sorry, I'm having trouble right now. I'll let your driver know.");
  }
});

/**
 * Vapi server webhook — call lifecycle + transcript events. Always
 * acknowledges 200 so Vapi doesn't retry/alert on our parsing issues;
 * failures here should never break the live call.
 */
router.post("/voice/webhook", async (req, res) => {
  try {
    const msg = req.body?.message || req.body;
    const meta = msg?.call?.metadata || {};
    const voiceCallId = meta.voiceCallId;
    const type = msg?.type;
    console.log(`voice webhook: type=${type} endedReason=${msg?.endedReason} voiceCallId=${voiceCallId}`);

    if (voiceCallId && type === "end-of-call-report") {
      await VoiceCall.findOneAndUpdate(
        { _id: voiceCallId, status: { $in: ["ringing", "active"] } },
        {
          status: "completed",
          endedAt: new Date(),
          endedReason: msg.endedReason || "call_ended",
        }
      );
    }
  } catch (err) {
    console.error("voice webhook error:", err.message);
  }
  res.status(200).json({ received: true });
});

export default router;
