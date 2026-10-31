import mongoose from "mongoose";
import Booking from "../../models/Booking.js";
import VoiceCall from "../../models/VoiceCall.js";
import { haversineMeters, pickupLatLng } from "./geo.js";
import { firstName } from "./guardrails.js";
import { estimateRoute } from "../voiceAgent/tripService.js";
import { ETA_GREETING_HI } from "../voiceAgent/guardrails.js";
import { dialNumberFor, isSarvamConfigured, placeOutboundCall } from "../sarvam/outbound.js";
import { spokenPlate } from "./spokenHindi.js";

export const ARRIVE_METERS = 30;
// Only ask a routing API for an ETA once the driver is plausibly within
// the call window (6 min at ~80 km/h) — avoids a routing call per GPS tick
// for a driver who is still across the city.
const ETA_CHECK_MAX_METERS = 8000;
const ETA_CHECK_THROTTLE_SEC = 15;
const TRIGGER_TTL_SEC = 2 * 60 * 60;
// Used only when no routing source answers — rough city speed, so the
// greeting still has a sensible "lagbhag N minute".
const FALLBACK_CITY_SPEED_KMPH = 20;
const MAX_RETRIES = 1;

// Read at call time so a changed env (tests, restarts) is always honoured.
function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const callEtaMinutes = () => envNumber("PICKUP_CALL_ETA_MINUTES", 6);
const callDistanceMeters = () => envNumber("PICKUP_CALL_DISTANCE_METERS", 2000);
const retryAfterMs = () => envNumber("PICKUP_CALL_RETRY_AFTER_MS", 60000);
const voiceCallsEnabled = () => process.env.VOICE_CALLS_ENABLED === "true";

export async function cacheActiveTrip(redis, trip) {
  const { driverId, userId, bookingId, pickupLat, pickupLng } = trip;
  if (!driverId || !userId || !bookingId) return;
  await redis.set(
    `driverActiveTrip:${driverId}`,
    JSON.stringify({
      userId: String(userId),
      bookingId: String(bookingId),
      pickupLat,
      pickupLng,
    })
  );
}

export async function clearActiveTrip(redis, driverId) {
  if (!driverId) return;
  // Also drop the driver->rider routing key. Without this, a driver who
  // goes on to a new (or no) trip keeps pushing live location updates to
  // the rider from the just-finished trip, since driverLocationUpdate
  // looks this key up on every tick.
  await redis.del(`driverActiveTrip:${driverId}`, `driverAssignedToUser:${driverId}`);
}

async function loadActiveTrip(redis, driverId, userId) {
  const cached = await redis.get(`driverActiveTrip:${driverId}`);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      /* fall through */
    }
  }

  const booking = await Booking.findOne({
    driverId,
    userId,
    status: { $in: ["accepted", "arrived"] },
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!booking) return null;
  const pickup = pickupLatLng(booking.src);
  if (!pickup) return null;

  const trip = {
    userId: String(booking.userId),
    bookingId: String(booking._id),
    pickupLat: pickup.lat,
    pickupLng: pickup.lng,
  };
  await cacheActiveTrip(redis, { driverId, ...trip });
  return trip;
}

function emitToBoth(io, booking, event, payload) {
  if (!io) return;
  // "user:<id>" / "driver:<id>" are Socket.IO rooms (see socketService.js).
  io.to(`user:${booking.userId?._id || booking.userId}`).emit(event, payload);
  if (booking.driverId) {
    io.to(`driver:${booking.driverId?._id || booking.driverId}`).emit(event, payload);
  }
}

/** Driver is at pickup: no call — just mark the booking and let both
 * apps know (the rider app shows the "driver has arrived" notification). */
async function markArrived(io, booking) {
  booking.status = "arrived";
  booking.arrivedTime = new Date();
  await booking.save();
  emitToBoth(io, booking, "statusUpdated", {
    bookingId: String(booking._id),
    newStatus: "arrived",
  });
}

function estimateEtaFromDistance(distanceM) {
  return Math.max(1, Math.round((distanceM / 1000 / FALLBACK_CITY_SPEED_KMPH) * 60));
}

async function liveDriverLocation(redis, driverId) {
  const raw = await redis.get(`driver:${driverId}:location`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Fresh ETA to pickup from the driver's live position, for the greeting
 * on a retry. Falls back to the ETA recorded when the call was triggered. */
async function currentEtaMinutes(redis, booking, call) {
  const pickup = pickupLatLng(booking.src);
  const loc = booking.driverId ? await liveDriverLocation(redis, booking.driverId._id) : null;
  if (pickup && loc) {
    const route = await estimateRoute(loc.latitude, loc.longitude, pickup.lat, pickup.lng);
    if (route) return route.etaMinutes;
    return estimateEtaFromDistance(
      haversineMeters(loc.latitude, loc.longitude, pickup.lat, pickup.lng)
    );
  }
  return call.triggerEtaMinutes || estimateEtaFromDistance(call.triggerDistanceM || 0);
}

function inAppGreeting({ driverName, vehicleNo, etaMinutes }) {
  if (!driverName) return ETA_GREETING_HI;
  return `Namaste! Main Shubh bol raha hoon, ShipGoods se. Aapke driver ${driverName} lagbhag ${etaMinutes} minute mein pickup par pahunch rahe hain${
    vehicleNo ? `, gaadi number ${vehicleNo}` : ""
  }. Kripya apna saman ready rakhiye.`;
}

/**
 * Places one attempt for an existing VoiceCall: a real phone call through
 * Sarvam when it's configured and the customer has a number, otherwise
 * (or if Sarvam rejects the request) the in-app ring as a fallback.
 * The call's status must already be "ringing".
 */
async function dialPickupCall(callId, { io, redis, etaMinutes }) {
  const call = await VoiceCall.findById(callId);
  if (!call) return null;
  const booking = await Booking.findById(call.bookingId)
    .populate("userId", "name phone")
    .populate("driverId", "name")
    .populate("vehicleId", "numberPlate model type")
    .lean();
  if (!booking) return null;

  const eta = etaMinutes ?? (await currentEtaMinutes(redis, booking, call));
  const variables = {
    callId: String(call._id),
    bookingId: String(booking._id),
    driverName: booking.driverId?.name ? firstName(booking.driverId.name) : "",
    vehicleNo: spokenPlate(booking.vehicleId?.numberPlate),
    etaMinutes: eta,
  };

  // Only verified numbers are ever rung (see dialNumberFor).
  const { phone, reason } = dialNumberFor(booking.userId?.phone);
  if (isSarvamConfigured() && phone) {
    try {
      const attemptId = await placeOutboundCall({
        phone,
        variables,
        // Echoed back on the end-of-call webhook — that's how it's matched
        // and authenticated (Sarvam documents no webhook signature).
        metadata: { callId: String(call._id), secret: process.env.SARVAM_TOOL_SECRET },
      });
      await VoiceCall.updateOne(
        { _id: call._id },
        { $set: { channel: "sarvam", sarvamAttemptId: attemptId } }
      );
      console.log(
        `Pickup call placed via Sarvam: booking=${booking._id} call=${call._id} attempt=${attemptId} retry=${call.retryCount}`
      );
      if (io && booking.driverId) {
        io.to(`driver:${booking.driverId._id}`).emit("voiceCallRinging", {
          callId: String(call._id),
          bookingId: String(booking._id),
          channel: "sarvam",
        });
      }
      return call;
    } catch (err) {
      console.error(`Sarvam call failed, using in-app ring: ${err.message}`);
    }
  } else {
    console.warn(
      `Pickup call for booking ${booking._id} using in-app ring (${
        !phone ? reason : "Sarvam not configured"
      })`
    );
  }

  await VoiceCall.updateOne({ _id: call._id }, { $set: { channel: "in_app" } });
  const payload = {
    callId: String(call._id),
    bookingId: String(booking._id),
    driverId: String(booking.driverId?._id || ""),
    distanceM: Math.round(call.triggerDistanceM || 0),
    callType: "pickup",
    message: inAppGreeting({ ...variables, etaMinutes: eta }),
  };
  if (io) {
    io.to(`user:${booking.userId._id}`).emit("incomingVoiceCall", payload);
    if (booking.driverId) io.to(`driver:${booking.driverId._id}`).emit("voiceCallRinging", payload);
  }
  return call;
}

/** Creates the one pickup VoiceCall for a booking and dials it. Exported
 * for scripts/testCall.js; normal callers go through the location tick. */
export async function startPickupCall({ io, redis, bookingId, userId, driverId, distanceM, etaMinutes }) {
  const call = await VoiceCall.create({
    bookingId,
    userId,
    driverId,
    status: "ringing",
    callType: "pickup",
    triggerDistanceM: distanceM,
    triggerEtaMinutes: etaMinutes,
    retryCount: 0,
  });
  await dialPickupCall(call._id, { io, redis, etaMinutes });
  return VoiceCall.findById(call._id);
}

async function maybeStartPickupCall({ io, redis, driverId, trip, latitude, longitude, distanceM }) {
  if (await VoiceCall.exists({ bookingId: trip.bookingId, callType: "pickup" })) return;

  // At most one ETA lookup per booking every few seconds.
  const mayCheck = await redis.set(
    `voice:pickup:etaCheck:${trip.bookingId}`,
    "1",
    "EX",
    ETA_CHECK_THROTTLE_SEC,
    "NX"
  );
  if (!mayCheck) return;

  const route = await estimateRoute(latitude, longitude, trip.pickupLat, trip.pickupLng);
  // ETA is the primary rule; straight-line distance only when no routing
  // source answered.
  const shouldCall = route
    ? route.etaMinutes <= callEtaMinutes()
    : distanceM <= callDistanceMeters();
  if (!shouldCall) return;

  // One call per booking, even across server instances / racing ticks.
  const first = await redis.set(
    `voice:pickup:triggered:${trip.bookingId}`,
    "1",
    "EX",
    TRIGGER_TTL_SEC,
    "NX"
  );
  if (!first) return;

  await startPickupCall({
    io,
    redis,
    bookingId: trip.bookingId,
    userId: trip.userId,
    driverId,
    distanceM: Math.round(distanceM),
    etaMinutes: route ? route.etaMinutes : estimateEtaFromDistance(distanceM),
  });
}

export async function maybeTriggerArrivalCall({ io, redis, driverId, latitude, longitude }) {
  if (!driverId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return;
  }

  const userId = await redis.get(`driverAssignedToUser:${driverId}`);
  if (!userId) return;

  const trip = await loadActiveTrip(redis, driverId, userId);
  if (!trip) return;

  const distanceM = haversineMeters(latitude, longitude, trip.pickupLat, trip.pickupLng);
  if (distanceM > ETA_CHECK_MAX_METERS) return;

  // Only an accepted, not-yet-arrived booking can get the call; this also
  // covers cancellation (status "cancelled" never matches).
  const booking = await Booking.findById(trip.bookingId);
  if (!booking || booking.status !== "accepted") return;

  if (distanceM <= ARRIVE_METERS) {
    await markArrived(io, booking);
    return;
  }

  if (!voiceCallsEnabled()) return;
  await maybeStartPickupCall({ io, redis, driverId, trip, latitude, longitude, distanceM });
}

/** Driver just accepted: if they're already inside the call window, call
 * now instead of waiting for their next location tick. */
export async function checkPickupCallOnAccept({ io, redis, driverId }) {
  const loc = await liveDriverLocation(redis, driverId);
  if (!loc) return;
  await maybeTriggerArrivalCall({
    io,
    redis,
    driverId,
    latitude: loc.latitude,
    longitude: loc.longitude,
  });
}

/** Schedules the single retry for a missed call. In-process timer: a
 * server restart inside the retry window drops the retry (the call stays
 * "missed"), which is acceptable for a courtesy call. */
function scheduleRetry(call, { io, redis }) {
  if (call.retryCount >= MAX_RETRIES) return;
  setTimeout(() => {
    retryMissedCall(call._id, { io, redis }).catch((err) =>
      console.error("Pickup call retry failed:", err.message)
    );
  }, retryAfterMs()).unref?.();
}

async function retryMissedCall(callId, { io, redis }) {
  const existing = await VoiceCall.findById(callId).lean();
  if (!existing) return;
  const booking = await Booking.findById(existing.bookingId).lean();
  // Driver already arrived, or booking cancelled/progressed — no retry.
  if (!booking || booking.status !== "accepted" || !voiceCallsEnabled()) return;

  const call = await VoiceCall.findOneAndUpdate(
    { _id: callId, status: "missed", retryCount: { $lt: MAX_RETRIES } },
    {
      $set: { status: "ringing" },
      $unset: { endedAt: 1, endedReason: 1, nextRetryAt: 1, sarvamAttemptId: 1 },
      $inc: { retryCount: 1 },
    },
    { new: true }
  );
  if (!call) return;
  await dialPickupCall(call._id, { io, redis });
}

const SARVAM_STATUS_MAP = {
  connected: "completed",
  no_answer: "missed",
  busy: "missed",
  failed: "failed",
};

/**
 * End-of-call webhook from Sarvam. `payload` is Sarvam's instant-outbound
 * webhook body. Matches on both our callId (echoed metadata) and the
 * current attempt_id, so a late webhook for a superseded attempt is a
 * no-op. Returns the updated call, or null if nothing matched.
 */
export async function handleSarvamCallEnded({ io, redis, payload }) {
  const metadata = payload?.webhook_config?.metadata || {};
  const callId = metadata.callId;
  const attemptId = payload?.attempt_id;
  if (!mongoose.isValidObjectId(callId) || !attemptId) return null;

  const status = SARVAM_STATUS_MAP[payload.status] || "failed";
  const transcript = Array.isArray(payload.interaction_transcript)
    ? payload.interaction_transcript.map((turn) => ({
        role: turn.role === "agent" ? "assistant" : "user",
        text: turn.en_text || turn.text || "",
      }))
    : [];

  const update = {
    status,
    endedAt: new Date(),
    endedReason: payload.status || "unknown",
    durationSeconds: payload.duration ?? undefined,
    failureReason: payload.failure_reason || undefined,
  };
  if (transcript.length) update.transcript = transcript;
  if (status === "missed") update.nextRetryAt = new Date(Date.now() + retryAfterMs());

  const call = await VoiceCall.findOneAndUpdate(
    {
      _id: callId,
      sarvamAttemptId: attemptId,
      status: { $in: ["ringing", "active"] },
    },
    { $set: Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)) },
    { new: true }
  );
  if (!call) return null;

  console.log(
    `Sarvam call ended: call=${call._id} status=${payload.status} -> ${status} retry=${call.retryCount}`
  );
  if (status === "missed") scheduleRetry(call, { io, redis });
  return call;
}

/** In-app ring timed out (client emits voiceCallMissed). Scoped to the
 * customer the call was for. */
export async function markCallMissed(callId, { io, redis, userId } = {}) {
  if (!mongoose.isValidObjectId(callId) || !userId) return null;
  const call = await VoiceCall.findOneAndUpdate(
    { _id: callId, userId, status: "ringing", channel: "in_app" },
    {
      $set: {
        status: "missed",
        endedAt: new Date(),
        endedReason: "missed",
        nextRetryAt: new Date(Date.now() + retryAfterMs()),
      },
    },
    { new: true }
  );
  if (call && io && redis) scheduleRetry(call, { io, redis });
  return call;
}

export async function markCallDeclined(callId, userId) {
  if (!mongoose.isValidObjectId(callId) || !userId) return null;
  return VoiceCall.findOneAndUpdate(
    { _id: callId, userId, status: { $in: ["ringing", "active"] }, channel: "in_app" },
    { $set: { status: "declined", endedAt: new Date(), endedReason: "declined" } },
    { new: true }
  );
}
