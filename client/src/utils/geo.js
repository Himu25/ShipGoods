const OSRM = "https://router.project-osrm.org/route/v1/driving";
const toRad = (d) => (d * Math.PI) / 180;

/** [lat, lng] from a stored [lat, lng] pair, or null. */
export function toLatLng(coords) {
  if (!coords || coords.length < 2) return null;
  return [Number(coords[0]), Number(coords[1])];
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

export function bearingDegrees(lat1, lng1, lat2, lng2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const lerp = (a, b, t) => a + (b - a) * t;

export function lerpAngle(from, to, t) {
  const diff = ((to - from + 540) % 360) - 180;
  return (from + diff * t + 360) % 360;
}

export const easeInOut = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Nearest point on the route to (lat, lng), searched near the last hit. */
export function projectOnRoute(route, lat, lng, hint) {
  const kx = 111320 * Math.cos(toRad(lat));
  const ky = 110540;
  const from = Math.max(0, hint - 3);
  // First frame on a new route: scan it all; afterwards only near the car.
  const to = hint === 0 ? route.length - 1 : Math.min(route.length - 1, hint + 60);
  let best = { index: hint, point: route[Math.min(hint, route.length - 1)], dist: Infinity };
  for (let i = from; i < to; i += 1) {
    const [aLat, aLng] = route[i];
    const [bLat, bLng] = route[i + 1];
    const ax = (aLng - lng) * kx, ay = (aLat - lat) * ky;
    const bx = (bLng - lng) * kx, by = (bLat - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const dist = Math.hypot(ax + t * dx, ay + t * dy);
    if (dist < best.dist) {
      best = { index: i, point: [aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t], dist };
    }
  }
  return best;
}

/**
 * Road route between two [lat, lng] points from the public OSRM server.
 * Falls back to a straight line (with no distance/duration) on failure.
 */
export async function fetchRoadRoute(from, to, signal) {
  const straight = { points: [from, to], distanceKm: null, durationMin: null };
  try {
    const url = `${OSRM}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
    const data = await (await fetch(url, { signal })).json();
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route?.geometry?.coordinates) return straight;
    return {
      points: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
    };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return straight;
  }
}
