import express from "express";
import Booking from "../models/Booking.js"; // Import the Booking model
import { authenticateToken } from "../middleware/index.js";
import Driver from "../models/Driver.js";
import getRedisClient from "../redisClient.js";
import { cacheActiveTrip, clearActiveTrip } from "../services/voice/arrivalDetector.js";
import { pickupLatLng } from "../services/voice/geo.js";

const router = express.Router();

/** Pending trip offers for online drivers (polling fallback). */
router.get("/booking/pending", async (req, res) => {
  try {
    const bookings = await Booking.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    res.status(200).json({ bookings });
  } catch (error) {
    res.status(500).json({ message: "Error fetching pending bookings.", error });
  }
});

/** Mark driver available again (demo / after trip). */
router.post("/booking/free-driver", async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) {
      return res.status(400).json({ message: "driverId required" });
    }
    await Driver.findByIdAndUpdate(driverId, { isAvailable: true });
    res.status(200).json({ message: "Driver is available." });
  } catch (error) {
    res.status(500).json({ message: "Error freeing driver.", error });
  }
});

router.post("/booking/create", authenticateToken, async (req, res) => {
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

  try {
    const newBooking = new Booking({
      distance,
      duration,
      src: {
        type: "Point",
        coordinates: src.coordinates,
      },
      destn: {
        type: "Point",
        coordinates: destn.coordinates,
      },
      userId: req.user.id,
      price,
      srcText,
      destnText,
      status: "pending",
      isScheduled,
      scheduledTime,
    });

    const savedBooking = await newBooking.save();

    res.status(201).json({
      message: "Booking added successfully.",
      booking: savedBooking,
    });
  } catch (error) {
    res.status(500).json({ message: "Error adding booking.", error });
  }
});

router.get("/booking/scheduled/:driverId", async (req, res) => {
  try {
    const bookings = await Booking.find({
      driverId: req.params.driverId,
      isScheduled: true,
      status: "accepted",
    });

    res.status(200).json({
      message: "Scheduled bookings fetched successfully.",
      bookings,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching bookings.", error });
  }
});

router.post("/booking/accept", async (req, res) => {
  const { bookingId, driverId } = req.body;

  try {
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }

    // Atomic claim: only one concurrent request can match status:"pending"
    // and flip it to "accepted" for a given booking. A plain
    // findById -> check -> save lets two near-simultaneous requests both
    // read "pending" before either writes, so both pass the check — this
    // is what let two accept calls both succeed for the same booking.
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

    const pickup = pickupLatLng(updatedBooking.src);
    if (pickup) {
      await cacheActiveTrip(getRedisClient(), {
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
    res.status(500).json({ message: "Error accepting booking.", error });
  }
});

router.get("/bookings", authenticateToken, async (req, res) => {
  try {
    const bookings = await Booking.find({ userId: req.user.id })
      .populate("userId")
      .sort({ createdAt: -1 });

    res.status(200).json(bookings);
  } catch (error) {
    res.status(500).json({ message: "Error fetching booking.", error });
  }
});

router.get("/booking/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const booking = await Booking.findById(id).populate("driverId");

    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    res.status(200).json({ booking });
  } catch (error) {
    res.status(500).json({ message: "Error fetching booking.", error });
  }
});

router.put("/booking/update-status/:bookingId", async (req, res) => {
  const { bookingId } = req.params;
  const { status } = req.body;

  const validStatuses = [
    "pending",
    "accepted",
    "arrived",
    "collected",
    "completed",
    "cancelled",
  ];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid status provided." });
  }

  try {
    const updateFields = { status };

    if (status === "arrived") {
      updateFields.arrivedTime = new Date();
    } else if (status === "collected") {
      updateFields.collectedTime = new Date();
    } else if (status === "completed") {
      updateFields.completedTime = new Date();
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingId,
      updateFields,
      { new: true }
    );

    if (!updatedBooking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    if (status === "completed" || status === "cancelled") {
      const driver = await Driver.findById(updatedBooking.driverId);
      if (driver) {
        driver.isAvailable = true;
        await driver.save();
      }
      await clearActiveTrip(getRedisClient(), updatedBooking.driverId);
    }

    res.status(200).json({
      message: "Booking status updated successfully.",
      booking: updatedBooking,
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error while updating booking status.",
      error,
    });
  }
});

router.put("/booking/:bookingId/rate", async (req, res) => {
  const { bookingId } = req.params;
  const { rating } = req.body;

  try {
    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingId,
      { rating },
      { new: true }
    );

    if (!updatedBooking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.status(200).json({ message: "Rating updated successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update rating" });
  }
});

router.put("/booking/:bookingId/payment", async (req, res) => {
  const { bookingId } = req.params;
  const { paymentId } = req.body;

  try {
    const result = await Booking.findByIdAndUpdate(
      bookingId,
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
    res.status(500).json({
      message: "Error updating paymentId",
      error: error.message,
    });
  }
});

export default router;
