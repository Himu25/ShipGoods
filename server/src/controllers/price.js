import axios from "axios";
import { pricePerKm, surgcharge } from "../config/price.js";

// Base fare for starting trip in rupees
const BASE_FARE = 500;
const WEATHER_TIMEOUT_MS = 4000;

export const getPrice = async (req, res) => {
  try {
    const { src, dest, vehicleType } = req.body;
    const distance = Number(req.body.distance);

    if (!src || !dest || !vehicleType || !req.body.distance) {
      return res.status(400).json({
        error: "Source, destination, vehicle type, and distance are required",
      });
    }
    if (!pricePerKm[vehicleType]) {
      return res.status(400).json({ error: "Unknown vehicle type" });
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      return res.status(400).json({ error: "Distance must be a positive number of km" });
    }

    // Step 1: Calculate base price (base fare + distance)
    let price = BASE_FARE;
    price += pricePerKm[vehicleType] * distance; // Distance in kilometers

    // Step 2: Apply surcharges
    // Distance surcharge for long trips
    if (distance > 100) {
      price += price * surgcharge["dist>100"];
    }

    // Night surcharge (between 8 PM and 6 AM)
    const currentHour = new Date().getHours();
    if (currentHour >= 20 || currentHour < 6) {
      price += price * surgcharge["night"];
    }

    // Rain at the pickup location
    if (await isRaining(src.lat, src.lng)) {
      price += price * surgcharge["rain"];
    }

    return res.status(200).json({
      data: { price: price.toFixed(2) },
      message: "Price calculated successfully",
    });
  } catch (error) {
    console.error("Price error:", error.message);
    return res
      .status(500)
      .json({ message: "An error occurred while calculating the price." });
  }
};

/** OpenWeather current conditions; false (no surcharge) on any failure. */
async function isRaining(lat, lon) {
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) return false;

  try {
    const { data } = await axios.get("https://api.openweathermap.org/data/2.5/weather", {
      params: { lat, lon, appid: apiKey, units: "metric" },
      timeout: WEATHER_TIMEOUT_MS,
    });
    return (data.weather || []).some((condition) => condition.main?.toLowerCase() === "rain");
  } catch (error) {
    console.error("Error fetching weather data:", error.message);
    return false;
  }
}
