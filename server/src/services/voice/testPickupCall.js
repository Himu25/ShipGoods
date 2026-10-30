/**
 * Test pickup call with live data: a fake customer/driver/vehicle (created
 * once and reused) and a fresh accepted booking, then the normal
 * startPickupCall path rings VOICE_TEST_NUMBER — never a real customer.
 *
 * While the call runs, the driver drives along the real road towards the
 * pickup (its live location in Redis moves every few seconds), so the
 * agent's trip_info tool returns an ETA and distance that shrink during
 * the call, exactly like a real pickup.
 */
import Booking from "../../models/Booking.js";
import Driver from "../../models/Driver.js";
import User from "../../models/User.js";
import Vehicle from "../../models/Vehicle.js";
import { isSarvamConfigured, missingSarvamConfig, normalizePhone } from "../sarvam/outbound.js";
import { startPickupCall } from "./arrivalDetector.js";

const OSRM = "https://router.project-osrm.org/route/v1/driving";
// Connaught Place, New Delhi — pickup; driver starts ~1.5 km south of it.
const PICKUP = { lat: 28.6315, lng: 77.2167 };
const DRIVER_AT = { lat: 28.618, lng: 77.2167 };
const TEST_EMAIL_DOMAIN = "voice-test.shipgoods.local";
const DRIVE_TICK_MS = 3000;
const DRIVE_SPEED_MPS = 5.5; // ~20 km/h city traffic
const DRIVE_MAX_MS = 10 * 60 * 1000;
const STOP_SHORT_METERS = 60; // park just before pickup instead of arriving

let activeDrive = null;

async function findOrCreateFixtures() {
  let admin = await User.findOne({ email: `admin@${TEST_EMAIL_DOMAIN}` });
  if (!admin) {
    admin = await User.create({
      name: "Voice Test Admin",
      email: `admin@${TEST_EMAIL_DOMAIN}`,
      password: "voice-test-only",
      role: "admin",
    });
  }

  let customer = await User.findOne({ email: `customer@${TEST_EMAIL_DOMAIN}` });
  if (!customer) {
    customer = await User.create({
      name: "Voice Test Customer",
      email: `customer@${TEST_EMAIL_DOMAIN}`,
      password: "voice-test-only",
      role: "user",
    });
  }

  let vehicle = await Vehicle.findOne({ numberPlate: "DL1C1234" });
  if (!vehicle) {
    vehicle = await Vehicle.create({
      type: "truck",
      numberPlate: "DL1C1234",
      model: "Tata Ace",
      adminId: admin._id,
    });
  }

  let driver = await Driver.findOne({ licenseNumber: "VOICE-TEST-DL" });
  if (!driver) {
    driver = await Driver.create({
      name: "Ramesh Kumar",
      licenseNumber: "VOICE-TEST-DL",
      adminId: admin._id,
      vehicleId: vehicle._id,
      isAvailable: false,
    });
  }

  return { customer, driver, vehicle };
}

function metersBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

async function roadPath(from, to) {
  try {
    const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const data = await (await fetch(url)).json();
    const coords = data.routes?.[0]?.geometry?.coordinates;
    if (data.code === "Ok" && coords?.length > 1) {
      return coords.map(([lng, lat]) => ({ lat, lng }));
    }
  } catch {
    /* straight line below */
  }
  return [from, to];
}

function writeLocation(redis, driverId, pos, heading) {
  return redis.set(
    `driver:${driverId}:location`,
    JSON.stringify({ latitude: pos.lat, longitude: pos.lng, heading, updatedAt: Date.now() }),
    "EX",
    15 * 60
  );
}

/** Moves the test driver along the road to the pickup in Redis. */
async function driveTowardsPickup(redis, driverId) {
  activeDrive?.stop();
  const path = await roadPath(DRIVER_AT, PICKUP);
  let leg = 0;
  let pos = path[0];
  let heading = 0;
  const startedAt = Date.now();

  const timer = setInterval(async () => {
    let budget = (DRIVE_SPEED_MPS * DRIVE_TICK_MS) / 1000;
    while (budget > 0 && leg < path.length - 1) {
      const next = path[leg + 1];
      const gap = metersBetween(pos, next);
      if (gap <= budget) {
        budget -= gap;
        pos = next;
        leg += 1;
      } else {
        const t = budget / gap;
        heading = (Math.atan2(next.lng - pos.lng, next.lat - pos.lat) * 180) / Math.PI;
        pos = { lat: pos.lat + (next.lat - pos.lat) * t, lng: pos.lng + (next.lng - pos.lng) * t };
        budget = 0;
      }
    }
    const done =
      metersBetween(pos, PICKUP) <= STOP_SHORT_METERS || Date.now() - startedAt > DRIVE_MAX_MS;
    try {
      await writeLocation(redis, driverId, pos, (heading + 360) % 360);
    } catch (err) {
      console.error("[test-call] driver location update failed:", err.message);
    }
    if (done) stop();
  }, DRIVE_TICK_MS);

  const stop = () => {
    clearInterval(timer);
    if (activeDrive?.timer === timer) activeDrive = null;
  };
  activeDrive = { timer, stop };
}

/** Why a test call can't be placed right now, or null if it can. */
export function testCallBlocker() {
  if (!normalizePhone(process.env.VOICE_TEST_NUMBER)) {
    return "VOICE_TEST_NUMBER is not set (test calls never ring a real customer)";
  }
  if (!isSarvamConfigured()) {
    return `Sarvam is not configured; missing: ${missingSarvamConfig().join(", ")}`;
  }
  return null;
}

/**
 * Creates the fake booking, parks the driver ~1.5 km from pickup, dials
 * VOICE_TEST_NUMBER and (unless `drive` is false) starts the driver moving.
 * Resolves to { booking, call }.
 */
export async function placeTestPickupCall({ io = null, redis, drive = true }) {
  const blocker = testCallBlocker();
  if (blocker) throw new Error(blocker);

  const { customer, driver, vehicle } = await findOrCreateFixtures();
  const booking = await Booking.create({
    userId: customer._id,
    driverId: driver._id,
    vehicleId: vehicle._id,
    status: "accepted",
    srcText: "Connaught Place, New Delhi",
    destnText: "Karol Bagh, New Delhi",
    // [lat, lng], same convention as the rest of the codebase.
    src: { type: "Point", coordinates: [PICKUP.lat, PICKUP.lng] },
    destn: { type: "Point", coordinates: [28.6519, 77.1909] },
    price: 250,
  });

  await writeLocation(redis, driver._id, DRIVER_AT, 0);

  const call = await startPickupCall({
    io,
    redis,
    bookingId: booking._id,
    userId: customer._id,
    driverId: driver._id,
    distanceM: 1500,
    etaMinutes: 5,
  });

  if (drive && call?.channel === "sarvam") await driveTowardsPickup(redis, driver._id);
  return { booking, call };
}
