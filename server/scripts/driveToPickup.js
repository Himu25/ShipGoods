/**
 * Drives a driver from their CURRENT Mongo position (wherever they already
 * are) along the real road route to a booking's pickup point, publishing
 * live location updates (socket + redis + mongo) so the frontend tracking
 * map animates it along the actual path — no artificial repositioning.
 *
 * Run: node scripts/driveToPickup.js <bookingId> <driverId>
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
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

const SPEED_MPS = Number(process.env.DRIVE_SPEED_MPS) || 35; // ~126 km/h time-lapse
const TICK_MS = 400;
const ARRIVE_METERS = 28;

const [, , BOOKING_ID, DRIVER_ID] = process.argv;

if (!BOOKING_ID || !DRIVER_ID) {
  console.error("Usage: node scripts/driveToPickup.js <bookingId> <driverId>");
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

function publishLocation(socket, lat, lng, heading = 0) {
  // The server's driverLocationUpdate handler owns persistence now
  // (validated Redis cache + Mongo via Kafka) — this script just emits,
  // exactly like the real driver app would.
  socket.emit("driverLocationUpdate", { latitude: lat, longitude: lng, heading });
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const driver = await Driver.findById(DRIVER_ID);
  const booking = await Booking.findById(BOOKING_ID);
  if (!driver) throw new Error(`Driver not found: ${DRIVER_ID}`);
  if (!booking) throw new Error(`Booking not found: ${BOOKING_ID}`);

  // Booking.src stores [lat, lng] (client convention), opposite of the
  // GeoJSON [lng, lat] order Driver.currentLocation uses. Don't swap these.
  const [destLat, destLng] = booking.src.coordinates;
  const [startLng, startLat] = driver.currentLocation.coordinates;

  console.log(`Pickup: ${destLat.toFixed(5)}, ${destLng.toFixed(5)}`);
  console.log(`${driver.name} current position: ${startLat.toFixed(5)}, ${startLng.toFixed(5)}`);

  const user = await User.findOne({ driverId: DRIVER_ID });
  if (!user) throw new Error(`No User account found for driver: ${DRIVER_ID}`);
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: process.env.defaultPass || "123456789" }),
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
  socket.emit("driverConnected");
  console.log(`🟢 ${driver.name} online at current position.`);

  let lat = startLat;
  let lng = startLng;
  let heading = bearingDegrees(lat, lng, destLat, destLng);
  publishLocation(socket, lat, lng, heading);

  console.log("Fetching road route from current position to pickup...");
  let road = await fetchRoadRoute(lat, lng, destLat, destLng);
  if (road?.length) {
    console.log(`✅ Following ${road.length} road points`);
  } else {
    console.log("⚠️  No road data — straight line fallback");
  }

  const totalMeters = haversineMeters(lat, lng, destLat, destLng);
  console.log(`🚗 Driving ~${(totalMeters / 1000).toFixed(1)} km to pickup along the mapped route...`);

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
        publishLocation(socket, lat, lng, heading);
      } catch (err) {
        console.error("Location publish failed:", err.message);
      }

      const remaining = haversineMeters(lat, lng, destLat, destLng);
      console.log(
        `📍 ${driver.name} → ${lat.toFixed(5)}, ${lng.toFixed(5)}  hdg ${Math.round(heading)}°  (${(remaining / 1000).toFixed(2)} km left)`
      );

      if (next.arrived || remaining <= ARRIVE_METERS) {
        clearInterval(tick);
        publishLocation(socket, destLat, destLng, heading);
        console.log(`🛑 ${driver.name} arrived at pickup.`);
        resolve();
      }
    }, TICK_MS);
  });

  socket.close();
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
