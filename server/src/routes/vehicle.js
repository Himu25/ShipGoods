import express from "express";
import { body, validationResult } from "express-validator";
import Vehicle from "../models/Vehicle.js";

const router = express.Router();

router.post(
  "/vehicles",
  [
    body("type")
      .isString()
      .withMessage("Vehicle type must be a string.")
      .isIn(["car", "truck", "bus", "motorcycle"])
      .withMessage(
        "Vehicle type must be one of car, truck, bus, or motorcycle."
      ),
    body("numberPlate")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Number plate is required.")
      .custom(async (value) => {
        const existingVehicle = await Vehicle.findOne({ numberPlate: value });
        if (existingVehicle) {
          throw new Error("Number plate must be unique.");
        }
        return true;
      }),
    body("model")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Model is required."),
    body("currentLocation.coordinates")
      .isArray({ min: 2, max: 2 })
      .withMessage(
        "Coordinates must be an array of two numbers [longitude, latitude]."
      )
      .custom((value) => {
        const [longitude, latitude] = value;
        if (
          longitude < -180 ||
          longitude > 180 ||
          latitude < -90 ||
          latitude > 90
        ) {
          throw new Error("Coordinates are out of range.");
        }
        return true;
      }),
    body("driverId")
      .optional()
      .isMongoId()
      .withMessage("Driver ID must be a valid MongoDB ObjectID."),
    body("imageUrl").optional().isURL().withMessage("Image URL must be valid."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const firstError = errors.array()[0];
      return res.status(400).json({ message: firstError.msg });
    }

    const { type, numberPlate, model, currentLocation, driverId, imageUrl } =
      req.body;

    try {
      const newVehicle = new Vehicle({
        type,
        numberPlate,
        model,
        currentLocation: {
          type: "Point",
          coordinates: currentLocation.coordinates,
        },
        driverId,
        imageUrl,
      });

      await newVehicle.save();
      return res.status(201).json(newVehicle);
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json({ message: "An error occurred while creating the vehicle." });
    }
  }
);

router.get(
  "/nearby-vehicles",
  [
    body("startLocation.latitude")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Start location latitude must be between -90 and 90."),
    body("startLocation.longitude")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Start location longitude must be between -180 and 180."),
    body("endLocation.latitude")
      .isFloat({ min: -90, max: 90 })
      .withMessage("End location latitude must be between -90 and 90."),
    body("endLocation.longitude")
      .isFloat({ min: -180, max: 180 })
      .withMessage("End location longitude must be between -180 and 180."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const firstError = errors.array()[0];
      return res.status(400).json({ message: firstError.msg });
    }

    const { startLocation, endLocation } = req.body;

    try {
      const vehicles = await Vehicle.aggregate([
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [startLocation.longitude, startLocation.latitude],
            },
            distanceField: "dist.calculated",
            maxDistance: 5000,
            spherical: true,
            query: {
              $or: [
                {
                  currentLocation: {
                    $geoWithin: {
                      $centerSphere: [
                        [startLocation.longitude, startLocation.latitude],
                        5 / 6378.1,
                      ],
                    },
                  },
                },
                {
                  currentLocation: {
                    $geoWithin: {
                      $centerSphere: [
                        [endLocation.longitude, endLocation.latitude],
                        5 / 6378.1,
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      ]);
      return res.json(vehicles);
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json({ message: "An error occurred while fetching nearby vehicles." });
    }
  }
);

export default router;
