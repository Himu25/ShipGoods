/**
 * Places a driver ~20km from a booking's pickup point, then drives them
 * along real roads toward the pickup, publishing live location updates
 * (socket + redis + mongo) so the frontend tracking map animates it.
 *
 * Run: node scripts/driveFrom20km.js <bookingId> <driverId> [bearingDegrees]
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Redis from "ioredis";
import Driver from "../src/models/Driver.js";
import Booking from "../src/models/Booking.js";
import User from "../src/models/User.js";

dotenv.config();

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { io } = require(join(
  __dirname,
  "../../client/node_modules/socket.io-client/build/cjs/index.js"
));

const API = process.env.API_BASE || "http://localhost:3000";
const SOCKET_URL = process.env.SOCKET_URL || "http://localhost:3000";
const OSRM = "https://router.project-osrm.org/route/v1/driving";

const START_DISTANCE_METERS = 20000;
const SPEED_MPS = 110; // time-lapse speed so a 20km trip finishes in ~3 min for demo tracking
const TICK_MS = 400;
const ARRIVE_METERS = 28;

const [, , BOOKING_ID, DRIVER_ID, BEARING_ARG] = process.argv;
const BEARING_DEG = Number(BEARING_ARG) || 200; // roughly SSW by default

if (!BOOKING_ID || !DRIVER_ID) {
  console.error("Usage: node scripts/driveFrom20km.js <bookingId> <driverId> [bearingDegrees]");
  process.exit(1);
}

function toRad(d) {
  return (d * Math.PI) / 180;
}
function toDeg(r) {
  return (r * 180) / Math.PI;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingDegrees(lat1, lng1, lat2, lng2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `distanceMeters` away from (lat,lng) along `bearingDeg`. */
function destinationPoint(lat, lng, bearingDeg, distanceMeters) {
  const R = 6371000;
  const δ = distanceMeters / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

function stepToward(lat, lng, destLat, destLng, metersPerTick) {
  const dist = haversineMeters(lat, lng, destLat, destLng);
  if (dist <= metersPerTick || dist === 0) {
    return { lat: destLat, lng: destLng, arrived: true, heading: bearingDegrees(lat, lng, destLat, destLng) };
  }
  const ratio = metersPerTick / dist;
  return {
    lat: lat + (destLat - lat) * ratio,
    lng: lng + (destLng - lng) * ratio,
    arrived: false,
    heading: bearingDegrees(lat, lng, destLat, destLng),
  };
}

async function fetchRoadRoute(lat1, lng1, lat2, lng2) {
  const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates?.length) {
      return null;
    }
    return data.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  } catch (err) {
    console.warn("OSRM route failed, using straight line:", err.message);
    return null;
  }
}

function advanceAlongRoad(path, pathIndex, lat, lng, metersPerTick) {
  let remaining = metersPerTick;
  let i = pathIndex;
  let curLat = lat;
  let curLng = lng;
  let heading = 0;

  while (remaining > 0 && i < path.length) {
    const target = path[i];
    const dist = haversineMeters(curLat, curLng, target.lat, target.lng);
    heading = bearingDegrees(curLat, curLng, target.lat, target.lng);

    if (dist <= remaining || dist < 0.5) {
      remaining -= dist;
      curLat = target.lat;
      curLng = target.lng;
      i += 1;
      continue;
    }

    const ratio = remaining / dist;
    curLat = curLat + (target.lat - curLat) * ratio;
    curLng = curLng + (target.lng - curLng) * ratio;
    remaining = 0;
  }

  return { lat: curLat, lng: curLng, pathIndex: i, heading, arrived: i >= path.length };
}

async function publishLocation(redis, socket, driverId, lat, lng, heading = 0) {
  const payload = { latitude: lat, longitude: lng, heading };
  socket.emit("driverLocationUpdate", {
    driverId: driverId.toString(),
    latitude: lat,
    longitude: lng,
    heading,
  });
  await redis.set(`driver:${driverId}:location`, JSON.stringify(payload));
  await Driver.findByIdAndUpdate(driverId, {
    currentLocation: { type: "Point", coordinates: [lng, lat] },
  });
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");

  const driver = await Driver.findById(DRIVER_ID);
  const booking = await Booking.findById(BOOKING_ID);
  if (!driver) throw new Error(`Driver not found: ${DRIVER_ID}`);
  if (!booking) throw new Error(`Booking not found: ${BOOKING_ID}`);

  // NOTE: Booking.src/destn store coordinates as [lat, lng] (client sends
  // [startCoordinates.lat, startCoordinates.lng]) — opposite of the GeoJSON
  // [lng, lat] order used by Driver.currentLocation. Don't swap these.
  const [destLat, destLng] = booking.src.coordinates; // pickup point
  const start = destinationPoint(destLat, destLng, BEARING_DEG, START_DISTANCE_METERS);

  console.log(`Pickup: ${destLat.toFixed(5)}, ${destLng.toFixed(5)}`);
  console.log(
    `Placing ${driver.name} ~20km away (bearing ${BEARING_DEG}°) at ${start.lat.toFixed(5)}, ${start.lng.toFixed(5)}`
  );

  // Place driver at the 20km start point first, before moving.
  await Driver.findByIdAndUpdate(DRIVER_ID, {
    currentLocation: { type: "Point", coordinates: [start.lng, start.lat] },
  });

  // Sockets now require a real JWT — log in as this driver's User account
  // the same way the real driver app would.
  const user = await User.findOne({ driverId: DRIVER_ID });
  if (!user) throw new Error(`No User account found for driver: ${DRIVER_ID}`);
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      password: process.env.defaultPass || "123456789",
    }),
  });
  const loginData = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginData.token) {
    throw new Error(`Login failed: ${loginData.message || loginRes.status}`);
  }

  const socket = io(SOCKET_URL, {
    transports: ["websocket"],
    reconnection: true,
    auth: { token: loginData.token },
  });

  await new Promise((resolve) => socket.on("connect", resolve));
  socket.emit("driverConnected", DRIVER_ID.toString());
  console.log(`🟢 ${driver.name} online at start point.`);

  let lat = start.lat;
  let lng = start.lng;
  let heading = bearingDegrees(lat, lng, destLat, destLng);
  await publishLocation(redis, socket, DRIVER_ID, lat, lng, heading);
  console.log("📍 Driver placed. Starting drive in 2s...");
  await new Promise((r) => setTimeout(r, 2000));

  console.log("Fetching road route...");
  let road = await fetchRoadRoute(lat, lng, destLat, destLng);
  if (road?.length) {
    console.log(`✅ Following ${road.length} road points`);
  } else {
    console.log("⚠️  No road data — straight line fallback");
  }

  const totalMeters = haversineMeters(lat, lng, destLat, destLng);
  console.log(`🚗 Driving ~${(totalMeters / 1000).toFixed(1)} km to pickup...`);

  let pathIndex = 0;
  const metersPerTick = SPEED_MPS * (TICK_MS / 1000);

  await new Promise((resolve) => {
    const tick = setInterval(async () => {
      let next;
      if (road?.length) {
        next = advanceAlongRoad(road, pathIndex, lat, lng, metersPerTick);
        pathIndex = next.pathIndex;
      } else {
        next = stepToward(lat, lng, destLat, destLng, metersPerTick);
      }

      lat = next.lat;
      lng = next.lng;
      heading = next.heading ?? heading;

      try {
        await publishLocation(redis, socket, DRIVER_ID, lat, lng, heading);
      } catch (err) {
        console.error("Location publish failed:", err.message);
      }

      const remaining = haversineMeters(lat, lng, destLat, destLng);
      console.log(
        `📍 ${driver.name} → ${lat.toFixed(5)}, ${lng.toFixed(5)}  hdg ${Math.round(heading)}°  (${(remaining / 1000).toFixed(2)} km left)`
      );

      if (next.arrived || remaining <= ARRIVE_METERS) {
        clearInterval(tick);
        await publishLocation(redis, socket, DRIVER_ID, destLat, destLng, heading);
        console.log(`🛑 ${driver.name} arrived at pickup.`);
        resolve();
      }
    }, TICK_MS);
  });

  socket.close();
  redis.disconnect();
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
