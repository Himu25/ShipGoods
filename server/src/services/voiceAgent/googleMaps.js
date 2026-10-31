// All Google Maps Platform calls isolated here. Nothing outside this
// file ever sees GOOGLE_MAPS_API_KEY, and nothing here returns a raw
// Google response to a caller — only specific, whitelisted fields.

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

const apiKey = () => process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;

function parseSeconds(value) {
  // Routes API durations come back as "123s"
  if (typeof value !== "string") return null;
  const n = Number(value.replace("s", ""));
  return Number.isFinite(n) ? n : null;
}

/** Share of the route (by polyline points) Google reads as SLOW or
 * TRAFFIC_JAM; null when the response carries no speed readings. */
function congestionShare(route) {
  const intervals = route?.travelAdvisory?.speedReadingIntervals;
  if (!Array.isArray(intervals) || !intervals.length) return null;
  let total = 0;
  const bySpeed = { NORMAL: 0, SLOW: 0, TRAFFIC_JAM: 0 };
  for (const iv of intervals) {
    const span = (iv.endPolylinePointIndex ?? 0) - (iv.startPolylinePointIndex ?? 0);
    if (span <= 0) continue;
    total += span;
    if (bySpeed[iv.speed] !== undefined) bySpeed[iv.speed] += span;
  }
  if (!total) return null;
  return {
    slowPercent: Math.round((bySpeed.SLOW / total) * 100),
    jamPercent: Math.round((bySpeed.TRAFFIC_JAM / total) * 100),
  };
}

/**
 * Traffic-aware route via Google Routes API. Returns null (never
 * throws) on any failure or missing key, so callers can fall back to
 * the OSRM estimate — this must never be the thing that breaks the
 * existing ETA tool. Besides the live duration it returns the usual
 * (no-traffic) duration, Google's route summary ("via ...") and how much
 * of the route is slow or jammed.
 */
export async function fetchGoogleTrafficRoute(originLat, originLng, destLat, destLng) {
  const key = apiKey();
  if (!key) return null;

  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": [
          "routes.duration",
          "routes.staticDuration",
          "routes.distanceMeters",
          "routes.description",
          "routes.travelAdvisory.speedReadingIntervals",
        ].join(","),
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        extraComputations: ["TRAFFIC_ON_POLYLINE"],
        computeAlternativeRoutes: false,
        units: "METRIC",
        languageCode: "en-IN",
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

    return {
      durationSeconds,
      staticDurationSeconds: Number.isFinite(staticDurationSeconds) ? staticDurationSeconds : null,
      distanceMeters,
      trafficCondition,
      via: typeof route.description === "string" && route.description.trim() ? route.description.trim() : null,
      congestion: congestionShare(route),
    };
  } catch (err) {
    console.error("Google Routes API error:", err.message);
    return null;
  }
}

const AREA_TYPES = ["sublocality_level_1", "sublocality", "neighborhood", "locality"];

/**
 * Human name for where a point is (Geocoding API): the road and the
 * area, e.g. { road: "Bhai Veer Singh Marg", area: "Gole Market" }.
 * Returns null on any failure or missing key.
 */
export async function reverseGeocodeArea(lat, lng) {
  const key = apiKey();
  if (!key) return null;

  try {
    const url = `${GEOCODE_URL}?latlng=${lat},${lng}&language=en&region=in&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (data.status !== "OK" || !Array.isArray(data.results)) {
      if (data.status && data.status !== "ZERO_RESULTS") {
        console.error("Google Geocoding API failed:", data.status, data.error_message || "");
      }
      return null;
    }
    const components = data.results.flatMap((r) => r.address_components || []);
    const find = (types) =>
      types.map((t) => components.find((c) => c.types?.includes(t))?.long_name).find(Boolean) || null;
    const road = find(["route"]);
    const area = find(AREA_TYPES);
    return road || area ? { road, area } : null;
  } catch (err) {
    console.error("Google Geocoding API error:", err.message);
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
  const key = apiKey();
  if (!key) return [];

  try {
    const res = await fetch(PLACES_NEARBY_URL, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
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
