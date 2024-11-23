import axios from "axios";
import { pricePerKm, surgcharge } from "../config/price.js";

// Base fare for starting trip in rupees
const BASE_FARE = 500;

export const getPrice = async (req, res) => {
  try {
    const { src, dest, vehicleType, distance } = req.body;
    console.log(
      "🚀 ~ getPrice ~ src, dest, vehicleType, distance:",
      src,
      dest,
      vehicleType,
      distance
    );

    if (!src || !dest || !vehicleType || !distance) {
      return res.status(400).json({
        error: "Source, destination, vehicle type, and distance are required",
      });
    }

    // Step 1: Calculate base price (base fare + distance)
    let price = BASE_FARE;
    price += pricePerKm[vehicleType] * distance; // Distance in kilometers

    // Step 2: Apply surcharges
    // Distance surcharge for long trips
    if (distance > 100) {
      // Distance greater than 100 km
      price += price * surgcharge["dist>100"];
    }

    // Night surcharge (between 8 PM and 6 AM)
    const currentHour = new Date().getHours();
    if (currentHour >= 20 || currentHour < 6) {
      price += price * surgcharge["night"];
    }

    // Check weather at pickup location
    const isRainingSrc = await isRaining(src.lat, src.lng);
    console.log("🚀 ~ getPrice ~ isRainingSrc:", isRainingSrc);
    if (isRainingSrc) {
      price += price * surgcharge["rain"];
    }

    // Step 3: Get traffic data and apply surcharge based on traffic conditions
    const trafficData = await getTraffic(src, dest);
    const trafficCondition = trafficData.traffic;
    console.log("🚀 ~ getPrice ~ trafficCondition:", trafficCondition);

    if (trafficCondition === "traffic-high") {
      price += price * surgcharge["traffic-high"];
    } else if (trafficCondition === "traffic-moderate") {
      price += price * surgcharge["traffic-moderate"];
    }
    console.log(price.toFixed(2));
    // Step 4: Return the final price in INR
    return res.status(200).json({
      data: { price: price.toFixed(2) },
      message: "Price calculated successfully",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "An error occurred while calculating the price." });
  }
};

const getTraffic = async (start, end) => {
  // try {
  //   const response = await axios.post(
  //     "https://api.openrouteservice.org/v2/directions/driving-car",
  //     {
  //       coordinates: [
  //         [start.lng, start.lat],
  //         [end.lng, end.lat],
  //       ],
  //     },
  //     {
  //       headers: {
  //         Authorization: process.env.ORS_API_KEY,
  //         "Content-Type": "application/json",
  //       },
  //     }
  //   );

  //   if (response.status !== 200) {
  //     console.error("Error fetching traffic details:", response.data);
  //     throw new Error("Failed to fetch traffic data.");
  //   }

  //   const data = response.data;
  //   const route = data.routes[0];

  //   if (!route || !route.segments) {
  //     throw new Error("No route segments found in the response.");
  //   }

  //   const segments = route.segments;
  //   const totalDelay = segments.reduce(
  //     (acc, segment) => acc + (segment.delay || 0),
  //     0
  //   );

  //   let trafficInfo;
  //   if (totalDelay < 300) {
  //     trafficInfo = "traffic-low";
  //   } else if (totalDelay < 900) {
  //     trafficInfo = "traffic-moderate";
  //   } else {
  //     trafficInfo = "traffic-high";
  //   }

  //   return {
  //     traffic: trafficInfo,
  //   };
  // } catch (error) {
  //   console.error("Error fetching traffic details:", error.message);
  //   throw error; // Rethrow the error for further handling
  // }
  return { trafficInfo: "traffic-low" };
};

// Weather check function remains unchanged
async function isRaining(lat, lon) {
  const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
  const WEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5/weather";
  const url = `${WEATHER_BASE_URL}?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric`;

  try {
    const response = await axios.get(url);
    const weatherData = response.data;

    // Check for "Rain" condition in the weather data
    const weatherConditions = weatherData.weather;
    const isRaining = weatherConditions.some(
      (condition) => condition.main.toLowerCase() === "rain"
    );

    return isRaining; // Return true if raining, else false
  } catch (error) {
    console.error("Error fetching weather data:", error);
    return false; // Fail-safe: assume no rain if weather API fails
  }
}
