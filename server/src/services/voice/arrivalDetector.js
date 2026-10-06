import Booking from "../../models/Booking.js";
import VoiceCall from "../../models/VoiceCall.js";
import { haversineMeters, pickupLatLng } from "./geo.js";
// The live pipeline is the Hindi Groq/Sarvam agent (services/voiceAgent),
// not the old English Vapi-era one this file sits next to — these
// greetings must come from there so the ring-UI preview text matches
// what's actually spoken on answer.
import { ETA_GREETING_HI, ARRIVAL_GREETING_HI } from "../voiceAgent/guardrails.js";

export const ARRIVE_METERS = 30;
export const ETA_CALL_METERS = 5000;
const RINGING_LOCK_SEC = 45;
const RETRY_AFTER_MS = 2 * 60 * 1000;
const MAX_RETRIES = 2;
const TRIGGER_TTL_SEC = 2 * 60 * 60;

const GREETINGS = { eta: ETA_GREETING_HI, arrival: ARRIVAL_GREETING_HI };

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

async function emitToUser(io, redis, userId, event, payload) {
  // "user:<id>" is a Socket.IO room now (joined in registerUser), not a
  // raw socket id stored in Redis — matches socketService.js.
  io.to(`user:${userId}`).emit(event, payload);
}

async function ringUser({ io, redis, trip, driverId, distanceM, isRetry, callType }) {
  const lock = await redis.set(
    `voice:ringing:${callType}:${trip.bookingId}`,
    "1",
    "EX",
    RINGING_LOCK_SEC,
    "NX"
  );
  if (!lock) return null;

  let call;
  if (isRetry) {
    call = await VoiceCall.findOneAndUpdate(
      { bookingId: trip.bookingId, callType, status: "missed" },
      {
        $set: {
          status: "ringing",
          triggerDistanceM: distanceM,
        },
        $inc: { retryCount: 1 },
      },
      { new: true, sort: { createdAt: -1 } }
    );
  }

  if (!call) {
    call = await VoiceCall.create({
      bookingId: trip.bookingId,
      userId: trip.userId,
      driverId,
      status: "ringing",
      callType,
      triggerDistanceM: distanceM,
      retryCount: 0,
    });
  }

  const payload = {
    callId: String(call._id),
    bookingId: trip.bookingId,
    driverId: String(driverId),
    distanceM: Math.round(distanceM),
    callType,
    message: GREETINGS[callType],
  };

  await emitToUser(io, redis, trip.userId, "incomingVoiceCall", payload);
  io.to(`driver:${driverId}`).emit("voiceCallRinging", payload);
  return call;
}

/** Ring (or retry) for one threshold/callType, independent of the other. */
async function maybeRingForThreshold({
  io,
  redis,
  driverId,
  trip,
  distanceM,
  callType,
  thresholdMeters,
}) {
  if (distanceM > thresholdMeters) return;

  const latestCall = await VoiceCall.findOne({
    bookingId: trip.bookingId,
    callType,
  }).sort({ createdAt: -1 });

  if (!latestCall) {
    const first = await redis.set(
      `voice:triggered:${callType}:${trip.bookingId}`,
      "1",
      "EX",
      TRIGGER_TTL_SEC,
      "NX"
    );
    if (!first) return;
    await ringUser({ io, redis, trip, driverId, distanceM, isRetry: false, callType });
    return;
  }

  if (latestCall.status === "ringing" || latestCall.status === "active") return;
  if (["completed", "declined", "failed"].includes(latestCall.status)) return;

  if (
    latestCall.status === "missed" &&
    latestCall.retryCount < MAX_RETRIES &&
    latestCall.nextRetryAt &&
    Date.now() >= new Date(latestCall.nextRetryAt).getTime()
  ) {
    await ringUser({ io, redis, trip, driverId, distanceM, isRetry: true, callType });
  }
}

export async function maybeTriggerArrivalCall({
  io,
  redis,
  driverId,
  latitude,
  longitude,
}) {
  // Voice agent is disabled — do not ring the user.
  if (process.env.VOICE_CALLS_ENABLED !== "true") {
    return;
  }

  if (!driverId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return;
  }

  const userId = await redis.get(`driverAssignedToUser:${driverId}`);
  if (!userId) return;

  const trip = await loadActiveTrip(redis, driverId, userId);
  if (!trip) return;

  const distanceM = haversineMeters(
    latitude,
    longitude,
    trip.pickupLat,
    trip.pickupLng
  );
  // Neither threshold is in range yet — nothing to do.
  if (distanceM > ETA_CALL_METERS) return;

  const booking = await Booking.findById(trip.bookingId);
  if (!booking || !["accepted", "arrived"].includes(booking.status)) return;

  if (booking.status === "accepted" && distanceM <= ARRIVE_METERS) {
    booking.status = "arrived";
    booking.arrivedTime = new Date();
    await booking.save();
    await emitToUser(io, redis, userId, "statusUpdated", {
      bookingId: String(booking._id),
      newStatus: "arrived",
    });
    io.to(`driver:${driverId}`).emit("statusUpdated", {
      bookingId: String(booking._id),
      newStatus: "arrived",
    });
  }

  // Each threshold rings independently — an ETA call ringing/missed/done
  // never blocks the later arrival call, and vice versa.
  await maybeRingForThreshold({
    io,
    redis,
    driverId,
    trip,
    distanceM,
    callType: "eta",
    thresholdMeters: ETA_CALL_METERS,
  });
  await maybeRingForThreshold({
    io,
    redis,
    driverId,
    trip,
    distanceM,
    callType: "arrival",
    thresholdMeters: ARRIVE_METERS,
  });
}

export async function markCallMissed(callId) {
  const call = await VoiceCall.findById(callId);
  if (!call || call.status !== "ringing") return call;
  call.status = "missed";
  call.endedAt = new Date();
  call.endedReason = "missed";
  call.nextRetryAt = new Date(Date.now() + RETRY_AFTER_MS);
  await call.save();
  return call;
}

export async function markCallDeclined(callId) {
  const call = await VoiceCall.findById(callId);
  if (!call || !["ringing", "active"].includes(call.status)) return call;
  call.status = "declined";
  call.endedAt = new Date();
  call.endedReason = "declined";
  await call.save();
  return call;
}
