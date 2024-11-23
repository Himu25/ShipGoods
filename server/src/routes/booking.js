import express from "express";
import Booking from "../models/Booking.js"; // Import the Booking model
import { authenticateToken } from "../middleware/index.js";
import Driver from "../models/Driver.js";

const router = express.Router();

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
    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    if (booking.status === "accepted") {
      return res.status(400).json({
        message: "Booking has already been accepted by another driver.",
      });
    }

    if (booking.status !== "pending") {
      return res
        .status(400)
        .json({ message: "Booking is not available for acceptance." });
    }

    // Update the booking
    booking.driverId = driverId;
    booking.status = "accepted";

    // Find and update the driver to set isAvailable to false
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }
    if (!booking.isScheduled) {
      driver.isAvailable = false;
      await driver.save();
    }

    const updatedBooking = await booking.save();

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
    "collected",
    "completed",
    "cancelled",
  ];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid status provided." });
  }

  try {
    const updateFields = { status };

    if (status === "collected") {
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
