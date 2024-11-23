import express from "express";
import { getPrice } from "../controllers/price.js";

const router = express.Router();

router.post("/get-price", getPrice);
export default router;
