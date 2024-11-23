import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    distance: {
      type: Number,
    },
    duration: {
      type: Number,
    },
    collectedTime: {
      type: Date,
    },
    completedTime: {
      type: Date,
    },
    isScheduled: {
      type: Boolean,
      default: false,
    },
    scheduledTime: {
      type: Date,
      validate: {
        validator: function (v) {
          return !this.isScheduled || v != null;
        },
        message: (props) => `scheduledTime is required if isScheduled is true!`,
      },
    },
    srcText: {
      type: String,
    },
    destnText: {
      type: String,
    },
    src: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    destn: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: false,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
    },
    price: {
      type: Number,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "collected", "completed", "cancelled"],
      default: "pending",
    },
    paymentId: {
      type: String,
    },
    rating: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

const Booking = mongoose.model("Booking", bookingSchema);
export default Booking;
