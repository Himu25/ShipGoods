import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Booking from "../../models/Booking.js";
import User from "../../models/User.js";
import Vehicle from "../../models/Vehicle.js";
import VoiceCall from "../../models/VoiceCall.js";

void Vehicle;
import { haversineMeters, pickupLatLng } from "./geo.js";
import {
  firstName,
  redactSecrets,
  validateToolArgs,
} from "./guardrails.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAQ_PATH = path.resolve(__dirname, "../../../knowledge/pickup-faq.md");

const DRIVER_MESSAGES = {
  coming_down: "Customer is coming down with the goods.",
  need_five_minutes: "Customer needs about 5 more minutes.",
  need_help: "Customer needs help finding you at pickup.",
};

function searchLocalFaq(query) {
  let raw = "";
  try {
    raw = fs.readFileSync(FAQ_PATH, "utf8");
  } catch {
    return { snippets: [] };
  }
  const chunks = raw
    .split(/\n(?=## )/)
    .map((c) => c.trim())
    .filter(Boolean);
  const terms = String(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const scored = chunks
    .map((chunk) => {
      const lower = chunk.toLowerCase();
      const score = terms.reduce(
        (sum, t) => sum + (lower.includes(t) ? 1 : 0),
        0
      );
      return { chunk, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.chunk.slice(0, 400));
  if (!scored.length) {
    return { snippets: chunks.slice(0, 2).map((c) => c.slice(0, 400)) };
  }
  return { snippets: scored };
}

export const GROK_TOOLS = [
  {
    type: "function",
    name: "get_trip_summary",
    description:
      "Get this booking's pickup summary: customer first name, pickup text, driver name, vehicle, status.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_driver_eta",
    description:
      "Get remaining distance (meters) and a route-based ETA (minutes) from the live driver location to pickup. This is a distance/road-speed estimate, NOT live traffic — say so if asked about traffic.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "notify_driver",
    description:
      "Send a short pickup update to the assigned driver. coming_down, need_five_minutes, or need_help.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          enum: ["coming_down", "need_five_minutes", "need_help"],
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "confirm_user_ready",
    description:
      "Mark that the customer acknowledged the driver has arrived and is coming to collect goods. Does not mark the booking collected.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "search_pickup_policy",
    description:
      "Search ShipGoods pickup wait-time, identification, safety, and goods-not-ready policy.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

async function getTripSummary(ctx) {
  const booking = await Booking.findById(ctx.bookingId)
    .populate("driverId")
    .populate("vehicleId")
    .lean();
  const user = await User.findById(ctx.userId).lean();
  const driver = booking?.driverId;
  const vehicle = booking?.vehicleId;
  return {
    customerFirstName: firstName(user?.name),
    pickup: booking?.srcText || "pickup location",
    status: booking?.status,
    driverFirstName: firstName(driver?.name),
    vehicleType: vehicle?.type || null,
    vehiclePlate: vehicle?.numberPlate || null,
  };
}

const OSRM = "https://router.project-osrm.org/route/v1/driving";

/** Real road route (distance + typical-road-speed duration) via OSRM —
 * the same free, keyless service already used in driveToPickup.js,
 * DriverMap.js, and DriverTracking.jsx. This is NOT live traffic; it's
 * a distance-and-road-type estimate. Callers must be honest about that
 * (see AGENT_INSTRUCTIONS_EN in guardrails.js). */
async function fetchRoadRoute(lat1, lng1, lat2, lng2) {
  const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=false`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const route = data?.routes?.[0];
    if (data.code !== "Ok" || !route) return null;
    return { distanceMeters: route.distance, durationSeconds: route.duration };
  } catch {
    return null;
  }
}

async function getDriverEta(ctx) {
  const booking = await Booking.findById(ctx.bookingId).lean();
  const pickup = pickupLatLng(booking?.src);
  const raw = await ctx.redis.get(`driver:${ctx.driverId}:location`);
  let location = null;
  if (raw) {
    try {
      location = JSON.parse(raw);
    } catch {
      location = null;
    }
  }
  if (!pickup || !location) {
    return { remainingMeters: null, etaMinutes: null, arrived: false };
  }

  const lat = Number(location.latitude);
  const lng = Number(location.longitude);
  const straightLineMeters = haversineMeters(lat, lng, pickup.lat, pickup.lng);

  const route = await fetchRoadRoute(lat, lng, pickup.lat, pickup.lng);
  const remainingMeters = Math.round(route?.distanceMeters ?? straightLineMeters);
  const etaMinutes = route ? Math.max(1, Math.round(route.durationSeconds / 60)) : null;

  return {
    remainingMeters,
    etaMinutes,
    arrived: remainingMeters <= 30,
    note: "Route-based estimate from distance and typical road speeds — does not account for current traffic.",
  };
}

async function notifyDriver(ctx, messageKey) {
  const text = DRIVER_MESSAGES[messageKey];
  if (ctx.io && ctx.driverId) {
    ctx.io.to(`driver:${ctx.driverId}`).emit("userPickupUpdate", {
      bookingId: String(ctx.bookingId),
      messageKey,
      text,
    });
  }
  return { sent: true, message: text };
}

async function confirmUserReady(ctx) {
  await VoiceCall.findByIdAndUpdate(ctx.callId, {
    acknowledged: true,
  });
  if (ctx.io && ctx.driverId) {
    ctx.io.to(`driver:${ctx.driverId}`).emit("userPickupUpdate", {
      bookingId: String(ctx.bookingId),
      messageKey: "coming_down",
      text: DRIVER_MESSAGES.coming_down,
    });
  }
  return { acknowledged: true };
}

export async function executeTool(name, rawArgs, ctx) {
  const checked = validateToolArgs(name, rawArgs);
  if (!checked.ok) {
    return {
      ok: false,
      result: { error: "tool_not_allowed" },
    };
  }

  let result;
  switch (name) {
    case "get_trip_summary":
      result = await getTripSummary(ctx);
      break;
    case "get_driver_eta":
      result = await getDriverEta(ctx);
      break;
    case "notify_driver":
      result = await notifyDriver(ctx, checked.args.message);
      break;
    case "confirm_user_ready":
      result = await confirmUserReady(ctx);
      break;
    case "search_pickup_policy":
      result = searchLocalFaq(checked.args.query);
      break;
    default:
      return { ok: false, result: { error: "tool_not_allowed" } };
  }

  const safe = redactSecrets(result);
  try {
    await VoiceCall.findByIdAndUpdate(ctx.callId, {
      $push: {
        toolCalls: {
          name,
          args: redactSecrets(checked.args),
          result: safe,
          ok: true,
        },
      },
    });
  } catch {
    /* audit best-effort */
  }
  return { ok: true, result: safe };
}
