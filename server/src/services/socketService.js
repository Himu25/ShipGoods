import { Server as SocketServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Driver from "../models/Driver.js";
import Booking from "../models/Booking.js";
import User from "../models/User.js";
import {
  checkPickupCallOnAccept,
  maybeTriggerArrivalCall,
  markCallDeclined,
  markCallMissed,
} from "./voice/arrivalDetector.js";

let io;

export const getIO = () => io;

const LOCATION_TTL_SEC = 120; // no push in 2 min -> treat the driver as gone dark
const MAX_JUMP_METERS = 5000; // implausible for one tick
const RECENT_WINDOW_MS = 10000; // only enforce the jump check vs a recent point
const MONGO_PERSIST_INTERVAL_SEC = 10; // live position lives in Redis; Mongo only needs it for $geoNear

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isValidCoordinate(latitude, longitude) {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/**
 * Writes the driver's position to Mongo at most once per
 * MONGO_PERSIST_INTERVAL_SEC. Mongo backs the nearby-driver $geoNear query
 * and the stale fallback; live tracking reads the Redis cache instead. The
 * throttle key is in Redis so it holds across instances.
 */
async function persistDriverLocation(redisClient, driverId, latitude, longitude) {
  const acquired = await redisClient.set(
    `driver:${driverId}:persistedAt`,
    Date.now(),
    "EX",
    MONGO_PERSIST_INTERVAL_SEC,
    "NX"
  );
  if (!acquired) return;
  await Driver.findByIdAndUpdate(driverId, {
    currentLocation: { type: "Point", coordinates: [longitude, latitude] },
  });
}

/** Rooms only the server joins sockets to; a client can't name them. */
async function canTrackDriver(socket, redisClient, driverId) {
  if (!driverId) return false;
  if (socket.data.role === "admin") return true;
  if (socket.data.role === "driver") return socket.data.driverId === String(driverId);
  const riderId = await redisClient.get(`driverAssignedToUser:${driverId}`);
  return riderId === socket.data.userId;
}

/** The booking, if it is assigned to this driver socket. */
async function loadDriverBooking(socket, bookingId) {
  if (socket.data.role !== "driver" || !mongoose.isValidObjectId(bookingId)) return null;
  return Booking.findOne({ _id: bookingId, driverId: socket.data.driverId })
    .select("userId status src")
    .lean();
}

const initializeSocket = (server, redisClient, corsOrigin = "*") => {
  io = new SocketServer(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
    },
    destroyUpgrade: false,
  });

  // Reuse the single ioredis connection for the adapter instead of pulling
  // in the separate `redis` package — one Redis client library, not two.
  // Pub/sub clients must be dedicated connections (SUBSCRIBE blocks the
  // connection from running other commands), so we duplicate it twice.
  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();

  io.adapter(createAdapter(pubClient, subClient));

  // Every socket must prove who it is with the same JWT issued at login.
  // Without this, anyone who knew (or guessed) a driverId could emit
  // driverLocationUpdate for that driver and spoof their position to real
  // riders — previously the client-supplied id was trusted as-is.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Unauthorized: missing token"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("role driverId");
      if (!user) return next(new Error("Unauthorized: user not found"));

      // JWT's `id` is always the User _id. For a driver account the
      // Driver _id (what rooms/Redis keys are keyed on) is a *different*
      // document, so it has to be resolved here, once, at connect time.
      socket.data.userId = user._id.toString();
      socket.data.role = user.role;
      socket.data.driverId = user.driverId ? user.driverId.toString() : null;
      next();
    } catch (err) {
      next(new Error("Unauthorized: " + err.message));
    }
  });

  io.on("connection", (socket) => {
    console.log(
      `New client connected: ${socket.id} (role=${socket.data.role} id=${
        socket.data.driverId || socket.data.userId
      })`
    );

    socket.on("registerUser", () => {
      // A room, not a single Redis key — every open tab/device for this
      // rider gets pushed updates, and Socket.IO drops the membership
      // automatically on disconnect, so there's no manual cleanup and no
      // stale socket id left behind after a server restart.
      socket.join(`user:${socket.data.userId}`);
      console.log("User registered:", socket.data.userId, socket.id);
    });

    socket.on("driverConnected", () => {
      if (socket.data.role !== "driver" || !socket.data.driverId) return;
      socket.join(`driver:${socket.data.driverId}`);
      console.log(
        `Driver ${socket.data.driverId} connected with socket ${socket.id}`
      );
    });

    socket.on("requestPickup", async ({ driverIds, bookingData } = {}) => {
      if (socket.data.role !== "user") return;
      const ids = (driverIds || []).map((id) => id?.toString?.() || id);
      for (const driverId of ids) {
        // Room-based delivery via the adapter reaches the driver's socket
        // on whichever server instance it's connected to.
        io.to(`driver:${driverId}`).emit("pickupRequested", bookingData);
      }
    });

    // The REST accept (/booking/accept) is the source of truth and already
    // set up the Redis trip state; this event only tells the rider.
    socket.on("acceptBooking", async ({ bookingId } = {}) => {
      try {
        const booking = await loadDriverBooking(socket, bookingId);
        if (!booking || booking.status !== "accepted") return;
        const userId = String(booking.userId);
        const driverId = socket.data.driverId;

        // Already within the call window at accept time -> call now.
        checkPickupCallOnAccept({ io, redis: redisClient, driverId }).catch((error) => {
          console.error("Pickup call check on accept failed:", error.message);
        });

        const driver = await Driver.findById(driverId).select("name demo").lean();
        io.to(`user:${userId}`).emit("bookingAccepted", {
          bookingId,
          driverId,
          driverName: driver?.name,
          isDemoBot: driver?.demo === "bot",
        });
        console.log(`Booking accepted by driver ${driverId}, notified user ${userId}`);
      } catch (error) {
        console.error("acceptBooking:", error.message);
      }
    });

    socket.on("voiceCallDeclined", async ({ callId } = {}) => {
      try {
        await markCallDeclined(callId, socket.data.userId);
      } catch (error) {
        console.error("voiceCallDeclined:", error.message);
      }
    });

    socket.on("voiceCallMissed", async ({ callId } = {}) => {
      try {
        await markCallMissed(callId, { io, redis: redisClient, userId: socket.data.userId });
      } catch (error) {
        console.error("voiceCallMissed:", error.message);
      }
    });

    // Relays a status the driver already saved via REST; the rider is
    // taken from the booking, not from the payload.
    socket.on("updateBookingStatus", async ({ bookingId, newStatus } = {}) => {
      try {
        const booking = await loadDriverBooking(socket, bookingId);
        if (!booking) return;
        io.to(`user:${booking.userId}`).emit("statusUpdated", { bookingId, newStatus });
      } catch (error) {
        console.error("updateBookingStatus:", error.message);
      }
    });

    socket.on("rejectBooking", (bookingDetails = {}) => {
      if (socket.data.role !== "driver" || !bookingDetails.userId) return;
      io.to(`user:${bookingDetails.userId}`).emit("bookingRejected", {
        bookingId: bookingDetails.bookingId || bookingDetails._id,
        driverId: socket.data.driverId,
      });
    });

    socket.on("driverLocationUpdate", async ({ latitude, longitude, heading } = {}) => {
      if (socket.data.role !== "driver" || !socket.data.driverId) return;
      const driverId = socket.data.driverId;

      if (!isValidCoordinate(latitude, longitude)) {
        console.warn(
          `Rejected location for driver ${driverId}: out of range (${latitude}, ${longitude})`
        );
        return;
      }

      try {
        const previousRaw = await redisClient.get(`driver:${driverId}:location`);
        if (previousRaw) {
          const previous = JSON.parse(previousRaw);
          const age = Date.now() - (previous.updatedAt || 0);
          if (age < RECENT_WINDOW_MS) {
            const jump = haversineMeters(
              previous.latitude,
              previous.longitude,
              latitude,
              longitude
            );
            if (jump > MAX_JUMP_METERS) {
              console.warn(
                `Rejected location for driver ${driverId}: implausible ${Math.round(
                  jump
                )}m jump in ${age}ms`
              );
              return;
            }
          }
        }
      } catch (error) {
        console.error("Jump-check failed, allowing update:", error.message);
      }

      persistDriverLocation(redisClient, driverId, latitude, longitude).catch((error) => {
        console.error(`Error updating MongoDB for driver ${driverId}:`, error.message);
      });

      try {
        const locationPayload = {
          latitude,
          longitude,
          heading: typeof heading === "number" ? heading : 0,
          updatedAt: Date.now(),
        };
        await redisClient.set(
          `driver:${driverId}:location`,
          JSON.stringify(locationPayload),
          "EX",
          LOCATION_TTL_SEC
        );

        const userId = await redisClient.get(`driverAssignedToUser:${driverId}`);
        if (userId) {
          io.to(`user:${userId}`).emit("locationUpdate", locationPayload);
        }

        maybeTriggerArrivalCall({
          io,
          redis: redisClient,
          driverId,
          latitude,
          longitude,
        }).catch((error) => {
          console.error("Arrival detector error:", error.message);
        });
      } catch (error) {
        console.error("Error pushing live location:", error.message);
      }
    });

    socket.on("requestDriverLocation", async (driverId) => {
      try {
        if (!(await canTrackDriver(socket, redisClient, driverId))) return;
        const cached = await redisClient.get(`driver:${driverId}:location`);
        if (cached) {
          socket.emit("locationUpdate", JSON.parse(cached));
          return;
        }
        // Cache miss means no push in the last LOCATION_TTL_SEC — fall
        // back to the last known Mongo position, but mark it stale so the
        // rider sees "lost contact" instead of a falsely-live marker.
        const driver = await Driver.findById(driverId);
        if (driver?.currentLocation?.coordinates) {
          const [longitude, latitude] = driver.currentLocation.coordinates;
          socket.emit("locationUpdate", {
            latitude,
            longitude,
            stale: true,
            updatedAt: null,
          });
        } else {
          console.warn(`No known location for driver ${driverId}.`);
        }
      } catch (error) {
        console.error(
          `Error fetching location from MongoDB: ${error.message}`
        );
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      // Nothing to clean up manually — "user:<id>" and "driver:<id>" are
      // Socket.IO rooms, and Socket.IO drops a socket from all its rooms
      // automatically on disconnect.
    });
  });
};

export { initializeSocket };
