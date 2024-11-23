import kafka from "kafka-node";

const client = new kafka.KafkaClient({ kafkaHost: process.env.KAFKA_HOST });
const producer = new kafka.Producer(client);

const sendDriverLocationToKafka = (driverId, latitude, longitude) => {
  const message = JSON.stringify({ driverId, latitude, longitude });

  producer.send(
    [{ topic: "driver-location-updates", messages: [message] }],
    (err, data) => {
      if (err) {
        console.error("Error publishing message to Kafka", err);
      } else {
        console.log("Location data sent to Kafka:", data);
      }
    }
  );
};

export { sendDriverLocationToKafka };
