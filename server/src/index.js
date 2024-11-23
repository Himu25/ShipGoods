import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import authRoutes from "./routes/auth.js";
import vehicleRoutes from "./routes/vehicle.js";
import bookingRoutes from "./routes/booking.js";
import driverRoutes from "./routes/driver.js";
import adminRoutes from "./routes/admin.js";
import priceRoutes from "./routes/price.js";
import paymentRoute from "./routes/payment.js";
import { initializeSocket } from "./services/socketService.js"; // Socket logic in a separate module
import getRedisClient from "./redisClient.js"; // Singleton Redis client
import "./kafka/consumer.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const redisClient = getRedisClient();

initializeSocket(server, redisClient);

app.use("/api", authRoutes);
app.use("/api", vehicleRoutes);
app.use("/api", driverRoutes);
app.use("/api", adminRoutes);
app.use("/api", priceRoutes);
app.use("/api", bookingRoutes);
app.use("/api", paymentRoute);

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  }
};

const startServer = async () => {
  await connectDB();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
