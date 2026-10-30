// Must be the first import: ES modules evaluate imports before this
// file's body, so a dotenv.config() call here would run too late for any
// module that reads process.env at import time.
import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import authRoutes from "./routes/auth.js";
import bookingRoutes from "./routes/booking.js";
import driverRoutes from "./routes/driver.js";
import adminRoutes from "./routes/admin.js";
import priceRoutes from "./routes/price.js";
import paymentRoute from "./routes/payment.js";
import sarvamToolRoutes from "./routes/sarvamTools.js";
import voiceAgentRoutes from "./routes/voiceAgent.js";
import { getIO, initializeSocket } from "./services/socketService.js";
import getRedisClient from "./redisClient.js";

const REQUIRED_ENV = ["MONGO_URI", "REDIS_URL", "JWT_SECRET"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

// CORS_ORIGIN is a comma-separated allow-list (e.g. the deployed
// frontend URL); unset means any origin, which is only fine for local dev.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : "*";

const app = express();
const server = http.createServer(app);

// Behind Render/Koyeb/a k8s ingress, so req.ip and req.protocol are real.
app.set("trust proxy", 1);
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const redisClient = getRedisClient();

initializeSocket(server, redisClient, corsOrigin);

/** Liveness + dependency check for the platform's health probe. */
app.get("/health", async (req, res) => {
  const mongo = mongoose.connection.readyState === 1;
  let redis = false;
  try {
    redis = (await redisClient.ping()) === "PONG";
  } catch {
    /* reported below */
  }
  res.status(mongo && redis ? 200 : 503).json({ ok: mongo && redis, mongo, redis });
});

app.use("/api", authRoutes);
app.use("/api", driverRoutes);
app.use("/api", adminRoutes);
app.use("/api", priceRoutes);
app.use("/api", bookingRoutes);
app.use("/api", paymentRoute);
app.use("/api", sarvamToolRoutes);
app.use("/api", voiceAgentRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Not found" });
});

// Anything a route passes to next(err) or a malformed JSON body.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body" });
  }
  console.error("Unhandled error:", err.message);
  res.status(500).json({ message: "Server error" });
});

const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

// Platforms send SIGTERM on every deploy/scale-down: stop taking new
// connections, let in-flight requests finish, then close Mongo and Redis.
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 10000).unref();
  getIO()?.close();
  server.close(async () => {
    await mongoose.disconnect().catch(() => {});
    await redisClient.quit().catch(() => {});
    process.exit(0);
  });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer();
