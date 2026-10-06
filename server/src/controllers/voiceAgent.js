import getRedisClient from "../redisClient.js";
import VoiceCall from "../models/VoiceCall.js";
import { getIO } from "../services/socketService.js";
import { runAgentTurn } from "../services/voiceAgent/groqClient.js";
import { GENERIC_TROUBLE_REPLY_HI } from "../services/voiceAgent/constants.js";

// MVP conversation memory: in-process, per (user, booking). Fine for a
// single server instance; would need Redis instead to survive a restart
// or run behind more than one instance.
const sessions = new Map();
const sessionKey = (userId, bookingId) => `${userId}:${bookingId}`;
const MAX_HISTORY_TURNS = 20;

export const chatWithAgent = async (req, res) => {
  try {
    const { bookingId, callId, text, userLat, userLng } = req.body;
    if (!bookingId || !text) {
      return res.status(400).json({ message: "bookingId and text are required." });
    }

    // req.user comes from authenticateToken (JWT) — never trust a
    // client-supplied userId here, same reasoning as the socket auth
    // hardening done earlier this session.
    const userId = req.user.id;
    const key = sessionKey(userId, bookingId);
    const history = sessions.get(key) || [];

    // Rider's live GPS position, when the browser granted permission —
    // only used by findCarLandmark for directional guidance; every other
    // tool is unaffected if these are undefined.
    const lat = Number.isFinite(userLat) ? userLat : undefined;
    const lng = Number.isFinite(userLng) ? userLng : undefined;
    const ctx = { userId, bookingId, callId, redis: getRedisClient(), io: getIO(), userLat: lat, userLng: lng };
    const { reply, toolCalls, refused } = await runAgentTurn({ ctx, history, userText: text });

    if (!refused) {
      const nextHistory = [
        ...history,
        { role: "user", content: text },
        { role: "assistant", content: reply },
      ].slice(-MAX_HISTORY_TURNS);
      sessions.set(key, nextHistory);
    }

    if (callId) {
      // First real turn flips ringing -> active; every turn is logged to
      // VoiceCall for the eval/audit trail (transcript + toolCalls),
      // same shape the arrival-call pipeline already uses.
      VoiceCall.findOneAndUpdate(
        { _id: callId, status: "ringing" },
        { status: "active", answeredAt: new Date() }
      ).catch(() => {});
      VoiceCall.findByIdAndUpdate(callId, {
        $push: {
          transcript: {
            $each: [
              { role: "user", text },
              { role: "assistant", text: reply },
            ],
          },
          toolCalls: {
            $each: toolCalls.map((t) => ({ name: t.name, args: t.args, result: t.result, ok: t.ok })),
          },
        },
      }).catch((err) => console.error("VoiceCall transcript save failed:", err.message));
    }

    res.status(200).json({
      reply,
      toolCalls: toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
    });
  } catch (error) {
    console.error("voiceAgent chat error:", error.message);
    res.status(500).json({
      message: "Agent error.",
      reply: GENERIC_TROUBLE_REPLY_HI,
    });
  }
};

export const endAgentCall = async (req, res) => {
  try {
    const { callId } = req.body;
    if (!callId) {
      return res.status(400).json({ message: "callId is required." });
    }
    await VoiceCall.findOneAndUpdate(
      { _id: callId, status: { $in: ["ringing", "active"] } },
      { status: "completed", endedAt: new Date(), endedReason: "hangup" }
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("voiceAgent end error:", error.message);
    res.status(500).json({ message: "Failed to end call." });
  }
};

export const synthesizeSpeech = async (req, res) => {
  try {
    const { text, speaker } = req.body;
    if (!text) {
      return res.status(400).json({ message: "text is required." });
    }
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ message: "TTS is not configured (SARVAM_API_KEY missing)." });
    }

    const sarvamRes = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        language_code: process.env.SARVAM_LANGUAGE_CODE || "hi-IN",
        // bulbul:v2 is deprecated per Sarvam's API (confirmed live) — v3
        // is current and uses a different speaker set ("shubh" default).
        model: process.env.SARVAM_TTS_MODEL || "bulbul:v3",
        // Male voice — matches the masculine Hindi grammar used throughout
        // constants.js ("kar sakta hoon" etc.) and the agent's name
        // (Shubh) introduced in the opening greeting. Keep both in sync
        // if this ever changes again.
        speaker: speaker || process.env.SARVAM_SPEAKER || "shubh",
      }),
    });

    if (!sarvamRes.ok) {
      const body = await sarvamRes.text().catch(() => "");
      console.error("Sarvam TTS failed:", sarvamRes.status, body);
      return res.status(502).json({ message: "TTS request failed." });
    }

    const data = await sarvamRes.json();
    const audioBase64 = data.audios?.[0];
    if (!audioBase64) {
      return res.status(502).json({ message: "TTS returned no audio." });
    }
    res.status(200).json({ audioBase64 });
  } catch (error) {
    console.error("voiceAgent tts error:", error.message);
    res.status(500).json({ message: "TTS error." });
  }
};
