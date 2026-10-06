/**
 * Connects as seeded drivers, rotates who accepts each request,
 * then drives along real roads to pickup and stops.
 *
 * Run: node scripts/autoDriver.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Redis from "ioredis";
import Driver from "../src/models/Driver.js";
import User from "../src/models/User.js";
import "../src/models/Vehicle.js";

dotenv.config();

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { io } = require(join(
  __dirname,
  "../../client/node_modules/socket.io-client/build/cjs/index.js"
));

const API = process.env.API_BASE || "http://localhost:3000";
const SOCKET_URL = process.env.SOCKET_URL || "http://localhost:3000";
const HOME = { lat: 28.6654, lng: 77.4391 };
const OSRM = "https://router.project-osrm.org/route/v1/driving";

const SPEED_MPS = 7.5;
const TICK_MS = 400; // smoother live animation on the map
const ARRIVE_METERS = 28;

const HOME_OFFSETS = [
  [0.004, 0.003],
  [-0.003, 0.005],
  [0.006, -0.002],
  [-0.002, -0.004],
  [0.003, 0.004],
  [-0.005, 0.002],
  [0.005, -0.005],
  [-0.004, 0.006],
  [0.007, 0.001],
  [-0.001, -0.006],
  [0.002, -0.007],
];

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Degrees clockwise from north (0 = north, 90 = east). */
function bearingDegrees(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
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

/** Fetch road polyline from OSRM. Returns [{lat,lng}, ...] or null. */
async function fetchRoadRoute(lat1, lng1, lat2, lng2) {
  const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates?.length) {
      return null;
    }
    return data.routes[0].geometry.coordinates.map(([lng, lat]) => ({
      lat,
      lng,
    }));
  } catch (err) {
    console.warn("OSRM route failed, using straight line:", err.message);
    return null;
  }
}

/**
 * Walk along a road path: consume waypoints until metersPerTick is used.
 * Returns new position + heading along the road.
 */
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

  const arrived = i >= path.length;
  return { lat: curLat, lng: curLng, pathIndex: i, heading, arrived };
}

/** Sockets now require a real JWT — log in as this driver's User account. */
async function loginAsDriver(driverId) {
  const user = await User.findOne({ driverId });
  if (!user) throw new Error(`No User account found for driver: ${driverId}`);
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      password: process.env.defaultPass || "123456789",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(`Login failed for ${user.email}: ${data.message || res.status}`);
  }
  return data.token;
}

async function acceptBooking(booking, driverId) {
  const bookingId = booking._id || booking.id;
  const userId = booking.userId?._id || booking.userId;

  console.log(
    `\n🚕 Accepting booking ${bookingId} as driver ${driverId} for user ${userId}`
  );

  const res = await fetch(`${API}/api/booking/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, driverId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log("Accept API failed:", data.message || res.status);
    return false;
  }

  console.log("✅ Booking accepted:", data.message);
  return { bookingId, userId, driverId };
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

async function resetDriversNearHome(drivers) {
  for (let i = 0; i < drivers.length; i++) {
    const [dLat, dLng] = HOME_OFFSETS[i % HOME_OFFSETS.length];
    const lat = HOME.lat + dLat;
    const lng = HOME.lng + dLng;
    await Driver.findByIdAndUpdate(drivers[i]._id, {
      isAvailable: true,
      currentLocation: { type: "Point", coordinates: [lng, lat] },
    });
    drivers[i].currentLocation = { type: "Point", coordinates: [lng, lat] };
  }
}

async function startDriveToPickup({ redis, socket, driver, bookingData }) {
  const start = driver.currentLocation?.coordinates || [HOME.lng, HOME.lat];
  let lng = Number(start[0]);
  let lat = Number(start[1]);
  const destLat = Number(bookingData?.src?.coordinates?.[0] ?? lat);
  const destLng = Number(bookingData?.src?.coordinates?.[1] ?? lng);
  const total = haversineMeters(lat, lng, destLat, destLng);
  const metersPerTick = SPEED_MPS * (TICK_MS / 1000);

  console.log(
    `\n🚗 ${driver.name} driving to pickup — ${Math.round(total)}m @ ~${Math.round(SPEED_MPS * 3.6)} km/h`
  );
  console.log("   Fetching road route…");

  let road = await fetchRoadRoute(lat, lng, destLat, destLng);
  if (road?.length) {
    // Ensure we start from current position
    if (
      haversineMeters(lat, lng, road[0].lat, road[0].lng) > 40
    ) {
      road = [{ lat, lng }, ...road];
    }
    console.log(`   ✅ Following ${road.length} road points`);
  } else {
    console.log("   ⚠️  No road data — straight line fallback");
  }

  let pathIndex = 0;
  let heading = bearingDegrees(lat, lng, destLat, destLng);
  await publishLocation(redis, socket, driver._id, lat, lng, heading);

  return new Promise((resolve) => {
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
        await publishLocation(redis, socket, driver._id, lat, lng, heading);
      } catch (err) {
        console.error("Location publish failed:", err.message);
      }

      const remaining = haversineMeters(lat, lng, destLat, destLng);
      console.log(
        `📍 ${driver.name} → ${lat.toFixed(5)}, ${lng.toFixed(5)}  hdg ${Math.round(heading)}°  (${Math.round(remaining)}m left)`
      );

      if (next.arrived || remaining <= ARRIVE_METERS) {
        clearInterval(tick);
        await publishLocation(
          redis,
          socket,
          driver._id,
          destLat,
          destLng,
          heading
        );
        console.log(`🛑 ${driver.name} arrived at pickup and stopped.`);
        resolve();
      }
    }, TICK_MS);
  });
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
  console.log("Mongo + Redis connected");

  let drivers = await Driver.find({
    licenseNumber: { $regex: /^SEED-/ },
    vehicleId: { $ne: null },
  }).populate("vehicleId");

  if (!drivers.length) {
    console.error("No seed drivers. Run: node scripts/seedNearby.js");
    process.exit(1);
  }

  await resetDriversNearHome(drivers);
  console.log(`Reset ${drivers.length} drivers near home and ready.`);

  const socketsByDriverId = new Map();
  let busy = false;
  const prev = drivers.find((d) => /ankit/i.test(d.name));
  let lastAcceptedId = prev?._id?.toString() || null;
  if (lastAcceptedId) {
    console.log(`Last driver was ${prev.name} — next accept will rotate.`);
  }
  let acceptQueue = Promise.resolve();

  const pickNextDriver = () => {
    const ordered = [
      ...drivers.filter((d) => d.vehicleId?.type === "car"),
      ...drivers.filter((d) => d.vehicleId?.type === "truck"),
      ...drivers.filter(
        (d) => !["car", "truck"].includes(d.vehicleId?.type)
      ),
    ];
    const candidates = lastAcceptedId
      ? ordered.filter((d) => d._id.toString() !== lastAcceptedId)
      : ordered;
    return candidates[0] || ordered[0];
  };

  for (const driver of drivers) {
    const token = await loginAsDriver(driver._id.toString());
    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      reconnection: true,
      auth: { token },
    });

    socket.on("connect", () => {
      socket.emit("driverConnected", driver._id.toString());
      console.log(
        `🟢 ${driver.name} online (${driver.vehicleId?.type})`
      );
    });

    socket.on("pickupRequested", (bookingData) => {
      acceptQueue = acceptQueue.then(async () => {
        const bookingId = (bookingData?._id || "").toString();
        if (!bookingId) return;
        if (busy) {
          console.log(`⏭  Busy — ${driver.name} ignoring duplicate`);
          return;
        }

        const chosen = pickNextDriver();
        if (chosen._id.toString() !== driver._id.toString()) {
          return;
        }

        busy = true;
        console.log(
          `\n📩 New request — assigning ${chosen.name} (${chosen.vehicleId?.type})`
        );
        console.log(
          `   ${bookingData?.srcText} → ${bookingData?.destnText}`
        );

        await new Promise((r) => setTimeout(r, 2000));

        try {
          await Driver.findByIdAndUpdate(chosen._id, { isAvailable: true });
          const result = await acceptBooking(
            bookingData,
            chosen._id.toString()
          );
          if (!result) {
            busy = false;
            return;
          }

          lastAcceptedId = chosen._id.toString();
          socket.emit("acceptBooking", {
            driverId: result.driverId,
            bookingId: result.bookingId,
            userId: result.userId?.toString?.() || result.userId,
          });
          console.log("📡 Accepted — track on frontend");
          await new Promise((r) => setTimeout(r, 1500));

          await startDriveToPickup({
            redis,
            socket,
            driver: chosen,
            bookingData,
          });

          await Driver.findByIdAndUpdate(chosen._id, { isAvailable: true });
          console.log(
            `\n✅ Trip simulation done. Next request will use a different driver.`
          );
          console.log("👀 Waiting for your next booking request…\n");
        } catch (err) {
          console.error("Error handling request:", err);
        } finally {
          busy = false;
        }
      });
    });

    socket.on("disconnect", () => {
      console.log(`🔴 ${driver.name} disconnected`);
    });

    socketsByDriverId.set(driver._id.toString(), socket);
  }

  console.log("\n👀 Ready for your next request (will use a DIFFERENT driver)…");
  console.log("   Request a booking on http://localhost:3001 now.\n");

  process.on("SIGINT", async () => {
    for (const s of socketsByDriverId.values()) s.close();
    redis.disconnect();
    await mongoose.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
