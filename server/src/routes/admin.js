import express from "express";
import { authenticateToken, authorizeRole } from "../middleware/index.js";
import Vehicle from "../models/Vehicle.js";
import { body, validationResult } from "express-validator";
import Driver from "../models/Driver.js";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
const router = express.Router();

router.post(
  "/admin/add-vehicles",
  authenticateToken,
  authorizeRole("admin"),
  [
    body("type")
      .isString()
      .withMessage("Type is required and must be a string")
      .isIn(["car", "truck", "bus", "motorcycle"])
      .withMessage(
        "Type must be one of the following: car, truck, bus, motorcycle"
      ),
    body("numberPlate")
      .isString()
      .withMessage("Number plate is required and must be a string"),
    body("model")
      .isString()
      .withMessage("Model is required and must be a string"),
    body("driverId")
      .optional()
      .isMongoId()
      .withMessage("Driver ID must be a valid ObjectId"),
    body("imageUrl")
      .optional()
      .isURL()
      .withMessage("Image URL must be a valid URL"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { type, numberPlate, model, driverId, imageUrl } = req.body;
      const adminId = req.user.id;

      const existingVehicle = await Vehicle.findOne({ numberPlate });
      if (existingVehicle) {
        return res.status(400).json({ message: "Number plate already exists" });
      }

      const vehicle = new Vehicle({
        type,
        numberPlate,
        model,
        adminId,
        driverId,
        imageUrl,
      });

      await vehicle.save();
      res.status(201).json(vehicle);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

router.post(
  "/admin/add-drivers",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res) => {
    try {
      const { name, email, licenseNumber } = req.body;
      const adminId = req.user.id;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res
          .status(400)
          .json({ message: "Driver with this email already exists" });
      }

      const driver = new Driver({
        name,
        licenseNumber,
        adminId,
      });
      await driver.save();

      const user = new User({
        name,
        email,
        licenseNumber,
        password: process.env.defaultPass,
        role: "driver",
        driverId: driver._id,
      });
      await user.save();
      res.status(201).json({
        message: "Driver added successfully",
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

router.get(
  "/admin/drivers",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res) => {
    try {
      const vehicles = await Vehicle.find({ adminId: req.user.id }).select(
        "driverId"
      );
      const assignedDriverIds = vehicles
        .map((vehicle) => vehicle.driverId)
        .filter((id) => id);

      const drivers = await Driver.find({
        adminId: req.user.id,
        isAvailable: true,
        _id: { $nin: assignedDriverIds },
      });

      res.status(200).json({ drivers });
    } catch (error) {
      console.error("Error fetching drivers:", error);
      res.status(500).json({ message: "Error fetching drivers" });
    }
  }
);

router.get(
  "/admin/vehicles",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res) => {
    try {
      const vehicles = await Vehicle.find({ adminId: req.user.id }).populate(
        "driverId"
      );
      console.log(vehicles);
      return res.status(200).json(vehicles);
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json({ message: "An error occurred while fetching vehicles." });
    }
  }
);

router.put(
  "/admin/vehicles/:id",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res) => {
    const { id } = req.params;
    const { model, type, numberPlate, driverId } = req.body;

    try {
      const vehicle = await Vehicle.findById(id);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Check if driverId is changed
      const oldDriverId = vehicle.driverId;

      vehicle.model = model;
      vehicle.type = type;
      vehicle.numberPlate = numberPlate;
      vehicle.driverId = driverId;
      await vehicle.save();

      // If driver is changed, update both old and new drivers
      if (oldDriverId !== driverId) {
        if (oldDriverId) {
          const oldDriver = await Driver.findById(oldDriverId);
          if (oldDriver) {
            oldDriver.vehicleId = null;
            await oldDriver.save();
          }
        }
        if (driverId) {
          const newDriver = await Driver.findById(driverId);
          if (newDriver) {
            newDriver.vehicleId = id;
            await newDriver.save();
          }
        }
      }

      return res.status(200).json({
        message: "Vehicle updated successfully",
        vehicle,
      });
    } catch (error) {
      console.error("Error updating vehicle:", error);
      return res
        .status(500)
        .json({ message: "An error occurred while updating the vehicle." });
    }
  }
);

router.delete(
  "/admin/vehicles/:vehicleId/remove-driver",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res) => {
    const { vehicleId } = req.params;

    try {
      const vehicle = await Vehicle.findById(vehicleId);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      const driverId = vehicle.driverId;
      vehicle.driverId = null;
      await vehicle.save();

      if (driverId) {
        const driver = await Driver.findById(driverId);
        if (driver) {
          driver.vehicleId = null;
          await driver.save();
        }
      }

      res.status(200).json({
        message: "Driver removed from vehicle successfully",
        vehicle,
      });
    } catch (error) {
      console.error("Error removing driver:", error);
      res
        .status(500)
        .json({ message: "An error occurred while removing the driver." });
    }
  }
);

router.put(
  "/change-driver/:vehicleId",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res) => {
    const { vehicleId } = req.params;
    const { driverId } = req.body;

    try {
      const vehicle = await Vehicle.findById(vehicleId);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      const oldDriverId = vehicle.driverId;

      // Assign new driverId to the vehicle
      vehicle.driverId = driverId;
      await vehicle.save();

      // If driver is changed, update both old and new drivers
      if (oldDriverId !== driverId) {
        if (oldDriverId) {
          const oldDriver = await Driver.findById(oldDriverId);
          if (oldDriver) {
            oldDriver.vehicleId = null;
            await oldDriver.save();
          }
        }
        if (driverId) {
          const newDriver = await Driver.findById(driverId);
          if (newDriver) {
            newDriver.vehicleId = vehicleId;
            await newDriver.save();
          }
        }
      }

      res.status(200).json(vehicle);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

router.get(
  "/admin/driver-performance",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res) => {
    const adminId = req.user.id;

    try {
      const drivers = await Driver.find({ adminId })
        .select("_id name isAvailable vehicleId")
        .populate("vehicleId", "model type");

      if (drivers.length === 0) {
        return res
          .status(404)
          .json({ message: "No drivers found for this admin." });
      }

      const completedBookings = await Booking.find({
        status: "completed",
        driverId: { $in: drivers.map((driver) => driver._id) },
      }).select("driverId collectedTime completedTime duration rating");

      const driverPerformance = {};

      completedBookings.forEach((booking) => {
        const {
          driverId,
          collectedTime,
          completedTime,
          duration: estimatedTimeInSeconds,
          rating,
        } = booking;

        const estimatedTime = estimatedTimeInSeconds / 60;

        if (!driverPerformance[driverId]) {
          driverPerformance[driverId] = {
            totalEfficiency: 0,
            totalBookings: 0,
            completedTrips: 0,
            totalRating: 0,
            ratingCount: 0,
          };
        }

        if (collectedTime && completedTime && estimatedTime) {
          const actualTimeTaken =
            (new Date(completedTime) - new Date(collectedTime)) / (1000 * 60);
          const timeEfficiency = (actualTimeTaken / estimatedTime) * 100;
          driverPerformance[driverId].totalEfficiency += timeEfficiency;
          driverPerformance[driverId].totalBookings += 1;
          driverPerformance[driverId].completedTrips += 1;
        }

        // Add rating to performance data if it exists
        if (rating !== undefined && rating !== null) {
          driverPerformance[driverId].totalRating += rating;
          driverPerformance[driverId].ratingCount += 1;
        }
      });

      const performanceResults = drivers.map((driver) => {
        const performanceData = driverPerformance[driver?._id] || {
          totalEfficiency: 0,
          totalBookings: 0,
          completedTrips: 0,
          totalRating: 0,
          ratingCount: 0,
        };

        const averageEfficiency = performanceData.totalBookings
          ? performanceData.totalEfficiency / performanceData.totalBookings
          : 0;

        // Calculate average rating
        const averageRating = performanceData.ratingCount
          ? performanceData.totalRating / performanceData.ratingCount
          : null;

        let performanceCategory = "";
        if (averageEfficiency < 90) {
          performanceCategory = "Excellent";
        } else if (averageEfficiency >= 90 && averageEfficiency <= 110) {
          performanceCategory = "Good";
        } else {
          performanceCategory = "Needs Improvement";
        }

        const routeDetails = driver.isAvailable
          ? null
          : "Route information here";

        // Handle case where vehicle is not assigned
        const vehicle = driver?.vehicleId
          ? {
              id: driver?.vehicleId?._id,
              model: driver?.vehicleId?.model,
              type: driver?.vehicleId?.type,
            }
          : null;

        return {
          driverId: driver._id,
          name: driver.name,
          isAvailable: driver.isAvailable,
          vehicle,
          averageEfficiency,
          performanceCategory,
          completedTrips: performanceData.completedTrips,
          averageRating,
          route: routeDetails,
        };
      });

      console.log(performanceResults);

      res.status(200).json({
        adminId,
        performanceResults,
      });
    } catch (error) {
      res.status(500).json({
        message: "Server error while fetching driver performance.",
        error,
      });
      console.log(error.message);
    }
  }
);

router.get(
  "/admin/vehicle-demand",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res) => {
    try {
      const vehicles = await Vehicle.find({ adminId: req.user.id }).select(
        "_id type"
      );

      if (vehicles.length === 0) {
        return res
          .status(404)
          .json({ message: "No vehicles found for this admin." });
      }

      const vehicleTypeMap = {};
      vehicles.forEach((vehicle) => {
        vehicleTypeMap[vehicle._id] = vehicle.type;
      });

      const bookings = await Booking.find({
        vehicleId: { $in: Object.keys(vehicleTypeMap) },
      }).select("vehicleId");

      if (bookings.length === 0) {
        return res
          .status(404)
          .json({ message: "No bookings found for these vehicles." });
      }

      const vehicleTypeCount = {
        car: 0,
        truck: 0,
        bus: 0,
        motorcycle: 0,
      };

      bookings.forEach((booking) => {
        const vehicleType = vehicleTypeMap[booking.vehicleId];
        if (vehicleType) {
          vehicleTypeCount[vehicleType] += 1;
        }
      });

      const sortedVehicleDemand = Object.entries(vehicleTypeCount)
        .sort((a, b) => a[1] - b[1])
        .map(([type, count]) => ({ type, count }));

      return res.status(200).json({
        vehicleDemand: sortedVehicleDemand,
      });
    } catch (error) {
      console.error("Error fetching vehicle demand:", error.message);
      return res.status(500).json({
        message: "Server error while fetching vehicle demand.",
        error: error.message,
      });
    }
  }
);

export default router;
