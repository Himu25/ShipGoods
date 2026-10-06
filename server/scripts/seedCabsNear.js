import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../src/models/User.js";
import Driver from "../src/models/Driver.js";
import Vehicle from "../src/models/Vehicle.js";

dotenv.config();

// Kosmos, Nagli Sabapur, Noida, Gautam Buddha Nagar, UP 201304
// Override: node seedCabsNear.js <lat> <lng>
const DEFAULT_LAT = Number(process.argv[2]) || 28.5078356;
const DEFAULT_LNG = Number(process.argv[3]) || 77.3829246;

// Placed 30-40km out at different bearings (0=N, 90=E, 180=S, 270=W)
// instead of a fixed lat/lng offset, so the distance is accurate regardless
// of location.
const cabs = [
  { bearing: 15, km: 32, name: "Rakesh Tiwari", plate: "UP16CB5001", model: "Swift Dzire" },
  { bearing: 95, km: 38, name: "Sanjay Kumar", plate: "UP16CB5002", model: "Honda Amaze" },
  { bearing: 170, km: 35, name: "Imran Khan", plate: "UP16CB5003", model: "Hyundai Xcent" },
  { bearing: 245, km: 40, name: "Deepak Rawat", plate: "UP16CB5004", model: "Maruti WagonR" },
  { bearing: 310, km: 30, name: "Vijay Pal", plate: "UP16CB5005", model: "Tata Tigor" },
];

/** Point `distanceMeters` away from (lat,lng) along `bearingDeg`. */
function destinationPoint(lat, lng, bearingDeg, distanceMeters) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const δ = distanceMeters / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");
  console.log(`Seeding ${cabs.length} cabs near lat=${DEFAULT_LAT}, lng=${DEFAULT_LNG}`);

  await User.deleteMany({ email: { $regex: /@cabseed\.shipgoods\.local$/i } });
  await Driver.deleteMany({ licenseNumber: { $regex: /^CABSEED-/ } });
  await Vehicle.deleteMany({ numberPlate: { $in: cabs.map((c) => c.plate) } });

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

  for (let i = 0; i < cabs.length; i++) {
    const c = cabs[i];
    const { lat, lng } = destinationPoint(DEFAULT_LAT, DEFAULT_LNG, c.bearing, c.km * 1000);
    const licenseNumber = `CABSEED-DL-${2000 + i}`;
    const email = `cabdriver${i + 1}@cabseed.shipgoods.local`;

    const driver = await Driver.create({
      name: c.name,
      licenseNumber,
      isAvailable: true,
      adminId: admin._id,
      currentLocation: { type: "Point", coordinates: [lng, lat] },
    });

    const vehicle = await Vehicle.create({
      type: "car",
      numberPlate: c.plate,
      model: c.model,
      adminId: admin._id,
      driverId: driver._id,
    });

    driver.vehicleId = vehicle._id;
    await driver.save();

    await User.create({
      name: c.name,
      email,
      password: defaultPass,
      role: "driver",
      driverId: driver._id,
    });

    created.push({ name: c.name, email, model: c.model, plate: c.plate, km: c.km, lat, lng });
  }

  console.log("\nSeeded cab drivers (password for all):", defaultPass);
  console.table(created);
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
