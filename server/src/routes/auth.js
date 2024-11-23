import express from "express";
import {
  authMe,
  getUserById,
  login,
  signup,
  updateUser,
} from "../controllers/auth.js";
import { authenticateToken } from "../middleware/index.js";

const router = express.Router();

router.post("/auth/signup", signup);

router.post("/auth/login", login);

router.get("/auth/me", authenticateToken, authMe);

router.get("/user/:id", authenticateToken, getUserById);

router.put("/user/:id", authenticateToken, updateUser);

export default router;
