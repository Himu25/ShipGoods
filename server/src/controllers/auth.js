import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import Driver from "../models/Driver.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toUserResponse(user) {
  const response = {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
  };
  if (user.driverId) {
    response.driverInfo = user.driverId;
  }
  return response;
}

/** Only the account itself or an admin may read/update a user. */
function canAccessUser(req, id) {
  return req.user.role === "admin" || String(req.user.id) === String(id);
}

export const signup = async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !EMAIL_RE.test(String(email || "")) || String(password || "").length < 6) {
    return res.status(400).json({
      message: "Name, a valid email and a password of at least 6 characters are required",
    });
  }

  try {
    const userExists = await User.findOne({ email: String(email).toLowerCase() });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }
    // Public signup always creates a customer. Drivers are created by an
    // admin (/admin/add-drivers); admins are seeded.
    const user = new User({ name, email, password, role: "user", phone });
    await user.save();

    res.status(201).json({
      message: "User created successfully",
    });
  } catch (error) {
    console.error("Signup error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        role: user.role,
        ...(user.driverId ? { driverId: user.driverId } : {}),
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "14h",
      }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      id: user.role === "driver" ? user.driverId : user._id,
      name: user.name,
      role: user.role,
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const authMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate("driverId");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(toUserResponse(user));
  } catch (error) {
    console.error("authMe error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const getUserById = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid user id" });
  }
  if (!canAccessUser(req, id)) {
    return res.sendStatus(403);
  }

  try {
    const user = await User.findById(id).populate("driverId");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(toUserResponse(user));
  } catch (error) {
    console.error("getUserById error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateUser = async (req, res) => {
  const { id } = req.params;
  const { name, email, password, role, licenseNumber, phone } = req.body;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid user id" });
  }
  if (!canAccessUser(req, id)) {
    return res.sendStatus(403);
  }
  if (role && req.user.role !== "admin") {
    return res.status(403).json({ message: "Only an admin can change roles" });
  }
  if (email && !EMAIL_RE.test(String(email))) {
    return res.status(400).json({ message: "Invalid email" });
  }
  if (password && String(password).length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (email && String(email).toLowerCase() !== user.email) {
      if (await User.exists({ email: String(email).toLowerCase() })) {
        return res.status(400).json({ message: "Email already in use" });
      }
      user.email = email;
    }
    user.name = name || user.name;
    user.role = role || user.role;
    user.phone = phone || user.phone;
    // Plain text here; the pre("save") hook hashes it exactly once.
    if (password) user.password = password;

    if (user.role === "driver") {
      const driver = await Driver.findById(user.driverId);
      if (driver) {
        driver.licenseNumber = licenseNumber || driver.licenseNumber;
        driver.name = user.name;
        await driver.save();
      }
    }

    await user.save();
    res.status(200).json(toUserResponse(user));
  } catch (error) {
    console.error("updateUser error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};
