import express from "express";
import mongoose from "mongoose";
import Stripe from "stripe";
import Booking from "../models/Booking.js";
import { authenticateToken } from "../middleware/index.js";

const router = express.Router();

// Created on first use: env is loaded by then, and a missing key fails the
// request rather than the whole server at import time.
let stripe;
const getStripe = () => (stripe ||= new Stripe(process.env.STRIPE_SECRET_KEY));

router.post("/create-payment-intent", authenticateToken, async (req, res) => {
  const { bookingId } = req.body;
  if (!mongoose.isValidObjectId(bookingId)) {
    return res.status(400).json({ error: "bookingId is required" });
  }

  try {
    // The amount comes from the stored booking, never from the client.
    const booking = await Booking.findOne({ _id: bookingId, userId: req.user.id })
      .select("price")
      .lean();
    if (!booking || !(booking.price > 0)) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const paymentIntent = await getStripe().paymentIntents.create({
      amount: Math.round(booking.price * 100), // paise
      currency: "inr",
      metadata: { bookingId: String(bookingId) },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error("Error creating payment intent:", error.message);
    res.status(500).json({
      error: "Payment failed",
    });
  }
});

export default router;
