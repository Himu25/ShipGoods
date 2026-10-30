import express from "express";
import {
  authMe,
  getUserById,
  login,
  signup,
  updateUser,
} from "../controllers/auth.js";
import { authenticateToken } from "../middleware/index.js";
import getRedisClient from "../redisClient.js";

const router = express.Router();

/** At most `max` attempts per IP per window; fails open if Redis is down. */
const throttle = (name, max, windowSec) => async (req, res, next) => {
  try {
    const key = `throttle:${name}:${req.ip}`;
    const redis = getRedisClient();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    if (count > max) {
      return res.status(429).json({ message: "Too many attempts. Please try again later." });
    }
  } catch (error) {
    console.error("Throttle check failed:", error.message);
  }
  next();
};

router.post("/auth/signup", throttle("signup", 10, 3600), signup);

router.post("/auth/login", throttle("login", 20, 900), login);

router.get("/auth/me", authenticateToken, authMe);

router.get("/user/:id", authenticateToken, getUserById);

router.put("/user/:id", authenticateToken, updateUser);

export default router;
