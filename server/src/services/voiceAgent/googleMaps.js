// All Google Maps Platform calls isolated here. Nothing outside this
// file ever sees GOOGLE_MAPS_API_KEY, and nothing here returns a raw
// Google response to a caller — only specific, whitelisted fields.

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";

function parseSeconds(value) {
  // Routes API durations come back as "123s"
  if (typeof value !== "string") return null;
  const n = Number(value.replace("s", ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Traffic-aware route via Google Routes API. Returns null (never
 * throws) on any failure or missing key, so callers can fall back to
 * the OSRM estimate — this must never be the thing that breaks the
 * existing ETA tool.
 */
export async function fetchGoogleTrafficRoute(originLat, originLng, destLat, destLng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        computeAlternativeRoutes: false,
        units: "METRIC",
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Google Routes API failed:", res.status, body);
      return null;
    }

    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null;

    const durationSeconds = parseSeconds(route.duration);
    const staticDurationSeconds = parseSeconds(route.staticDuration);
    const distanceMeters = route.distanceMeters;
    if (!Number.isFinite(durationSeconds) || !Number.isFinite(distanceMeters)) return null;

    let trafficCondition = "unknown";
    if (Number.isFinite(staticDurationSeconds) && staticDurationSeconds > 0) {
      const ratio = durationSeconds / staticDurationSeconds;
      trafficCondition = ratio >= 1.4 ? "heavy" : ratio >= 1.15 ? "moderate" : "light";
    }

    return { durationSeconds, distanceMeters, trafficCondition };
  } catch (err) {
    console.error("Google Routes API error:", err.message);
    return null;
  }
}

// Unrestricted search was returning sub-building labels ("Tower KM17",
// "KM 19", "KM 11" — all the SAME residential complex) instead of
// genuinely distinct landmarks a rider standing on the street could
// actually recognize. Restricting to concrete, visible-from-the-street
// categories fixes that.
const LANDMARK_TYPES = [
  "store",
  "restaurant",
  "cafe",
  "gas_station",
  "atm",
  "pharmacy",
  "school",
  // "place_of_worship" is NOT a valid Places API (New) type (that's the
  // old Places API's generic value) — using it made the WHOLE request
  // fail with 400, so this list silently returned [] every time until
  // caught live. The new API wants specific types instead.
  "hindu_temple",
  "mosque",
  "church",
  "park",
];

/**
 * Nearby landmarks (Places API, New) around a live point. Returns
 * {name, types} objects, [] on any failure — callers must handle an
 * empty list rather than crash.
 */
export async function fetchNearbyLandmarks(lat, lng, maxResults = 8) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(PLACES_NEARBY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.types",
      },
      body: JSON.stringify({
        includedTypes: LANDMARK_TYPES,
        maxResultCount: maxResults,
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 300.0 },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Google Places API failed:", res.status, body);
      return [];
    }

    const data = await res.json();
    const places = Array.isArray(data?.places) ? data.places : [];
    return places
      .map((p) => ({ name: p.displayName?.text, types: p.types || [] }))
      .filter((p) => typeof p.name === "string" && p.name.trim().length > 0);
  } catch (err) {
    console.error("Google Places API error:", err.message);
    return [];
  }
}
