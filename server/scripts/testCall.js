/**
 * Rings VOICE_TEST_NUMBER through our own Sarvam outbound path for a fake
 * booking (fake customer/driver/vehicle are created once and reused; a
 * fresh accepted booking is created each run, since a booking only ever
 * gets one pickup call). The driver is parked ~1.5 km from pickup in
 * Redis so the agent's trip-info tool returns a real ETA.
 *
 * Needs the server running and reachable at PUBLIC_BASE_URL, so the
 * agent's tools and the end-of-call webhook land somewhere.
 * Run: node scripts/testCall.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Booking from "../src/models/Booking.js";
import Driver from "../src/models/Driver.js";
import User from "../src/models/User.js";
import Vehicle from "../src/models/Vehicle.js";
import getRedisClient from "../src/redisClient.js";
import { startPickupCall } from "../src/services/voice/arrivalDetector.js";
import { missingSarvamConfig } from "../src/services/sarvam/outbound.js";

dotenv.config();

// Connaught Place, New Delhi — pickup; driver ~1.5 km south of it.
const PICKUP = { lat: 28.6315, lng: 77.2167 };
const DRIVER_AT = { lat: 28.618, lng: 77.2167 };
const TEST_EMAIL_DOMAIN = "voice-test.shipgoods.local";

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

async function main() {
  if (!process.env.VOICE_TEST_NUMBER) {
    console.error("Set VOICE_TEST_NUMBER in server/.env first — this script never calls a real customer.");
    process.exit(1);
  }
  const missing = missingSarvamConfig();
  if (missing.length) {
    console.error(`Sarvam is not configured. Missing in server/.env: ${missing.join(", ")}`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const redis = getRedisClient();

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

  // Long TTL so trip-info still sees the driver for the whole test call.
  await redis.set(
    `driver:${driver._id}:location`,
    JSON.stringify({ latitude: DRIVER_AT.lat, longitude: DRIVER_AT.lng, heading: 0, updatedAt: Date.now() }),
    "EX",
    15 * 60
  );

  console.log(`Fake booking ${booking._id} (driver ${driver._id}). Calling ${process.env.VOICE_TEST_NUMBER}…`);
  const call = await startPickupCall({
    io: null,
    redis,
    bookingId: booking._id,
    userId: customer._id,
    driverId: driver._id,
    distanceM: 1500,
    etaMinutes: 5,
  });

  if (call?.channel === "sarvam" && call.sarvamAttemptId) {
    console.log(`Call placed. VoiceCall ${call._id}, Sarvam attempt ${call.sarvamAttemptId}.`);
    console.log("Watch the server log for tool hits and the end-of-call webhook.");
  } else {
    console.error(`Sarvam did not take the call (VoiceCall ${call?._id} fell back to ${call?.channel}). See the error above.`);
    process.exitCode = 1;
  }

  await mongoose.disconnect();
  redis.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
