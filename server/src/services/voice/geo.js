const EARTH_RADIUS_M = 6371000;

const toRad = (deg) => (deg * Math.PI) / 180;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Pickup is stored as [lat, lng] in this codebase (not GeoJSON [lng, lat]). */
export function pickupLatLng(src) {
  const coords = src?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lat = Number(coords[0]);
  const lng = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Same [lat, lng] convention as pickupLatLng, for Booking.destn. */
export function destnLatLng(destn) {
  return pickupLatLng(destn);
}

export function bearingDegrees(lat1, lng1, lat2, lng2) {
  const toDeg = (r) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLng = toRad(lng2 - lng1);
  const y = Math.sin(deltaLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const CARDINAL_HI = ["Uttar", "Uttar-Purva", "Purva", "Dakshin-Purva", "Dakshin", "Dakshin-Paschim", "Paschim", "Uttar-Paschim"];

/** Compass bearing -> a Hindi-friendly cardinal direction word (8-point). */
export function cardinalDirectionHi(bearing) {
  const index = Math.round(bearing / 45) % 8;
  return CARDINAL_HI[index];
}
