import { Server as SocketServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import Driver from "../models/Driver.js";
import Booking from "../models/Booking.js";
import User from "../models/User.js";
import { sendDriverLocationToKafka } from "../kafka/producer.js";
import {
  cacheActiveTrip,
  maybeTriggerArrivalCall,
  markCallDeclined,
  markCallMissed,
} from "./voice/arrivalDetector.js";
import { pickupLatLng } from "./voice/geo.js";

let io;

export const getIO = () => io;

const LOCATION_TTL_SEC = 120; // no push in 2 min -> treat the driver as gone dark
const MAX_JUMP_METERS = 5000; // implausible for one tick
const RECENT_WINDOW_MS = 10000; // only enforce the jump check vs a recent point

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

const initializeSocket = (server, redisClient) => {
  io = new SocketServer(server, {
    cors: {
      origin: "*",
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

    socket.on("requestPickup", async ({ driverIds, bookingData }) => {
      const ids = (driverIds || []).map((id) => id?.toString?.() || id);
      for (const driverId of ids) {
        // Room-based delivery via the adapter reaches the driver's socket
        // on whichever server instance it's connected to.
        io.to(`driver:${driverId}`).emit("pickupRequested", bookingData);
      }
    });

    socket.on("acceptBooking", async (bookingDetails) => {
      const { userId, bookingId } = bookingDetails;

      // A driver socket can only announce ITS OWN acceptance — stops a
      // spoofed client from notifying a rider on a different driver's
      // behalf.
      if (
        socket.data.role === "driver" &&
        bookingDetails.driverId !== socket.data.driverId
      ) {
        return;
      }
      const driverId =
        socket.data.role === "driver"
          ? socket.data.driverId
          : bookingDetails.driverId;

      redisClient.set(`driverAssignedToUser:${driverId}`, userId);
      try {
        const booking = await Booking.findById(bookingId);
        const pickup = pickupLatLng(booking?.src);
        if (pickup && userId && driverId && bookingId) {
          await cacheActiveTrip(redisClient, {
            driverId,
            userId,
            bookingId,
            pickupLat: pickup.lat,
            pickupLng: pickup.lng,
          });
        }
      } catch (error) {
        console.error("Error caching active trip:", error.message);
      }

      io.to(`user:${userId}`).emit("bookingAccepted", { bookingId, driverId });
      console.log(
        `Booking accepted by driver ${driverId}, notified user ${userId}`
      );
    });

    socket.on("voiceCallDeclined", async ({ callId }) => {
      try {
        await markCallDeclined(callId);
      } catch (error) {
        console.error("voiceCallDeclined:", error.message);
      }
    });

    socket.on("voiceCallMissed", async ({ callId }) => {
      try {
        await markCallMissed(callId);
      } catch (error) {
        console.error("voiceCallMissed:", error.message);
      }
    });

    socket.on(
      "updateBookingStatus",
      async ({ bookingId, newStatus, userId }) => {
        io.to(`user:${userId}`).emit("statusUpdated", { bookingId, newStatus });
      }
    );

    socket.on("rejectBooking", (bookingDetails) => {
      io.to(`user:${bookingDetails.userId}`).emit(
        "bookingRejected",
        bookingDetails
      );
    });

    socket.on("driverLocationUpdate", async ({ latitude, longitude, heading }) => {
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

      sendDriverLocationToKafka(driverId, latitude, longitude);

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
          console.error(`Driver with ID ${driverId} not found.`);
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
