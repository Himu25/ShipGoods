import express from "express";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Driver from "../models/Driver.js";
import {
  authenticateToken,
  authorizeRole,
  requireDriver,
  resolveDriverId,
} from "../middleware/index.js";
import getRedisClient from "../redisClient.js";
import { cacheActiveTrip, clearActiveTrip } from "../services/voice/arrivalDetector.js";
import { pickupLatLng } from "../services/voice/geo.js";

const router = express.Router();

// Statuses a driver moves a booking through after accepting it.
const DRIVER_STATUSES = ["arrived", "collected", "completed", "cancelled"];
const STATUS_TIME_FIELD = {
  arrived: "arrivedTime",
  collected: "collectedTime",
  completed: "completedTime",
};

function isLatLng(coords) {
  return (
    Array.isArray(coords) &&
    coords.length === 2 &&
    coords.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    Math.abs(coords[0]) <= 90 &&
    Math.abs(coords[1]) <= 180
  );
}

function validId(req, res, key) {
  if (mongoose.isValidObjectId(req.params[key])) return true;
  res.status(400).json({ message: "Invalid booking id." });
  return false;
}

/** Pending trip offers for online drivers (polling fallback). */
router.get(
  "/booking/pending",
  authenticateToken,
  requireDriver,
  async (req, res) => {
    try {
      const bookings = await Booking.find({ status: "pending" })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      res.status(200).json({ bookings });
    } catch (error) {
      console.error("Pending bookings error:", error.message);
      res.status(500).json({ message: "Error fetching pending bookings." });
    }
  }
);

/** Driver marks themselves available again (demo / after trip). */
router.post(
  "/booking/free-driver",
  authenticateToken,
  requireDriver,
  async (req, res) => {
    try {
      await Driver.findByIdAndUpdate(req.driverId, { isAvailable: true });
      res.status(200).json({ message: "Driver is available." });
    } catch (error) {
      console.error("Free driver error:", error.message);
      res.status(500).json({ message: "Error freeing driver." });
    }
  }
);

router.post(
  "/booking/create",
  authenticateToken,
  authorizeRole("user"),
  async (req, res) => {
    const {
      distance,
      duration,
      src,
      destn,
      price,
      srcText,
      destnText,
      isScheduled,
      scheduledTime,
    } = req.body;

    // Coordinates are stored [lat, lng] throughout this codebase (see geo.js).
    if (!isLatLng(src?.coordinates) || !isLatLng(destn?.coordinates)) {
      return res.status(400).json({ message: "src and destn need [lat, lng] coordinates." });
    }
    if (!Number.isFinite(Number(price)) || Number(price) <= 0) {
      return res.status(400).json({ message: "A positive price is required." });
    }

    try {
      const savedBooking = await Booking.create({
        distance,
        duration,
        src: { type: "Point", coordinates: src.coordinates },
        destn: { type: "Point", coordinates: destn.coordinates },
        userId: req.user.id,
        price: Number(price),
        srcText,
        destnText,
        status: "pending",
        isScheduled: Boolean(isScheduled),
        scheduledTime,
      });

      res.status(201).json({
        message: "Booking added successfully.",
        booking: savedBooking,
      });
    } catch (error) {
      console.error("Create booking error:", error.message);
      const status = error.name === "ValidationError" ? 400 : 500;
      res.status(status).json({ message: "Error adding booking." });
    }
  }
);

router.get(
  "/booking/scheduled/:driverId",
  authenticateToken,
  requireDriver,
  async (req, res) => {
    // A driver only sees their own schedule, whatever id is in the URL.
    try {
      const bookings = await Booking.find({
        driverId: req.driverId,
        isScheduled: true,
        status: "accepted",
      });

      res.status(200).json({
        message: "Scheduled bookings fetched successfully.",
        bookings,
      });
    } catch (error) {
      console.error("Scheduled bookings error:", error.message);
      res.status(500).json({ message: "Error fetching bookings." });
    }
  }
);

router.post("/booking/accept", authenticateToken, requireDriver, async (req, res) => {
  const { bookingId } = req.body;
  const driverId = req.driverId;
  if (!mongoose.isValidObjectId(bookingId)) {
    return res.status(400).json({ message: "Invalid booking id." });
  }

  try {
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }

    // Atomic claim: only one concurrent request can match status:"pending"
    // and flip it to "accepted" for a given booking. A plain
    // findById -> check -> save lets two near-simultaneous requests both
    // read "pending" before either writes, so both pass the check.
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: bookingId, status: "pending" },
      { driverId, vehicleId: driver.vehicleId, status: "accepted" },
      { new: true }
    );

    if (!updatedBooking) {
      const existing = await Booking.findById(bookingId);
      if (!existing) {
        return res.status(404).json({ message: "Booking not found." });
      }
      return res.status(400).json({
        message:
          existing.status === "accepted"
            ? "Booking has already been accepted by another driver."
            : "Booking is not available for acceptance.",
      });
    }

    if (!updatedBooking.isScheduled) {
      driver.isAvailable = false;
      await driver.save();
    }

    // Route this driver's live location to the rider and arm the pickup
    // call here, so neither depends on the client's acceptBooking emit.
    const redis = getRedisClient();
    await redis.set(`driverAssignedToUser:${driverId}`, String(updatedBooking.userId));
    const pickup = pickupLatLng(updatedBooking.src);
    if (pickup) {
      await cacheActiveTrip(redis, {
        driverId,
        userId: updatedBooking.userId,
        bookingId: updatedBooking._id,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
      });
    }

    res.status(200).json({
      message: "Booking accepted successfully.",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Accept booking error:", error.message);
    res.status(500).json({ message: "Error accepting booking." });
  }
});

router.get("/bookings", authenticateToken, async (req, res) => {
  try {
    const bookings = await Booking.find({ userId: req.user.id })
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 });

    res.status(200).json(bookings);
  } catch (error) {
    console.error("List bookings error:", error.message);
    res.status(500).json({ message: "Error fetching booking." });
  }
});

router.get("/booking/:id", authenticateToken, async (req, res) => {
  if (!validId(req, res, "id")) return;

  try {
    const booking = await Booking.findById(req.params.id).populate("driverId");
    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    // The customer, the assigned driver, or an admin.
    const isOwner = String(booking.userId) === String(req.user.id);
    const isAdmin = req.user.role === "admin";
    const isAssignedDriver =
      !isOwner &&
      !isAdmin &&
      Boolean(booking.driverId) &&
      String(booking.driverId._id) === (await resolveDriverId(req.user));
    if (!isOwner && !isAdmin && !isAssignedDriver) {
      return res.sendStatus(403);
    }

    res.status(200).json({ booking });
  } catch (error) {
    console.error("Get booking error:", error.message);
    res.status(500).json({ message: "Error fetching booking." });
  }
});

router.put(
  "/booking/update-status/:bookingId",
  authenticateToken,
  requireDriver,
  async (req, res) => {
    if (!validId(req, res, "bookingId")) return;
    const { status } = req.body;

    if (!DRIVER_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status provided." });
    }

    try {
      const updateFields = { status };
      if (STATUS_TIME_FIELD[status]) updateFields[STATUS_TIME_FIELD[status]] = new Date();

      // Only the driver assigned to the booking can move it along.
      const updatedBooking = await Booking.findOneAndUpdate(
        { _id: req.params.bookingId, driverId: req.driverId },
        updateFields,
        { new: true }
      );

      if (!updatedBooking) {
        return res.status(404).json({ message: "Booking not found." });
      }

      if (status === "completed" || status === "cancelled") {
        await Driver.findByIdAndUpdate(updatedBooking.driverId, { isAvailable: true });
        await clearActiveTrip(getRedisClient(), updatedBooking.driverId);
      }

      res.status(200).json({
        message: "Booking status updated successfully.",
        booking: updatedBooking,
      });
    } catch (error) {
      console.error("Update status error:", error.message);
      res.status(500).json({ message: "Server error while updating booking status." });
    }
  }
);

router.put("/booking/:bookingId/rate", authenticateToken, async (req, res) => {
  if (!validId(req, res, "bookingId")) return;
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Rating must be an integer from 1 to 5" });
  }

  try {
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: req.params.bookingId, userId: req.user.id },
      { rating },
      { new: true }
    );

    if (!updatedBooking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.status(200).json({ message: "Rating updated successfully" });
  } catch (error) {
    console.error("Rate booking error:", error.message);
    res.status(500).json({ error: "Failed to update rating" });
  }
});

router.put("/booking/:bookingId/payment", authenticateToken, async (req, res) => {
  if (!validId(req, res, "bookingId")) return;
  const { paymentId } = req.body;
  if (!paymentId || typeof paymentId !== "string") {
    return res.status(400).json({ message: "paymentId is required" });
  }

  try {
    const result = await Booking.findOneAndUpdate(
      { _id: req.params.bookingId, userId: req.user.id },
      { paymentId },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({
      message: "Payment ID updated successfully",
    });
  } catch (error) {
    console.error("Payment id error:", error.message);
    res.status(500).json({ message: "Error updating paymentId" });
  }
});

export default router;
