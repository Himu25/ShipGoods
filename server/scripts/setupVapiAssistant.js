/**
 * Creates (or updates, if VAPI_ASSISTANT_ID is already set) the Vapi
 * Assistant used for the pickup voice calls — Custom LLM pointing at
 * this server's /api/voice/custom-llm and /api/voice/webhook endpoints.
 *
 * Re-run any time PUBLIC_BASE_URL changes (e.g. a new ngrok session).
 *
 * Run: node scripts/setupVapiAssistant.js
 */
import dotenv from "dotenv";
dotenv.config();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL; // e.g. the ngrok https URL
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID; // set after first run, for updates

// Voice provider is configurable — Vapi bills usage directly for 11labs,
// no separate provider credential needed (unlike Azure, which needs its
// own Speech key connected in Vapi's dashboard — likely why the Azure
// hi-IN-SwaraNeural attempt failed silently: the call never reached our
// server at all, meaning it died speaking the first message before any
// custom-llm turn happened). Back to the known-working ElevenLabs voice.
const VOICE_PROVIDER = process.env.VAPI_VOICE_PROVIDER || "11labs";
const VOICE_ID = process.env.VAPI_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // "Rachel"
const VOICE_MODEL = process.env.VAPI_VOICE_MODEL || "eleven_multilingual_v2";

if (!VAPI_API_KEY) {
  console.error("Set VAPI_API_KEY in server/.env");
  process.exit(1);
}
if (!PUBLIC_BASE_URL) {
  console.error(
    "Set PUBLIC_BASE_URL in server/.env to your ngrok (or other public) URL, e.g.\n" +
      "PUBLIC_BASE_URL=https://abcd1234.ngrok-free.app"
  );
  process.exit(1);
}

const assistantConfig = {
  name: "ShipGoods Pickup Assistant",
  model: {
    provider: "custom-llm",
    url: `${PUBLIC_BASE_URL}/api/voice/custom-llm`,
    model: "shipgoods-voice-agent",
    metadataSendMode: "variable",
  },
  voice: VOICE_MODEL
    ? { provider: VOICE_PROVIDER, voiceId: VOICE_ID, model: VOICE_MODEL }
    : { provider: VOICE_PROVIDER, voiceId: VOICE_ID },
  // Hindi — matches the Hindi/Hinglish agent (services/voiceAgent/*).
  transcriber: { provider: "deepgram", language: "hi" },
  // Overridden per-call from IncomingCall.jsx (eta vs arrival greeting) —
  // this is just the fallback if a call ever starts without an override.
  firstMessage: "Namaste! Main Priya bol rahi hoon, ShipGoods se.",
  firstMessageMode: "assistant-speaks-first",
  // Testing phase: no auto-hangup on a pause — only the manual "Hang up"
  // button (IncomingCall.jsx) ends the call. maxDurationSeconds can't be
  // disabled outright (Vapi requires 10-43200), so 1800s (30 min) is just
  // a safety net against a truly abandoned/forgotten call, not a real cap.
  maxDurationSeconds: 1800,
  silenceTimeoutSeconds: 3600, // Vapi's max — effectively off for testing
  server: { url: `${PUBLIC_BASE_URL}/api/voice/webhook` },
};

async function main() {
  const isUpdate = Boolean(VAPI_ASSISTANT_ID);
  const url = isUpdate
    ? `https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`
    : "https://api.vapi.ai/assistant";

  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(assistantConfig),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Vapi API failed: ${res.status}\n${body}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log(isUpdate ? "Updated assistant:" : "Created assistant:", data.id);
  if (!isUpdate) {
    console.log(`\nAdd this to server/.env:\nVAPI_ASSISTANT_ID=${data.id}`);
    console.log(
      `And this to client/.env.local:\nNEXT_PUBLIC_VAPI_ASSISTANT_ID=${data.id}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
