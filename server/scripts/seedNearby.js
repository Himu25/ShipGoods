import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import User from "../src/models/User.js";
import Driver from "../src/models/Driver.js";
import Vehicle from "../src/models/Vehicle.js";

dotenv.config();

// Approx user location (Ghaziabad / NCR). Override: node seedNearby.js <lat> <lng>
const DEFAULT_LAT = Number(process.argv[2]) || 28.6654;
const DEFAULT_LNG = Number(process.argv[3]) || 77.4391;

const offsets = [
  { dLat: 0.004, dLng: 0.003, type: "car", name: "Rahul Verma", plate: "UP14AB1001", model: "Swift Dzire" },
  { dLat: -0.003, dLng: 0.005, type: "car", name: "Amit Sharma", plate: "UP14AB1002", model: "Honda City" },
  { dLat: 0.006, dLng: -0.002, type: "car", name: "Priya Singh", plate: "UP14AB1003", model: "WagonR" },
  { dLat: -0.002, dLng: -0.004, type: "car", name: "Ankit Joshi", plate: "UP14AB1004", model: "Hyundai i20" },
  // Trucks close by
  { dLat: 0.003, dLng: 0.004, type: "truck", name: "Suresh Yadav", plate: "UP14TR2001", model: "Tata Ace" },
  { dLat: -0.005, dLng: 0.002, type: "truck", name: "Vikram Patel", plate: "UP14TR2002", model: "Mahindra Bolero Pickup" },
  { dLat: 0.005, dLng: -0.005, type: "truck", name: "Ramesh Chauhan", plate: "UP14TR2003", model: "Ashok Leyland Dost" },
  { dLat: -0.004, dLng: 0.006, type: "truck", name: "Deepak Singh", plate: "UP14TR2004", model: "Tata 407" },
  { dLat: 0.007, dLng: 0.001, type: "motorcycle", name: "Rohit Kumar", plate: "UP14MC3001", model: "Activa 6G" },
  { dLat: -0.001, dLng: -0.006, type: "motorcycle", name: "Neha Gupta", plate: "UP14MC3002", model: "Pulsar 150" },
  { dLat: 0.002, dLng: -0.007, type: "bus", name: "Karan Mehta", plate: "UP14BS4001", model: "Force Traveller" },
];

function metersOffset(lat, lng, dLat, dLng) {
  // rough ~111km per degree
  const meters = Math.sqrt((dLat * 111000) ** 2 + (dLng * 111000 * Math.cos((lat * Math.PI) / 180)) ** 2);
  return Math.round(meters);
}

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");
  console.log(`Seeding near lat=${DEFAULT_LAT}, lng=${DEFAULT_LNG}`);

  // Remove previous seed data for a clean re-run
  await User.deleteMany({ email: { $regex: /@seed\.shipgoods\.local$/i } });
  await Driver.deleteMany({ licenseNumber: { $regex: /^SEED-/ } });
  await Vehicle.deleteMany({ numberPlate: { $in: offsets.map((o) => o.plate) } });

  let admin = await User.findOne({ role: "admin" });
  if (!admin) {
    admin = await User.create({
      name: "Seed Admin",
      email: "admin@seed.shipgoods.local",
      password: process.env.defaultPass || "123456789",
      role: "admin",
    });
    console.log("Created admin:", admin.email);
  } else {
    console.log("Using existing admin:", admin.email);
  }

  const defaultPass = process.env.defaultPass || "123456789";
  const created = [];

  for (let i = 0; i < offsets.length; i++) {
    const o = offsets[i];
    const lat = DEFAULT_LAT + o.dLat;
    const lng = DEFAULT_LNG + o.dLng;
    const licenseNumber = `SEED-DL-${1000 + i}`;
    const email = `driver${i + 1}@seed.shipgoods.local`;

    const driver = await Driver.create({
      name: o.name,
      licenseNumber,
      isAvailable: true,
      adminId: admin._id,
      currentLocation: {
        type: "Point",
        coordinates: [lng, lat], // GeoJSON: [lng, lat]
      },
    });

    const vehicle = await Vehicle.create({
      type: o.type,
      numberPlate: o.plate,
      model: o.model,
      adminId: admin._id,
      driverId: driver._id,
    });

    driver.vehicleId = vehicle._id;
    await driver.save();

    await User.create({
      name: o.name,
      email,
      password: defaultPass,
      role: "driver",
      driverId: driver._id,
    });

    created.push({
      name: o.name,
      email,
      type: o.type,
      approxMeters: metersOffset(DEFAULT_LAT, DEFAULT_LNG, o.dLat, o.dLng),
      lat,
      lng,
    });
  }

  console.log("\nSeeded drivers (password for all):", defaultPass);
  console.table(created);
  console.log(`Admin login: ${admin.email} / ${defaultPass}`);
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
