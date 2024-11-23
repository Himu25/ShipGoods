import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["car", "truck", "bus", "motorcycle"],
    },
    numberPlate: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    model: {
      type: String,
      required: true,
      trim: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
    },
    imageUrl: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const Vehicle = mongoose.model("Vehicle", vehicleSchema);
export default Vehicle;
