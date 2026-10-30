// The per-customer showcase bot (DEMO_MODE=true). It behaves exactly like
// the driver app: logs in with its own JWT, accepts over REST, announces
// the accept over Socket.IO, then streams driverLocationUpdate along the
// same OSRM road route the customer's tracking map draws. Nothing here
// writes locations to Redis/Mongo directly; the normal socket handler does.
import jwt from "jsonwebtoken";
import { io as ioClient } from "socket.io-client";
import Booking from "../../models/Booking.js";
import Driver from "../../models/Driver.js";
import User from "../../models/User.js";
import getRedisClient from "../../redisClient.js";
import { clearActiveTrip } from "../voice/arrivalDetector.js";
import { bearingDegrees, haversineMeters, pickupLatLng } from "../voice/geo.js";

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const ACCEPT_DELAY_MS = 5000; // lets a real driver accept first
const TICK_MS = 1000;
// ~36 km/h city speed; DEMO_BOT_SPEED_MPS overrides it (e.g. faster tests).
const speedMps = () => Number(process.env.DEMO_BOT_SPEED_MPS) || 10;
const ARRIVE_METERS = 20; // the server marks "arrived" at <= 30 m
const MAX_TRIP_MS = 20 * 60 * 1000;
const PARKED_TICKS = 12; // > the 10 s Mongo write throttle
// A random start can sit behind a detour (hills, one-ways); only the last
// stretch of road is driven so the showcase stays a few minutes long.
const MAX_DRIVE_M = 3500;
const STATUS_CHECK_EVERY = 10; // ticks

// driverId -> { stop() } for drives running in this process.
const activeDrives = new Map();

export const isBotDriving = (driverId) => activeDrives.has(String(driverId));

const internalBaseUrl = () =>
  process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Closes a bot trip that's no longer being driven, so the bot is free. */
export async function finishBotTrip(booking) {
  await Booking.updateOne(
    { _id: booking._id, status: { $in: ["accepted", "arrived"] } },
    { status: "completed", completedTime: new Date() }
  );
  await Driver.updateOne({ _id: booking.driverId }, { isAvailable: true });
  await clearActiveTrip(getRedisClient(), booking.driverId);
}

/** Same request the tracking map makes, so the bot drives the drawn line. */
async function fetchRoute(from, to) {
  try {
    const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (data.code === "Ok" && coords?.length >= 2) {
      return coords.map(([lng, lat]) => ({ lat, lng }));
    }
  } catch (err) {
    console.warn("Bot route lookup failed, driving straight:", err.message);
  }
  return [from, to];
}

/** The tail of the route covering at most `maxMeters` before the end. */
function lastStretch(path, maxMeters) {
  let total = 0;
  for (let i = path.length - 1; i > 0; i -= 1) {
    total += haversineMeters(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
    if (total > maxMeters) return path.slice(i);
  }
  return path;
}

/** Walks `meters` further along the polyline from {index, lat, lng}. */
function advance(path, pos, meters) {
  let { index, lat, lng } = pos;
  let left = meters;
  while (index < path.length - 1 && left > 0) {
    const next = path[index + 1];
    const seg = haversineMeters(lat, lng, next.lat, next.lng);
    if (seg <= left) {
      left -= seg;
      index += 1;
      ({ lat, lng } = next);
    } else {
      const f = left / seg;
      lat += (next.lat - lat) * f;
      lng += (next.lng - lng) * f;
      left = 0;
    }
  }
  return { index, lat, lng };
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(internalBaseUrl(), {
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => {
      socket.close();
      reject(err);
    });
  });
}

async function runBotTrip(bookingId, botDriverId) {
  const key = String(botDriverId);
  activeDrives.get(key)?.stop();
  let stopped = false;
  const handle = { stop: () => (stopped = true) };
  activeDrives.set(key, handle);

  let socket;
  try {
    const [booking, bot, botUser] = await Promise.all([
      Booking.findById(bookingId).lean(),
      Driver.findById(botDriverId).lean(),
      User.findOne({ driverId: botDriverId }).select("_id email").lean(),
    ]);
    if (!booking || booking.status !== "pending" || !bot || !botUser) return;

    // Earlier trip still open (bot was mid-drive or the server restarted).
    const previous = await Booking.findOne({
      driverId: bot._id,
      status: { $in: ["accepted", "arrived"] },
    }).lean();
    if (previous) await finishBotTrip(previous);

    const token = jwt.sign(
      { id: botUser._id, email: botUser.email, role: "driver", driverId: bot._id },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await fetch(`${internalBaseUrl()}/api/booking/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bookingId: String(bookingId) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return; // a real driver got there first, or it was cancelled

    socket = await connectSocket(token);
    socket.emit("driverConnected");
    socket.emit("acceptBooking", { bookingId: String(bookingId) });

    const pickup = pickupLatLng(booking.src);
    const [startLng, startLat] = bot.currentLocation.coordinates;
    const path = lastStretch(await fetchRoute({ lat: startLat, lng: startLng }, pickup), MAX_DRIVE_M);
    let pos = { index: 0, lat: path[0].lat, lng: path[0].lng };
    console.log(`Bot ${key} accepted booking ${bookingId}; driving ${path.length} route points`);

    const deadline = Date.now() + MAX_TRIP_MS;
    for (let tick = 0; !stopped && Date.now() < deadline; tick += 1) {
      const next = advance(path, pos, (speedMps() * TICK_MS) / 1000);
      const heading = bearingDegrees(pos.lat, pos.lng, next.lat, next.lng);
      pos = next;
      socket.emit("driverLocationUpdate", { latitude: pos.lat, longitude: pos.lng, heading });

      let arrived =
        haversineMeters(pos.lat, pos.lng, pickup.lat, pickup.lng) <= ARRIVE_METERS ||
        pos.index >= path.length - 1;
      if (!arrived && tick % STATUS_CHECK_EVERY === 0) {
        const current = await Booking.findById(bookingId).select("status").lean();
        // The server marks "arrived" at 30 m, before the bot's own check.
        if (current?.status === "arrived") arrived = true;
        else if (current?.status !== "accepted") break; // cancelled
      }

      if (arrived) {
        // Park on the pin and keep reporting like a waiting driver app, so
        // the throttled Mongo write catches up with the final position.
        for (let t = 0; t < PARKED_TICKS && !stopped; t += 1) {
          socket.emit("driverLocationUpdate", {
            latitude: pickup.lat,
            longitude: pickup.lng,
            heading,
          });
          await sleep(TICK_MS);
        }
        break;
      }
      await sleep(TICK_MS);
    }
  } catch (err) {
    console.error(`Bot trip ${bookingId} failed:`, err.message);
  } finally {
    socket?.close();
    if (activeDrives.get(key) === handle) activeDrives.delete(key);
  }
}

/** Booking just created: the customer's bot accepts it after a short
 * delay unless a real driver already has. */
export async function scheduleBotForBooking(booking) {
  if (process.env.DEMO_MODE !== "true" || booking.isScheduled) return;
  const bot = await Driver.findOne({ demo: "bot", demoOwnerId: booking.userId })
    .select("_id")
    .lean();
  if (!bot) return;
  setTimeout(() => {
    runBotTrip(booking._id, bot._id).catch((err) =>
      console.error("Bot trip error:", err.message)
    );
  }, ACCEPT_DELAY_MS);
}
