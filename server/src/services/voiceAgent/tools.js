import {
  loadBookingForUser,
  getBookingStatus,
  getVehicleDetails,
  getDriverDetails,
  getDriverLocation,
  getDestinationETA,
  findCarLandmark,
  shareUserLocationWithDriver,
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
    description: "Get how far (meters) and in what direction the driver currently is from the relevant point (pickup, or destination if goods are already collected), how fresh that location is, and `movement` ('approaching' | 'moving_away' | 'stationary' | null) compared to the last time you checked in this call.",
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
      "Call this when the user says they can't find/see the car (e.g. 'car find nahi kar pa raha', 'yeh nahi dikh raha'). Returns ONE nearby landmark near the car's live location per call (max 3 attempts total) — call it again each time the user says the previous landmark didn't help. Pass `userDescription` whenever the user has described what they can see around them (e.g. 'ek medical store dikh raha hai') — the tool will try to match it against real nearby places instead of guessing. Pass `forceEscalate: true` instead of a normal call if the user sounds unsafe/scared — this skips straight to notifying the driver. The result may include `direction` (cardinal direction of the car from the user), `movement` ('closer' | 'away' | null vs the user's position on the previous attempt), and `matchedFromDescription` (true if the returned landmark matches what the user said they saw) — lead your reply with direction/movement, and mention the landmark as secondary confirmation. If `tooFar` is true, relay that message verbatim and do not suggest a landmark yet. After max attempts (or on forceEscalate) it returns exhausted:true with a fixed message to relay verbatim — the driver has also been notified to call the customer directly at that point.",
    parameters: {
      type: "object",
      properties: {
        userDescription: {
          type: "string",
          description: "What the user said they can see around them right now, in their own words (optional).",
        },
        forceEscalate: {
          type: "boolean",
          description: "Set true only if the user sounds unsafe/scared and needs the driver called immediately instead of another landmark attempt.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "shareUserLocationWithDriver",
    description:
      "Call this when the user tells you WHERE THEY are standing (e.g. 'main HDFC Bank ke saamne khada hoon') rather than asking where the car is. Relays their description straight to the driver's app so the driver can find them, instead of running the car-finder flow.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "The user's own description of where they're standing, verbatim or lightly cleaned up.",
        },
      },
      required: ["description"],
      additionalProperties: false,
    },
  },
];

const ALLOWED = new Set(AGENT_TOOLS.map((t) => t.name));

/** Every call re-verifies booking ownership before touching any data —
 * this is "prevent access to another user's booking" as code, not just
 * a prompt instruction. */
export async function executeAgentTool(name, args, ctx) {
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
        result: await findCarLandmark(booking, ctx.redis, ctx.callId, ctx.io, {
          userLat: ctx.userLat,
          userLng: ctx.userLng,
          userDescription: args?.userDescription,
          forceEscalate: Boolean(args?.forceEscalate),
        }),
      };
    case "shareUserLocationWithDriver":
      return {
        ok: true,
        result: shareUserLocationWithDriver(booking, ctx.io, args?.description),
      };
    default:
      return { ok: false, result: { error: "unknown_tool" } };
  }
}
