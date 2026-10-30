// Showcase mode (DEMO_MODE=true): every customer sees at least
// MIN_NEARBY drivers of the vehicle type they picked, plus their own bot
// driver (see botDriver.js) that accepts their bookings. Off by default.
import crypto from "crypto";
import mongoose from "mongoose";
import Booking from "../../models/Booking.js";
import Driver from "../../models/Driver.js";
import User from "../../models/User.js";
import Vehicle from "../../models/Vehicle.js";
import { haversineMeters } from "../voice/geo.js";
import { finishBotTrip, isBotDriving } from "./botDriver.js";

export const isDemoMode = () => process.env.DEMO_MODE === "true";

const MIN_NEARBY = 5;
const NEARBY_RADIUS_M = 3000;
const FILLER_MIN_M = 300;
const FILLER_MAX_M = 1200;
// Far enough that the bot's drive is visible on the map, close enough to
// arrive in a few minutes.
const BOT_MIN_M = 1500;
const BOT_MAX_M = 2500;
const ENSURE_LOCK_SEC = 15;

const FILLER_NAMES = [
  "Arjun Mehra", "Sunil Yadav", "Pooja Rawat", "Imran Khan", "Vivek Tiwari",
  "Kavita Negi", "Manoj Gupta", "Ritesh Saini", "Anil Chauhan", "Farhan Ali",
  "Deepa Joshi", "Rakesh Bisht", "Sanjay Pal", "Nisha Verma", "Gopal Das",
];
const MODELS = {
  car: ["Maruti Swift Dzire", "Hyundai i20", "Honda Amaze", "Tata Tiago"],
  truck: ["Tata Ace Gold", "Mahindra Bolero Pickup", "Ashok Leyland Dost", "Tata 407"],
  motorcycle: ["Honda Activa 6G", "Bajaj Pulsar 150", "TVS Jupiter", "Hero Splendor"],
  bus: ["Force Traveller", "Tata Winger", "Eicher Skyline"],
};
const VEHICLE_TYPES = Object.keys(MODELS);

const pick = (list) => list[crypto.randomInt(list.length)];
const randomBetween = (min, max) => min + Math.random() * (max - min);

/** A point `meters` from (lat, lng) on a random bearing. */
function offsetPoint(lat, lng, meters) {
  const bearing = Math.random() * 2 * Math.PI;
  const dLat = (meters * Math.cos(bearing)) / 111320;
  const dLng = (meters * Math.sin(bearing)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

const geoPoint = ({ lat, lng }) => ({ type: "Point", coordinates: [lng, lat] });

/** Demo drivers need an owning admin; reuse one, or create a locked one. */
async function demoAdminId() {
  const admin = await User.findOne({ role: "admin" }).select("_id").lean();
  if (admin) return admin._id;
  const created = await User.create({
    name: "ShipGoods Demo Admin",
    email: "demo-admin@demo.shipgoods.local",
    password: crypto.randomBytes(24).toString("hex"),
    role: "admin",
  });
  return created._id;
}

async function uniquePlate(prefix) {
  for (let i = 0; i < 5; i += 1) {
    const plate = `${prefix}${crypto.randomInt(1000, 9999)}`;
    if (!(await Vehicle.exists({ numberPlate: plate }))) return plate;
  }
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

/** Bot driver + vehicle + login for a customer; created once, then reused. */
async function getOrCreateBot(userId, vehicleType, near) {
  const existing = await Driver.findOne({ demo: "bot", demoOwnerId: userId });
  if (existing) return existing;

  const adminId = await demoAdminId();
  const start = offsetPoint(near.lat, near.lng, randomBetween(BOT_MIN_M, BOT_MAX_M));
  const driver = await Driver.create({
    name: "ShipGoods Bot",
    licenseNumber: `DEMO-BOT-${String(userId).slice(-8)}`,
    isAvailable: true,
    adminId,
    demo: "bot",
    demoOwnerId: userId,
    currentLocation: geoPoint(start),
  });
  const vehicle = await Vehicle.create({
    type: vehicleType,
    numberPlate: await uniquePlate("BOT"),
    model: pick(MODELS[vehicleType]),
    adminId,
    driverId: driver._id,
  });
  driver.vehicleId = vehicle._id;
  await driver.save();
  // The bot logs in like any driver (JWT minted in botDriver.js), so it
  // needs a driver User; the password is random and never used.
  await User.create({
    name: "ShipGoods Bot",
    email: `bot-${userId}@demo.shipgoods.local`,
    password: crypto.randomBytes(24).toString("hex"),
    role: "driver",
    driverId: driver._id,
  });
  return driver;
}

/** Between bookings: match the customer's vehicle type and park 1.5-2.5 km
 * from their pickup so the next drive is visible. */
async function readyBot(bot, vehicleType, near) {
  if (isBotDriving(bot._id)) return;
  const activeTrip = await Booking.findOne({
    driverId: bot._id,
    status: { $in: ["accepted", "arrived"] },
  });
  // A trip the bot already finished driving (arrived, or abandoned by a
  // restart) is closed so the bot can take the next booking.
  if (activeTrip) await finishBotTrip(activeTrip);

  await Vehicle.updateOne({ _id: bot.vehicleId }, { type: vehicleType });
  const [lng, lat] = bot.currentLocation?.coordinates || [0, 0];
  const distance = haversineMeters(lat, lng, near.lat, near.lng);
  const update = { isAvailable: true };
  if (distance < BOT_MIN_M || distance > BOT_MAX_M * 1.5) {
    update.currentLocation = geoPoint(
      offsetPoint(near.lat, near.lng, randomBetween(BOT_MIN_M, BOT_MAX_M))
    );
  }
  await Driver.updateOne({ _id: bot._id }, update);
}

/** Tops the area up to MIN_NEARBY available drivers of this type. */
async function ensureFillers(vehicleType, near) {
  const nearby = await Driver.aggregate([
    {
      $geoNear: {
        near: geoPoint(near),
        distanceField: "dist",
        maxDistance: NEARBY_RADIUS_M,
        spherical: true,
        query: { isAvailable: true, demo: { $ne: "bot" } },
      },
    },
    { $lookup: { from: "vehicles", localField: "vehicleId", foreignField: "_id", as: "v" } },
    { $match: { "v.type": vehicleType } },
    { $count: "n" },
  ]);
  const missing = MIN_NEARBY - (nearby[0]?.n || 0);
  if (missing <= 0) return 0;

  const adminId = await demoAdminId();
  for (let i = 0; i < missing; i += 1) {
    const at = offsetPoint(near.lat, near.lng, randomBetween(FILLER_MIN_M, FILLER_MAX_M));
    const driver = await Driver.create({
      name: pick(FILLER_NAMES),
      licenseNumber: `DEMO-${crypto.randomInt(100000, 999999)}`,
      isAvailable: true,
      adminId,
      demo: "filler",
      currentLocation: geoPoint(at),
    });
    const vehicle = await Vehicle.create({
      type: vehicleType,
      numberPlate: await uniquePlate("DEMO"),
      model: pick(MODELS[vehicleType]),
      adminId,
      driverId: driver._id,
    });
    await Driver.updateOne({ _id: driver._id }, { vehicleId: vehicle._id });
  }
  return missing;
}

/**
 * Called from /nearby-drivers for customers. Idempotent and cheap once the
 * area is stocked; a short Redis lock stops a burst of map re-renders from
 * creating duplicates.
 */
export async function ensureDemoFleet({ redis, userId, latitude, longitude, vehicleType }) {
  if (!isDemoMode() || !VEHICLE_TYPES.includes(vehicleType)) return;
  if (!mongoose.isValidObjectId(userId)) return;

  const lock = await redis.set(
    `demo:ensure:${userId}:${vehicleType}`,
    "1",
    "EX",
    ENSURE_LOCK_SEC,
    "NX"
  );
  if (!lock) return;

  const near = { lat: latitude, lng: longitude };
  const added = await ensureFillers(vehicleType, near);
  const bot = await getOrCreateBot(userId, vehicleType, near);
  await readyBot(bot, vehicleType, near);
  if (added) console.log(`Demo: added ${added} ${vehicleType} driver(s) near ${latitude},${longitude}`);
}
