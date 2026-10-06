/**
 * Connects as a single seeded driver and accepts the next pickup request
 * it receives, then exits. Run: node scripts/acceptOneBooking.js <driverId>
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Driver from "../src/models/Driver.js";
import User from "../src/models/User.js";

dotenv.config();

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { io } = require(join(
  __dirname,
  "../../client/node_modules/socket.io-client/build/cjs/index.js"
));

const API = process.env.API_BASE || "http://localhost:3000";
const SOCKET_URL = process.env.SOCKET_URL || "http://localhost:3000";
const DRIVER_ID = process.argv[2];

if (!DRIVER_ID) {
  console.error("Usage: node scripts/acceptOneBooking.js <driverId>");
  process.exit(1);
}

async function acceptBooking(booking, driverId) {
  const bookingId = booking._id || booking.id;
  const userId = booking.userId?._id || booking.userId;

  const res = await fetch(`${API}/api/booking/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, driverId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log("❌ Accept API failed:", data.message || res.status);
    return null;
  }

  console.log("✅ Booking accepted:", data.message);
  return { bookingId, userId, driverId };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const driver = await Driver.findById(DRIVER_ID);
  if (!driver) {
    console.error("Driver not found:", DRIVER_ID);
    process.exit(1);
  }
  console.log(`Loaded driver: ${driver.name} (${DRIVER_ID})`);

  // Sockets now require a real JWT (server verifies it with an io.use
  // middleware and derives the driverId itself) — log in as this driver's
  // User account the same way the real driver app would.
  const user = await User.findOne({ driverId: DRIVER_ID });
  if (!user) {
    console.error("No User account found for driver:", DRIVER_ID);
    process.exit(1);
  }
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      password: process.env.defaultPass || "123456789",
    }),
  });
  const loginData = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginData.token) {
    console.error("Login failed:", loginData.message || loginRes.status);
    process.exit(1);
  }
  const token = loginData.token;

  const socket = io(SOCKET_URL, {
    transports: ["websocket"],
    reconnection: true,
    auth: { token },
  });

  socket.on("connect", () => {
    socket.emit("driverConnected", DRIVER_ID);
    console.log(`🟢 ${driver.name} online, waiting for a pickup request...`);
  });

  socket.on("connect_error", (err) => {
    console.error("🔴 Socket auth/connect failed:", err.message);
  });

  socket.on("pickupRequested", async (bookingData) => {
    const bookingId = (bookingData?._id || "").toString();
    if (!bookingId) return;

    console.log(`\n📩 Pickup requested: ${bookingData?.srcText} → ${bookingData?.destnText}`);

    const result = await acceptBooking(bookingData, DRIVER_ID);
    if (!result) {
      process.exit(1);
    }

    socket.emit("acceptBooking", {
      driverId: result.driverId,
      bookingId: result.bookingId,
      userId: result.userId?.toString?.() || result.userId,
    });
    console.log(`📡 ${driver.name} accepted booking ${result.bookingId} — notified user.`);

    setTimeout(async () => {
      socket.close();
      await mongoose.disconnect();
      process.exit(0);
    }, 1500);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
