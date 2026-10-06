import {
  loadBookingForUser,
  getBookingStatus,
  getVehicleDetails,
  getDriverDetails,
  getDriverLocation,
  getDestinationETA,
  findCarLandmark,
} from "./tripService.js";
import { FORBIDDEN_HI } from "./guardrails.js";

// Exact tool names/shape requested — the LLM never touches Mongo/Redis
// directly, only these, which go through tripService.js.
export const AGENT_TOOLS = [
  {
    name: "getBookingStatus",
    description: "Get this booking's current status (pending/accepted/arrived/collected/completed/cancelled) and pickup/destination text.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "getVehicleDetails",
    description: "Get the assigned vehicle's type, number plate, and model for this booking.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "getDriverDetails",
    description: "Get the assigned driver's first name for this booking.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "getDriverLocation",
    description: "Get how far (meters) and in what direction the driver currently is from the relevant point (pickup, or destination if goods are already collected), and how fresh that location is.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "getDestinationETA",
    description: "Get a traffic-aware ETA (minutes), remaining distance, and traffic condition (light/moderate/heavy) to the relevant point (pickup, or destination if goods are already collected).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "findCarLandmark",
    description:
      "Call this when the user says they can't find/see the car (e.g. 'car find nahi kar pa raha', 'yeh nahi dikh raha'). Returns ONE nearby landmark near the car's live location per call (max 3 attempts total) — call it again each time the user says the previous landmark didn't help. The result may include `direction` (which cardinal direction the car is from the user, e.g. 'uttar') and `movement` ('closer' | 'away' | null vs the user's position on the previous attempt) — lead your reply with this directional guidance (e.g. tell them to turn around if movement is 'away'), and mention the landmark as secondary confirmation, not the headline. If `tooFar` is true, relay that message verbatim and do not suggest a landmark yet. After max attempts it returns exhausted:true with a fixed message to relay verbatim — the driver has also been notified to call the customer directly at that point.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

const ALLOWED = new Set(AGENT_TOOLS.map((t) => t.name));

/** Every call re-verifies booking ownership before touching any data —
 * this is "prevent access to another user's booking" as code, not just
 * a prompt instruction. */
export async function executeAgentTool(name, _args, ctx) {
  if (!ALLOWED.has(name)) {
    return { ok: false, result: { error: "unknown_tool" } };
  }

  const { booking, error } = await loadBookingForUser(ctx.bookingId, ctx.userId);
  if (error === "forbidden") {
    return { ok: false, result: { error: "forbidden", message: FORBIDDEN_HI } };
  }
  if (error === "not_found" || !booking) {
    return { ok: false, result: { error: "not_found" } };
  }

  switch (name) {
    case "getBookingStatus":
      return { ok: true, result: getBookingStatus(booking) };
    case "getVehicleDetails":
      return { ok: true, result: getVehicleDetails(booking) };
    case "getDriverDetails":
      return { ok: true, result: getDriverDetails(booking) };
    case "getDriverLocation":
      return { ok: true, result: await getDriverLocation(booking, ctx.redis) };
    case "getDestinationETA":
      return { ok: true, result: await getDestinationETA(booking, ctx.redis) };
    case "findCarLandmark":
      return {
        ok: true,
        result: await findCarLandmark(booking, ctx.redis, ctx.callId, ctx.io, ctx.userLat, ctx.userLng),
      };
    default:
      return { ok: false, result: { error: "unknown_tool" } };
  }
}
