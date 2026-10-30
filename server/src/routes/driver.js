import express from "express";
import mongoose from "mongoose";
import { body, validationResult } from "express-validator";
import Driver from "../models/Driver.js";
import { authenticateToken } from "../middleware/index.js";
import getRedisClient from "../redisClient.js";
import { ensureDemoFleet } from "../services/demo/demoFleet.js";

const router = express.Router();

// Driver positions here come from the throttled Mongo write in
// socketService.js, so they can lag the live Redis position by ~10 s.
router.post(
  "/nearby-drivers",
  authenticateToken,
  [
    body("startLocation.latitude")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Start location latitude must be between -90 and 90."),
    body("startLocation.longitude")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Start location longitude must be between -180 and 180."),
    body("vehicleType").isString().withMessage("Vehicle type is required."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const firstError = errors.array()[0];
      return res.status(400).json({ message: firstError.msg });
    }

    const { startLocation, vehicleType } = req.body;

    try {
      if (req.user.role === "user") {
        // Showcase mode only: top the area up to 5 drivers + this user's bot.
        await ensureDemoFleet({
          redis: getRedisClient(),
          userId: req.user.id,
          latitude: Number(startLocation.latitude),
          longitude: Number(startLocation.longitude),
          vehicleType,
        }).catch((err) => console.error("Demo fleet error:", err.message));
      }

      const drivers = await Driver.aggregate([
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [startLocation.longitude, startLocation.latitude],
            },
            distanceField: "dist.calculated",
            maxDistance: 100000, // Set maximum distance to 100 km (100,000 meters)
            spherical: true,
            // A customer's demo bot is only ever offered to that customer.
            query: {
              $or: [
                { demo: { $ne: "bot" } },
                { demoOwnerId: new mongoose.Types.ObjectId(String(req.user.id)) },
              ],
            },
          },
        },
        {
          $lookup: {
            from: "vehicles",
            localField: "vehicleId",
            foreignField: "_id",
            as: "vehicleDetails",
          },
        },
        {
          $unwind: "$vehicleDetails", // Unwind to access vehicleDetails fields
        },
        {
          $match: {
            "vehicleDetails.type": vehicleType, // Match the vehicle type
            isAvailable: true, // Match only available drivers
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            isAvailable: 1,
            currentLocation: 1,
            vehicleDetails: 1,
            demo: 1,
            "dist.calculated": {
              $round: [{ $divide: ["$dist.calculated", 1000] }, 2], // Distance in km
            },
          },
        },
        {
          $sort: {
            "dist.calculated": 1, // Sort by distance, closest first
          },
        },
      ]);

      // Return an empty array if no drivers are found
      return res.json(drivers);
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json({ message: "An error occurred while fetching nearby drivers." });
    }
  }
);

export default router;
