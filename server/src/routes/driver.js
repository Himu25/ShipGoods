import express from "express";
import { body, validationResult } from "express-validator";
import Driver from "../models/Driver.js";

const router = express.Router();

router.post(
  "/nearby-drivers",
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
            licenseNumber: 1,
            name: 1,
            isAvailable: 1,
            currentLocation: 1,
            vehicleDetails: 1,
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

router.put(
  "/drivers/:id/coordinates",
  [
    body("coordinates")
      .isArray({ min: 2, max: 2 })
      .withMessage(
        "Coordinates must be an array with two elements: [longitude, latitude]."
      ),
    body("coordinates.*")
      .isFloat()
      .withMessage("Coordinates must be valid numbers."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }

    const { id } = req.params;
    const { coordinates } = req.body;

    try {
      const updatedDriver = await Driver.findByIdAndUpdate(
        id,
        {
          currentLocation: {
            type: "Point",
            coordinates: coordinates,
          },
        },
        { new: true, runValidators: true }
      );

      if (!updatedDriver) {
        return res.status(404).json({ message: "Driver not found" });
      }

      return res.status(200).json({
        message: "Driver's coordinates updated successfully",
        driver: updatedDriver,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "An error occurred while updating the driver's coordinates.",
      });
    }
  }
);

export default router;
