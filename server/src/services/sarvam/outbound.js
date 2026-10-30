// Sarvam Instant Outbound API — Sarvam dials the customer and runs the
// whole conversation (STT, LLM, TTS); we only start the call and pass
// the per-call variables the agent's greeting/prompt reference.
// https://docs.sarvam.ai/voice-agents/api/instant-outbound/create

const SARVAM_APPS_BASE = "https://apps.sarvam.ai/api/outbounds/v1";
const REQUEST_TIMEOUT_MS = 15000;

const REQUIRED_ENV = [
  "SARVAM_API_KEY",
  "SARVAM_ORG_ID",
  "SARVAM_WORKSPACE_ID",
  "SARVAM_APP_ID",
  "SARVAM_APP_VERSION",
  "SARVAM_CONNECTION_ID",
  "SARVAM_AGENT_PHONE_NUMBER",
  "PUBLIC_BASE_URL",
  "SARVAM_TOOL_SECRET",
];

export function missingSarvamConfig() {
  return REQUIRED_ENV.filter((key) => !String(process.env[key] || "").trim());
}

export function isSarvamConfigured() {
  return missingSarvamConfig().length === 0;
}

/** Bare 10-digit Indian numbers become +91XXXXXXXXXX; anything else must
 * already be E.164. Returns null if it can't be a dialable number. */
export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

export function webhookUrl() {
  return `${process.env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/voice/sarvam-webhook`;
}

/**
 * Starts one outbound call. `variables` must match the agent variables
 * configured on the Sarvam agent (callId, bookingId, driverName,
 * vehicleNo, etaMinutes). `metadata` is echoed back on the end-of-call
 * webhook. Resolves to Sarvam's attempt_id; throws on any failure.
 */
export async function placeOutboundCall({ phone, variables, metadata }) {
  const missing = missingSarvamConfig();
  if (missing.length) {
    throw new Error(`Sarvam not configured (missing ${missing.join(", ")})`);
  }

  const url = `${SARVAM_APPS_BASE}/orgs/${encodeURIComponent(
    process.env.SARVAM_ORG_ID
  )}/workspaces/${encodeURIComponent(process.env.SARVAM_WORKSPACE_ID)}/outbounds`;

  const body = {
    app_config: {
      app_id: process.env.SARVAM_APP_ID,
      app_version: Number(process.env.SARVAM_APP_VERSION),
      connection_config: {
        connection_id: process.env.SARVAM_CONNECTION_ID,
        agent_phone_number: process.env.SARVAM_AGENT_PHONE_NUMBER,
      },
      // Sarvam substitutes these into {{...}} in the greeting/prompt;
      // stringified so templates never render "undefined" or objects.
      agent_variables: Object.fromEntries(
        Object.entries(variables || {}).map(([k, v]) => [k, v == null ? "" : String(v)])
      ),
    },
    user_config: { user_phone_number: phone },
    webhook_config: { url: webhookUrl(), metadata: metadata || {} },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": process.env.SARVAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body — reported below */
  }

  if (!res.ok || !data?.attempt_id) {
    const detail = data?.detail ? JSON.stringify(data.detail) : text.slice(0, 300);
    throw new Error(`Sarvam outbound failed (${res.status}): ${detail}`);
  }
  return data.attempt_id;
}
