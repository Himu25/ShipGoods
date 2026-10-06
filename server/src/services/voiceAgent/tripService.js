import Booking from "../../models/Booking.js";
import { haversineMeters, bearingDegrees, cardinalDirectionHi, pickupLatLng, destnLatLng } from "../voice/geo.js";
import { fetchGoogleTrafficRoute, fetchNearbyLandmarks } from "./googleMaps.js";
import { DRIVER_CALLBACK_MESSAGE, buildTooFarMessage } from "./constants.js";

const LANDMARK_MAX_ATTEMPTS = 3;
const LANDMARK_ATTEMPT_TTL_SEC = 20 * 60;

const OSRM = "https://router.project-osrm.org/route/v1/driving";

/** Real road route (distance + typical-road-speed duration) via OSRM —
 * free, keyless, already the proven pattern elsewhere in this codebase.
 * NOT live traffic — callers must say so if asked about traffic. */
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

async function liveDriverLocation(driverId, redis) {
  if (!driverId) return null;
  const raw = await redis.get(`driver:${driverId}:location`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The one place a bookingId turns into a Booking — and the one place
 * ownership is enforced. Every tool in tools.js goes through this, so
 * there's no path to another user's trip data. */
export async function loadBookingForUser(bookingId, userId) {
  if (!bookingId || !userId) return { error: "forbidden" };
  const booking = await Booking.findById(bookingId)
    .populate("driverId")
    .populate("vehicleId")
    .lean();
  if (!booking) return { error: "not_found" };
  if (String(booking.userId) !== String(userId)) return { error: "forbidden" };
  return { booking };
}

export function getBookingStatus(booking) {
  return {
    status: booking.status,
    pickup: booking.srcText,
    destination: booking.destnText,
    isScheduled: booking.isScheduled,
  };
}

export function getVehicleDetails(booking) {
  const v = booking.vehicleId;
  if (!v) return { available: false };
  return { available: true, vehicleType: v.type, numberPlate: v.numberPlate, model: v.model };
}

export function getDriverDetails(booking) {
  const d = booking.driverId;
  if (!d) return { available: false };
  return { available: true, driverFirstName: String(d.name || "").trim().split(/\s+/)[0] || null };
}

function currentTarget(booking) {
  // Once goods are collected, the relevant point becomes the destination,
  // not the pickup.
  return booking.status === "collected"
    ? destnLatLng(booking.destn)
    : pickupLatLng(booking.src);
}

export async function getDriverLocation(booking, redis) {
  if (!booking.driverId) return { available: false };
  const loc = await liveDriverLocation(booking.driverId._id, redis);
  const target = currentTarget(booking);
  if (!loc || !target) return { available: false };

  const distanceMeters = Math.round(
    haversineMeters(loc.latitude, loc.longitude, target.lat, target.lng)
  );
  // Direction FROM the target TO the driver — "driver is north of pickup".
  const bearing = bearingDegrees(target.lat, target.lng, loc.latitude, loc.longitude);
  const ageSeconds = loc.updatedAt ? Math.round((Date.now() - loc.updatedAt) / 1000) : null;
  return {
    available: true,
    distanceMeters,
    direction: cardinalDirectionHi(bearing),
    ageSeconds,
    headingTo: booking.status === "collected" ? "destination" : "pickup",
  };
}

export async function getDestinationETA(booking, redis) {
  if (!booking.driverId) return { available: false };
  const loc = await liveDriverLocation(booking.driverId._id, redis);
  const target = currentTarget(booking);
  if (!loc || !target) return { available: false };

  // Traffic-aware first (Google Routes); OSRM is the fallback so this
  // tool keeps working exactly as before if the key is missing or the
  // call fails for any reason — this must never become a hard failure.
  const google = await fetchGoogleTrafficRoute(loc.latitude, loc.longitude, target.lat, target.lng);
  if (google) {
    return {
      available: true,
      remainingMeters: Math.round(google.distanceMeters),
      etaMinutes: Math.max(1, Math.round(google.durationSeconds / 60)),
      trafficCondition: google.trafficCondition,
      headingTo: booking.status === "collected" ? "destination" : "pickup",
      note: "Live traffic-aware estimate (Google Routes).",
    };
  }

  const route = await fetchRoadRoute(loc.latitude, loc.longitude, target.lat, target.lng);
  if (!route) return { available: false };

  return {
    available: true,
    remainingMeters: Math.round(route.distanceMeters),
    etaMinutes: Math.max(1, Math.round(route.durationSeconds / 60)),
    trafficCondition: "unknown",
    headingTo: booking.status === "collected" ? "destination" : "pickup",
    note: "Estimate from distance and typical road speeds — not live traffic (traffic-aware source unavailable).",
  };
}

function notifyDriverToCall(io, booking, reason) {
  if (!io) return;
  io.to(`driver:${booking.driverId._id}`).emit("userPickupUpdate", {
    bookingId: String(booking._id),
    messageKey: "call_customer",
    text: reason,
  });
}

/** Two landmark names are "the same place" for our purposes if they
 * share a root after stripping numbers/punctuation — "Tower KM17" and
 * "KM 19, Jaypee Kosmos" both reduce to "jaypee kosmos", which is
 * exactly the bug we saw live: four "different" suggestions that were
 * really the same residential complex's internal block numbers. */
function landmarkRoot(name) {
  return name
    .toLowerCase()
    .replace(/\b(tower|block|km)\s*-?\s*\d+\b/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One landmark per call, tracked per VoiceCall so repeated "yeh nahi
 * dikh raha" turns get a genuinely NEW landmark each time (never a
 * sub-part of one already suggested), up to LANDMARK_MAX_ATTEMPTS.
 * When the rider's live location is available (userLat/userLng), this
 * also tracks whether they're moving toward or away from the driver
 * across attempts and says so explicitly — the directional cue is the
 * primary guidance, the landmark name is secondary context, not the
 * other way around. After max attempts, hands off to the driver and
 * actually notifies them (reusing the existing "userPickupUpdate"
 * event DriverMap.js already listens for).
 */
const LANDMARK_PROXIMITY_METERS = 500; // the car has to actually be nearby for this to mean anything

export async function findCarLandmark(booking, redis, callId, io, userLat, userLng) {
  if (!booking.driverId) return { available: false };
  const loc = await liveDriverLocation(booking.driverId._id, redis);
  if (!loc) return { available: false };

  // Prefer the rider's real live position over the static pickup-point
  // text when we have it — far more accurate for "which way do I go."
  const haveUser = Number.isFinite(userLat) && Number.isFinite(userLng);
  const target = haveUser ? { lat: userLat, lng: userLng } : currentTarget(booking);
  if (!target) return { available: false };

  const distanceMeters = haversineMeters(loc.latitude, loc.longitude, target.lat, target.lng);
  const direction = haveUser
    ? cardinalDirectionHi(bearingDegrees(userLat, userLng, loc.latitude, loc.longitude))
    : null;

  // Landmarks/directions near a car that's still minutes away are
  // meaningless to someone already standing at pickup — observed live.
  if (distanceMeters > LANDMARK_PROXIMITY_METERS) {
    return {
      exhausted: false,
      tooFar: true,
      distanceMeters: Math.round(distanceMeters),
      message: buildTooFarMessage((distanceMeters / 1000).toFixed(1)),
    };
  }

  const attemptKey = `landmarkAttempt:${callId || booking._id}`;
  const attempt = await redis.incr(attemptKey);
  await redis.expire(attemptKey, LANDMARK_ATTEMPT_TTL_SEC);

  // Did the rider move closer or farther since their last attempt?
  let movement = null;
  if (haveUser) {
    const posKey = `landmarkUserPos:${callId || booking._id}`;
    const prevRaw = await redis.get(posKey);
    if (prevRaw) {
      try {
        const prev = JSON.parse(prevRaw);
        const prevDistance = haversineMeters(prev.lat, prev.lng, loc.latitude, loc.longitude);
        if (distanceMeters > prevDistance + 8) movement = "away";
        else if (distanceMeters < prevDistance - 8) movement = "closer";
      } catch {
        /* ignore corrupt cache entry */
      }
    }
    await redis.set(posKey, JSON.stringify({ lat: userLat, lng: userLng }), "EX", LANDMARK_ATTEMPT_TTL_SEC);
  }

  if (attempt > LANDMARK_MAX_ATTEMPTS) {
    notifyDriverToCall(io, booking, "Customer can't find the vehicle — please call them directly.");
    return { exhausted: true, message: DRIVER_CALLBACK_MESSAGE };
  }

  const candidates = await fetchNearbyLandmarks(loc.latitude, loc.longitude);
  const usedKey = `landmarkUsed:${callId || booking._id}`;
  const usedRaw = await redis.get(usedKey);
  const used = usedRaw ? JSON.parse(usedRaw) : [];
  const usedRoots = new Set(used.map(landmarkRoot));

  // Never suggest the same complex/building twice under a different
  // tower number — only genuinely distinct places count as "fresh".
  const fresh = candidates.filter((c) => !usedRoots.has(landmarkRoot(c.name)));
  const pickFrom = fresh.length ? fresh : candidates;

  if (!pickFrom.length) {
    notifyDriverToCall(io, booking, "Customer can't find the vehicle and no distinct landmarks are nearby — please call them.");
    return { exhausted: true, message: DRIVER_CALLBACK_MESSAGE };
  }

  const landmark = pickFrom[0].name;
  used.push(landmark);
  await redis.set(usedKey, JSON.stringify(used), "EX", LANDMARK_ATTEMPT_TTL_SEC);

  return {
    exhausted: false,
    landmark,
    direction,
    distanceMeters: Math.round(distanceMeters),
    movement, // "closer" | "away" | null (null = first attempt or no user location)
    attempt,
    attemptsLeft: Math.max(0, LANDMARK_MAX_ATTEMPTS - attempt),
  };
}
