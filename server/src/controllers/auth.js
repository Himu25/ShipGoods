import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Driver from "../models/Driver.js";

export const signup = async (req, res) => {
  const { name, email, password, role } = req.body;

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }
    const user = new User({ name, email, password, role });
    await user.save();

    res.status(201).json({
      message: "User created successfully",
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
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
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const authMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate("driverId");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const response = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    if (user.driverId) {
      response.driverInfo = user.driverId;
    }

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getUserById = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findById(id).populate("driverId");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const response = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    if (user.driverId) {
      response.driverInfo = user.driverId;
    }

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const updateUser = async (req, res) => {
  const { id } = req.params;
  const { name, email, password, role, licenseNumber } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.name = name || user.name;
    user.email = email || user.email;
    user.role = role || user.role;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    if (user.role === "driver") {
      const driver = await Driver.findById(user.driverId);
      if (driver) {
        driver.licenseNumber = licenseNumber || driver.licenseNumber;
        driver.name = name;
        await driver.save();
      }
    }

    await user.save();

    const response = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    if (user.driverId) {
      response.driverInfo = user.driverId;
    }

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
