import kafka from "kafka-node";
import getRedisClient from "../redisClient.js";
import Driver from "../models/Driver.js";

const client = new kafka.KafkaClient({ kafkaHost: process.env.KAFKA_HOST });
const consumer = new kafka.Consumer(
  client,
  [{ topic: "driver-location-updates", partition: 0 }],
  { autoCommit: true }
);

const redisClient = getRedisClient();

const driverUpdates = new Map();

const initializeKafkaConsumer = () => {
  consumer.on("message", async (message) => {
    const { driverId, latitude, longitude } = JSON.parse(message.value);
    console.log(
      `Received location update for driver ${driverId}:`,
      latitude,
      longitude
    );

    try {
      await Driver.findByIdAndUpdate(
        driverId,
        {
          currentLocation: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
        },
        { new: true }
      );
      console.log(`Updated MongoDB for driver ${driverId}`);
    } catch (error) {
      console.error(`Error updating MongoDB for driver ${driverId}:`, error);
    }

    try {
      await redisClient.set(
        `driver:${driverId}:location`,
        JSON.stringify({ latitude, longitude })
      );
      console.log(`Updated Redis for driver ${driverId}`);
    } catch (error) {
      console.error(`Error updating Redis for driver ${driverId}:`, error);
    }
  });
  consumer.on("error", (err) => {
    console.error("Error in Kafka consumer:", err);
  });
};

initializeKafkaConsumer();

export default consumer;
