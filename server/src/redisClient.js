import Redis from "ioredis";

let redisClient;

const getRedisClient = () => {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL);
    redisClient.on("error", (err) => {
      console.error("Redis connection error:", err);
    });
  }

  return redisClient;
};

export default getRedisClient;
