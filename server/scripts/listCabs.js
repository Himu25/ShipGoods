import mongoose from "mongoose";
import dotenv from "dotenv";
import Driver from "../src/models/Driver.js";
import Vehicle from "../src/models/Vehicle.js";

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
const drivers = await Driver.find({ licenseNumber: { $regex: /^CABSEED-/ } }).populate("vehicleId");
drivers.forEach((d) =>
  console.log(d._id.toString(), d.name, d.vehicleId?.numberPlate, "available:", d.isAvailable)
);
await mongoose.disconnect();
