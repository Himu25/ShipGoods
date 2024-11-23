import mongoose from "mongoose";

const driverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  licenseNumber: {
    type: String,
    required: true,
    trim: true,
  },
  isAvailable: {
    type: Boolean,
    default: true,
  },
  currentLocation: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point",
    },
    coordinates: {
      type: [Number],
      default: [0, 0],
    },
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vehicle",
  },
});

driverSchema.index({ currentLocation: "2dsphere" });

const Driver = mongoose.model("Driver", driverSchema);
export default Driver;
