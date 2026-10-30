import Booking from "../../models/Booking.js";
import { haversineMeters, bearingDegrees, cardinalDirectionHi, pickupLatLng, destnLatLng } from "../voice/geo.js";
import { fetchGoogleTrafficRoute, fetchNearbyLandmarks } from "./googleMaps.js";
import {
  DRIVER_CALLBACK_MESSAGE,
  SAFETY_CALLBACK_MESSAGE,
  UNAVAILABLE_HI,
  buildTooFarMessage,
} from "./constants.js";

const LANDMARK_MAX_ATTEMPTS = 3;
const LANDMARK_ATTEMPT_TTL_SEC = 20 * 60;

const OSRM = "https://router.project-osrm.org/route/v1/driving";

/** Real road route (distance + typical-road-speed duration) via OSRM —
 * free, keyless, already the proven pattern elsewhere in this codebase.
 * NOT live traffic — callers must say so if asked about traffic. */
async function fetchRoadRoute(lat1, lng1, lat2, lng2) {
  const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=false`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
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

const DRIVER_MOVE_TOLERANCE_METERS = 10;
const DRIVER_MOVE_TREND_TTL_SEC = 20 * 60;

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

  // Is the driver actually closing the gap, parked, or drifting off (e.g.
  // circling for parking)? Compared across calls, not within one — so the
  // first call in a conversation always comes back null.
  const moveKey = `driverMoveTrend:${booking._id}`;
  let movement = null;
  const prevRaw = await redis.get(moveKey);
  if (prevRaw) {
    try {
      const prevDistance = JSON.parse(prevRaw).distanceMeters;
      if (distanceMeters < prevDistance - DRIVER_MOVE_TOLERANCE_METERS) movement = "approaching";
      else if (distanceMeters > prevDistance + DRIVER_MOVE_TOLERANCE_METERS) movement = "moving_away";
      else movement = "stationary";
    } catch {
      /* ignore corrupt cache entry */
    }
  }
  await redis.set(moveKey, JSON.stringify({ distanceMeters }), "EX", DRIVER_MOVE_TREND_TTL_SEC);

  return {
    available: true,
    distanceMeters,
    direction: cardinalDirectionHi(bearing),
    ageSeconds,
    headingTo: booking.status === "collected" ? "destination" : "pickup",
    movement, // "approaching" | "moving_away" | "stationary" | null (first check this call)
  };
}

/** Traffic-aware first (Google Routes); OSRM is the fallback so this
 * keeps working if the key is missing or the call fails for any reason —
 * this must never become a hard failure. Returns null if both fail. */
export async function estimateRoute(fromLat, fromLng, toLat, toLng) {
  const google = await fetchGoogleTrafficRoute(fromLat, fromLng, toLat, toLng);
  if (google) {
    return {
      distanceMeters: Math.round(google.distanceMeters),
      etaMinutes: Math.max(1, Math.round(google.durationSeconds / 60)),
      trafficCondition: google.trafficCondition,
      note: "Live traffic-aware estimate (Google Routes).",
    };
  }

  const route = await fetchRoadRoute(fromLat, fromLng, toLat, toLng);
  if (!route) return null;
  return {
    distanceMeters: Math.round(route.distanceMeters),
    etaMinutes: Math.max(1, Math.round(route.durationSeconds / 60)),
    trafficCondition: "unknown",
    note: "Estimate from distance and typical road speeds — not live traffic (traffic-aware source unavailable).",
  };
}

export async function getDestinationETA(booking, redis) {
  if (!booking.driverId) return { available: false };
  const loc = await liveDriverLocation(booking.driverId._id, redis);
  const target = currentTarget(booking);
  if (!loc || !target) return { available: false };

  const route = await estimateRoute(loc.latitude, loc.longitude, target.lat, target.lng);
  if (!route) return { available: false };

  return {
    available: true,
    remainingMeters: route.distanceMeters,
    etaMinutes: route.etaMinutes,
    trafficCondition: route.trafficCondition,
    headingTo: booking.status === "collected" ? "destination" : "pickup",
    note: route.note,
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

/** "Meet me here" — the passenger describes WHERE THEY ARE (not asking
 * about the car), so relay it straight to the driver's app instead of
 * running it through the landmark-search machinery at all. */
export function shareUserLocationWithDriver(booking, io, description) {
  if (!booking.driverId) return { ok: false, message: UNAVAILABLE_HI };
  const text = String(description || "").trim();
  if (!text) return { ok: false, message: UNAVAILABLE_HI };
  if (io) {
    io.to(`driver:${booking.driverId._id}`).emit("userPickupUpdate", {
      bookingId: String(booking._id),
      messageKey: "passenger_position",
      text: `Passenger ne bataya: "${text}" ke paas khade hain.`,
    });
  }
  return { ok: true };
}

// Loose Hindi/English/Hinglish keyword -> Places type mapping, used to
// match what the rider says they can see ("ek medical store dikh raha
// hai") against the actual nearby candidates, instead of always handing
// out whichever landmark happens to be first in the list.
const DESCRIPTION_TYPE_HINTS = [
  { keywords: ["medical", "pharmacy", "dawai", "chemist", "medicine"], types: ["pharmacy"] },
  { keywords: ["petrol", "pump", "gas station", "fuel"], types: ["gas_station"] },
  { keywords: ["mandir", "temple"], types: ["hindu_temple"] },
  { keywords: ["masjid", "mosque"], types: ["mosque"] },
  { keywords: ["church", "girja"], types: ["church"] },
  { keywords: ["park", "garden", "bagicha"], types: ["park"] },
  { keywords: ["school", "college"], types: ["school"] },
  { keywords: ["restaurant", "dhaba", "hotel", "cafe", "coffee"], types: ["restaurant", "cafe"] },
  { keywords: ["atm"], types: ["atm"] },
  { keywords: ["shop", "store", "dukaan"], types: ["store"] },
];

/** Does the rider's free-text description of their surroundings point at
 * one of the actual nearby candidates? Checked in order: an exact name
 * mention first (they said the real shop name), then a loose
 * keyword/type match. Returns null — never guesses — if nothing lines up,
 * so the caller falls back to the plain nearest-landmark behavior. */
function matchDescriptionToCandidate(description, candidates) {
  if (!description || !candidates.length) return null;
  const text = description.toLowerCase();

  const nameMatch = candidates.find((c) => text.includes(c.name.toLowerCase()));
  if (nameMatch) return nameMatch;

  for (const { keywords, types } of DESCRIPTION_TYPE_HINTS) {
    if (!keywords.some((k) => text.includes(k))) continue;
    const typeMatch = candidates.find((c) => c.types?.some((t) => types.includes(t)));
    if (typeMatch) return typeMatch;
  }
  return null;
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

export async function findCarLandmark(
  booking,
  redis,
  callId,
  io,
  { userLat, userLng, userDescription, forceEscalate } = {}
) {
  if (!booking.driverId) return { available: false };

  // Safety escalation bypasses everything else — if the rider sounds
  // unsafe/scared, the right move is "stay where you are, driver will
  // call you now", not one more landmark attempt. Checked before the
  // live-location lookup so a stale/missing location can never block it.
  if (forceEscalate) {
    notifyDriverToCall(io, booking, "Customer reported feeling unsafe/unable to locate the vehicle — please call them immediately.");
    return { exhausted: true, safety: true, message: SAFETY_CALLBACK_MESSAGE };
  }

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
  // Still pass the direction along when we have it (idea: "wrong side of
  // the pickup point" guidance) instead of only ever giving a distance.
  if (distanceMeters > LANDMARK_PROXIMITY_METERS) {
    return {
      exhausted: false,
      tooFar: true,
      distanceMeters: Math.round(distanceMeters),
      direction,
      message: buildTooFarMessage((distanceMeters / 1000).toFixed(1), direction),
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

  // If the rider already said what they can see, try to ground the
  // answer in THAT instead of just handing out the nearest candidate —
  // "haan bilkul, wahi hai" is a much more convincing confirmation than
  // introducing a landmark they never mentioned.
  const described = matchDescriptionToCandidate(userDescription, pickFrom);
  const chosen = described || pickFrom[0];
  used.push(chosen.name);
  await redis.set(usedKey, JSON.stringify(used), "EX", LANDMARK_ATTEMPT_TTL_SEC);

  return {
    exhausted: false,
    landmark: chosen.name,
    matchedFromDescription: Boolean(described),
    direction,
    distanceMeters: Math.round(distanceMeters),
    movement, // "closer" | "away" | null (null = first attempt or no user location)
    attempt,
    attemptsLeft: Math.max(0, LANDMARK_MAX_ATTEMPTS - attempt),
  };
}
