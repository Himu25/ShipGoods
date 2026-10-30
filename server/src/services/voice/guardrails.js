// Provider-agnostic text guardrails shared by the in-app Hindi agent
// (services/voiceAgent). The Sarvam phone agent's prompt lives in Sarvam.

export const REFUSE_HINDI =
  "Maaf kijiye, main sirf is booking ke pickup ke baare mein madad kar sakta hoon.";

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|above|prior) instructions/i,
  /system prompt/i,
  /you are now/i,
  /jailbreak/i,
  /\bDAN\b/,
  /reveal (your )?(hidden )?prompt/i,
  /api[_\s-]?key/i,
  /developer mode/i,
  /override (your )?rules/i,
  /pretend you are/i,
];

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{10,}/,
  /xai-[A-Za-z0-9]{10,}/,
  /bearer\s+[A-Za-z0-9._-]+/i,
  /password\s*[:=]/i,
  /paymentId/i,
];

export function looksLikeInjection(text = "") {
  const sample = String(text).slice(0, 2000);
  return INJECTION_PATTERNS.some((re) => re.test(sample));
}

export function redactSecrets(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    let out = value;
    for (const re of SECRET_PATTERNS) {
      out = out.replace(re, "[redacted]");
    }
    return out.replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[redacted-email]"
    );
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    const copy = {};
    for (const [k, v] of Object.entries(value)) {
      if (["password", "paymentId", "email", "token"].includes(k)) {
        copy[k] = "[redacted]";
      } else {
        copy[k] = redactSecrets(v);
      }
    }
    return copy;
  }
  return value;
}

/** Strips markdown the LLM tends to add (**bold**, `code`, # headers) —
 * harmless in a text chat UI, but TTS either reads the asterisks aloud
 * or garbles on them, so spoken output needs plain text. */
function stripMarkdown(text) {
  return String(text)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();
}

export function sanitizeAssistantText(text = "", refusalText = REFUSE_HINDI) {
  const redacted = redactSecrets(text);
  if (SECRET_PATTERNS.some((re) => re.test(String(text)))) {
    return refusalText;
  }
  return stripMarkdown(redacted);
}

export function firstName(name = "") {
  return String(name).trim().split(/\s+/)[0] || "Customer";
}
