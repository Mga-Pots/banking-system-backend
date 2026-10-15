import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const sign = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const publicUser = (u) => ({
  id: u._id, name: u.name, email: u.email, contactNumber: u.contactNumber, role: u.role,
});

export const register = async (req, res) => {
  const { name, email, contactNumber, password } = req.body;
  if (!name || !email || !contactNumber || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    // role is never read from the request body
    const user = await User.create({ name, email, contactNumber, passwordHash });
    res.status(201).json({ token: sign(user._id), user: publicUser(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "Email or contact number already used" });
    }
    throw err;
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  const valid = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  res.json({ token: sign(user._id), user: publicUser(user) });
};

export const me = (req, res) => res.json(publicUser(req.user));