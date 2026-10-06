import kafka from "kafka-node";
import Driver from "../models/Driver.js";

const client = new kafka.KafkaClient({ kafkaHost: process.env.KAFKA_HOST });
const consumer = new kafka.Consumer(
  client,
  [{ topic: "driver-location-updates", partition: 0 }],
  { autoCommit: true }
);

const initializeKafkaConsumer = () => {
  consumer.on("message", async (message) => {
    const { driverId, latitude, longitude } = JSON.parse(message.value);

    // This consumer only persists to Mongo for durability — it must NOT
    // also write the "driver:<id>:location" Redis key. socketService.js
    // already owns that cache (with validation, a TTL and an updatedAt
    // timestamp); this consumer's messages are only produced *after* that
    // validation passes, but writing the same key from here too raced
    // with it and silently corrupted the cache (overwriting a validated,
    // timestamped entry with one that has neither), which defeated the
    // implausible-jump check downstream.
    try {
      await Driver.findByIdAndUpdate(driverId, {
        currentLocation: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
      });
    } catch (error) {
      console.error(`Error updating MongoDB for driver ${driverId}:`, error.message);
    }
  });
  consumer.on("error", (err) => {
    console.error("Error in Kafka consumer:", err);
  });
};

initializeKafkaConsumer();

export default consumer;
