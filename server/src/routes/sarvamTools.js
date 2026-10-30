import crypto from "crypto";
import express from "express";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import VoiceCall from "../models/VoiceCall.js";
import getRedisClient from "../redisClient.js";
import { getIO } from "../services/socketService.js";
import { handleSarvamCallEnded } from "../services/voice/arrivalDetector.js";
import {
  getDestinationETA,
  getDriverDetails,
  getVehicleDetails,
} from "../services/voiceAgent/tripService.js";
import { answerPickupPolicy } from "../services/sarvam/pickupPolicy.js";
import { placeTestPickupCall, testCallBlocker } from "../services/voice/testPickupCall.js";

const router = express.Router();

const DRIVER_MESSAGES = {
  coming_down: "Customer is coming down with the goods.",
  need_five_minutes: "Customer needs about 5 more minutes.",
  need_help: "Customer needs help finding you at pickup.",
};

function secretMatches(provided) {
  const expected = process.env.SARVAM_TOOL_SECRET || "";
  const given = String(provided || "");
  if (!expected || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Every tool request from the Sarvam agent carries this header. */
function requireToolSecret(req, res, next) {
  if (!secretMatches(req.get("X-ShipGoods-Tool-Secret"))) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

/**
 * Resolves the request's callId to a live Sarvam call and its booking.
 * Anything else (unknown id, finished call, in-app call, cancelled
 * booking) is rejected, so a leaked secret alone can't read trip data.
 */
async function loadActiveCall(req, res, next) {
  const callId = req.body?.callId ?? req.query?.callId;
  if (!mongoose.isValidObjectId(callId)) {
    return res.status(400).json({ error: "invalid_call_id" });
  }

  const call = await VoiceCall.findOne({
    _id: callId,
    channel: "sarvam",
    status: { $in: ["ringing", "active"] },
  });
  if (!call) return res.status(404).json({ error: "call_not_active" });

  const booking = await Booking.findById(call.bookingId)
    .populate("driverId")
    .populate("vehicleId")
    .lean();
  if (!booking || !["accepted", "arrived"].includes(booking.status)) {
    return res.status(409).json({ error: "booking_not_active" });
  }

  // The first tool call is our only signal that the customer picked up.
  if (call.status === "ringing") {
    await VoiceCall.updateOne(
      { _id: call._id, status: "ringing" },
      { $set: { status: "active", answeredAt: new Date() } }
    );
  }

  req.voiceCall = call;
  req.booking = booking;
  next();
}

function recordToolCall(call, name, args, result, ok = true) {
  VoiceCall.updateOne(
    { _id: call._id },
    { $push: { toolCalls: { name, args, result, ok } } }
  ).catch((err) => console.error("VoiceCall tool log failed:", err.message));
}

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.use("/voice/tools", express.json(), requireToolSecret, wrap(loadActiveCall));

router.post(
  "/voice/tools/trip-info",
  wrap(async (req, res) => {
    const { booking, voiceCall } = req;
    const eta = await getDestinationETA(booking, getRedisClient());
    const driver = getDriverDetails(booking);
    const vehicle = getVehicleDetails(booking);

    // Never includes the customer's phone or anything beyond this booking.
    const result = {
      status: booking.status,
      etaMinutes: eta.available ? eta.etaMinutes : null,
      distanceMeters: eta.available ? eta.remainingMeters : null,
      traffic: eta.available ? eta.trafficCondition : "unknown",
      driverFirstName: driver.available ? driver.driverFirstName : null,
      vehicleNumber: vehicle.available ? vehicle.numberPlate : null,
      vehicleType: vehicle.available ? vehicle.model || vehicle.vehicleType : null,
    };
    recordToolCall(voiceCall, "trip-info", {}, result);
    res.json(result);
  })
);

router.post(
  "/voice/tools/notify-driver",
  wrap(async (req, res) => {
    const { booking, voiceCall } = req;
    const messageKey = req.body?.message;
    const text = DRIVER_MESSAGES[messageKey];
    if (!text) {
      recordToolCall(voiceCall, "notify-driver", { message: messageKey }, { error: "invalid_message" }, false);
      return res.status(400).json({
        ok: false,
        error: "invalid_message",
        allowed: Object.keys(DRIVER_MESSAGES),
      });
    }

    const io = getIO();
    if (io && booking.driverId) {
      // DriverMap.js shows any userPickupUpdate as a toast.
      io.to(`driver:${booking.driverId._id}`).emit("userPickupUpdate", {
        bookingId: String(booking._id),
        messageKey,
        text,
      });
    }
    if (messageKey === "coming_down") {
      await VoiceCall.updateOne({ _id: voiceCall._id }, { $set: { acknowledged: true } });
    }
    recordToolCall(voiceCall, "notify-driver", { message: messageKey }, { ok: true });
    res.json({ ok: true });
  })
);

router.post(
  "/voice/tools/pickup-policy",
  wrap(async (req, res) => {
    const question = String(req.body?.question || "").slice(0, 500);
    const answer = answerPickupPolicy(question);
    recordToolCall(req.voiceCall, "pickup-policy", { question }, { answer });
    res.json({ answer });
  })
);

const TEST_CALL_COOLDOWN_MS = 60000;
let lastTestCallAt = 0;

/**
 * Test pickup call with live tools, placed by the deployed server so the
 * booking and VoiceCall live in the same database the tools read. Only
 * ever rings VOICE_TEST_NUMBER; guarded by the tool secret and a 1/min limit.
 */
router.post(
  "/voice/test-call",
  express.json(),
  requireToolSecret,
  wrap(async (req, res) => {
    const blocker = testCallBlocker();
    if (blocker) return res.status(503).json({ error: "not_configured", detail: blocker });

    const waitMs = lastTestCallAt + TEST_CALL_COOLDOWN_MS - Date.now();
    if (waitMs > 0) {
      return res.status(429).json({ error: "too_soon", retryAfterSeconds: Math.ceil(waitMs / 1000) });
    }
    lastTestCallAt = Date.now();

    const { booking, call } = await placeTestPickupCall({ io: getIO(), redis: getRedisClient() });
    const placed = call?.channel === "sarvam" && !!call.sarvamAttemptId;
    res.status(placed ? 200 : 502).json({
      placed,
      bookingId: String(booking._id),
      callId: String(call?._id),
      channel: call?.channel,
      attemptId: call?.sarvamAttemptId || null,
      ...(placed ? {} : { detail: "Sarvam rejected the call; see the server log." }),
    });
  })
);

/**
 * Sarvam end-of-call webhook. Authenticated by the secret we put in the
 * call's webhook metadata (Sarvam echoes it back) plus a matching
 * attempt_id. Always 200 once authenticated, so a parsing problem on our
 * side never makes Sarvam redeliver.
 */
router.post("/voice/sarvam-webhook", express.json({ limit: "1mb" }), async (req, res) => {
  if (!secretMatches(req.body?.webhook_config?.metadata?.secret)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const call = await handleSarvamCallEnded({
      io: getIO(),
      redis: getRedisClient(),
      payload: req.body,
    });
    if (!call) {
      console.warn(
        `Sarvam webhook ignored: attempt=${req.body?.attempt_id} status=${req.body?.status} (no matching active call)`
      );
    }
  } catch (err) {
    console.error("Sarvam webhook error:", err.message);
  }
  res.status(200).json({ received: true });
});

router.use("/voice", (err, req, res, next) => {
  console.error("Voice tool error:", err.message);
  res.status(500).json({ error: "internal_error" });
});

export default router;
