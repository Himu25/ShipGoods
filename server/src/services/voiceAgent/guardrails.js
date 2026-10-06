// Reuse the generic, provider-agnostic primitives already built and
// tested for the pickup-call agent — injection detection and secret
// redaction don't care which LLM or language is on the other end.
export { looksLikeInjection, redactSecrets, sanitizeAssistantText } from "../voice/guardrails.js";

// All actual text (prompt, greetings, refusals) lives in constants.js —
// re-exported here so existing imports of guardrails.js keep working.
export {
  AGENT_NAME,
  AGENT_INSTRUCTIONS_HI,
  REFUSE_HI,
  FORBIDDEN_HI,
  UNAVAILABLE_HI,
  ETA_GREETING_HI,
  ARRIVAL_GREETING_HI,
} from "./constants.js";
