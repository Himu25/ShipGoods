import { Server as SocketServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import Driver from "../models/Driver.js";
import { sendDriverLocationToKafka } from "../kafka/producer.js";

let io;

const initializeSocket = (server, redisClient) => {
  io = new SocketServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  pubClient.connect();
  subClient.connect();

  io.adapter(createAdapter(pubClient, subClient));

  subClient.subscribe("driverLocationUpdate", (message) => {
    const { driverId, latitude, longitude } = JSON.parse(message);
    console.log(driverId, latitude, longitude);
    redisClient.get(`driverAssignedToUser:${driverId}`, (err, userId) => {
      if (userId) {
        redisClient.get(`user:${userId}`, (err, userSocketId) => {
          console.log("🚀 ~ redisClient.get ~ userSocketId:", userSocketId);
          if (userSocketId) {
            io.to(userSocketId).emit("locationUpdate", {
              latitude,
              longitude,
            });
            console.log(
              `Location update sent to user ${userId} for driver ${driverId}`
            );
          }
        });
      }
    });
  });

  io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    socket.on("registerUser", (userId) => {
      redisClient.set(`user:${userId}`, socket.id);
      console.log("User registered:", userId, socket.id);
      console.log("🚀 ~ socket.on ~ socket.id:", socket.id);
    });

    socket.on("driverConnected", (driverId) => {
      redisClient.set(`driver:${driverId}`, socket.id);
      console.log(`Driver ${driverId} connected with socket ${socket.id}`);
    });

    socket.on("requestPickup", ({ driverIds, bookingData }) => {
      console.log("🚀 ~ socket.on ~ bookingData:", bookingData);

      driverIds.forEach((driverId) => {
        redisClient.get(`driver:${driverId}`, (err, driverSocketId) => {
          if (driverSocketId) {
            io.to(driverSocketId).emit("pickupRequested", bookingData);
            console.log(
              `Pickup request sent to driver ${driverId}-${driverSocketId}`
            );
          } else {
            console.log(`Driver ${driverId} is not connected.`);
          }
        });
      });
    });

    socket.on("acceptBooking", (bookingDetails) => {
      const { userId, driverId, bookingId } = bookingDetails;
      redisClient.set(`driverAssignedToUser:${driverId}`, userId);
      redisClient.get(`user:${userId}`, (err, userSocketId) => {
        if (userSocketId) {
          io.to(userSocketId).emit("bookingAccepted", {
            bookingId,
            driverId,
          });
          console.log(
            `Booking accepted by driver ${driverId}, notified user ${userId}`
          );
        }
      });
    });

    socket.on(
      "updateBookingStatus",
      async ({ bookingId, newStatus, userId }) => {
        console.log(bookingId, newStatus, userId);
        try {
          const userSocketId = await redisClient.get(`user:${userId}`);
          console.log(userId);
          console.log("🚀 ~ userSocketId:", userSocketId);
          if (userSocketId) {
            io.to(userSocketId).emit("statusUpdated", {
              bookingId,
              newStatus,
            });
          } else {
            console.error(
              `No socket ID found for user ${userId}-${userSocketId}`
            );
          }
        } catch (error) {
          console.error(`Error updating booking status: ${error.message}`);
        }
      }
    );

    socket.on("rejectBooking", (bookingDetails) => {
      redisClient.get(`user:${bookingDetails.userId}`, (err, userSocketId) => {
        if (userSocketId) {
          io.to(userSocketId).emit("bookingRejected", bookingDetails);
        }
      });
    });
    socket.on("driverLocationUpdate", ({ driverId, latitude, longitude }) => {
      console.log(
        "🚀 ~ socket.on ~ driverId, latitude, longitude:",
        driverId,
        latitude,
        longitude
      );
      sendDriverLocationToKafka(driverId, latitude, longitude);
    });
    socket.on("requestDriverLocation", async (driverId) => {
      redisClient.get(`driver:${driverId}:location`, async (err, location) => {
        if (location) {
          socket.emit("locationUpdate", JSON.parse(location));
        } else {
          try {
            const driver = await Driver.findById(driverId);
            if (driver) {
              const { coordinates } = driver.currentLocation;
              const locationData = {
                latitude: coordinates[1],
                longitude: coordinates[0],
              };
              socket.emit("locationUpdate", locationData);
            } else {
              console.error(`Driver with ID ${driverId} not found.`);
            }
          } catch (error) {
            console.error(
              `Error fetching location from MongoDB: ${error.message}`
            );
          }
        }
      });
    });

    // socket.on(
    //   "driverLocationUpdate",
    //   async ({ driverId, latitude, longitude }) => {
    //     try {
    //       await Driver.findByIdAndUpdate(driverId, {
    //         location: {
    //           type: "Point",
    //           coordinates: [longitude, latitude],
    //         },
    //       });

    //       console.log(`Location updated for driver ${driverId}`);

    //       const locationData = JSON.stringify({
    //         driverId,
    //         latitude,
    //         longitude,
    //       });
    //       pubClient.publish("driverLocationUpdate", locationData);
    //     } catch (error) {
    //       console.error("Error updating driver's location:", error);
    //     }
    //   }
    // );

    socket.on("disconnect", async () => {
      console.log("Client disconnected:", socket.id);

      const users = await redisClient.keys("user:*");
      for (const userKey of users) {
        const userSocketId = await redisClient.get(userKey);
        if (userSocketId === socket.id) {
          await redisClient.del(userKey);
          break;
        }
      }

      const drivers = await redisClient.keys("driver:*");
      for (const driverKey of drivers) {
        const driverSocketId = await redisClient.get(driverKey);
        if (driverSocketId === socket.id) {
          await redisClient.del(driverKey);
          break;
        }
      }
    });
  });
};

export { initializeSocket };
