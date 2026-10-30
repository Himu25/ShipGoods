import jwt from "jsonwebtoken";
import User from "../models/User.js";

const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
};

/** authorizeRole("admin") or authorizeRole("user", "admin"). */
const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.sendStatus(403);
    }
    next();
  };
};

/**
 * The Driver _id (not the User _id) behind a driver's token, or null.
 * Tokens issued since login started carrying driverId use the claim;
 * older tokens fall back to one lookup.
 */
const resolveDriverId = async (user) => {
  if (user?.role !== "driver") return null;
  if (user.driverId) return String(user.driverId);
  const doc = await User.findById(user.id).select("driverId").lean();
  return doc?.driverId ? String(doc.driverId) : null;
};

/** Driver-only route; sets req.driverId. */
const requireDriver = async (req, res, next) => {
  try {
    const driverId = await resolveDriverId(req.user);
    if (!driverId) return res.sendStatus(403);
    req.driverId = driverId;
    next();
  } catch (error) {
    next(error);
  }
};

export { authenticateToken, authorizeRole, requireDriver, resolveDriverId };
