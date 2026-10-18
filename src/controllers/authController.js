import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import { createAccountFor } from "../utils/account.js";

const sign = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const publicUser = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  contactNumber: u.contactNumber,
  role: u.role,
  status: u.status,
  isVerified: u.isVerified,
  notificationPreferences: u.notificationPreferences,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

const fail = (res, code, message) => res.status(code).json({ success: false, message });

export const register = async (req, res) => {
  const { name, email, contactNumber, password } = req.body;
  if (!name || !email || !contactNumber || !password) {
    return fail(res, 400, "All fields are required");
  }
  if (password.length < 8) {
    return fail(res, 400, "Password must be at least 8 characters");
  }
  const session = await mongoose.startSession();
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    // User and BankAccount are created together so neither exists without the other
    await session.withTransaction(async () => {
      // role is never read from the request body
      [user] = await User.create([{ name, email, contactNumber, passwordHash }], { session });
      await createAccountFor(user._id, session);
    });
    res.status(201).json({
      success: true,
      data: { user: publicUser(user), token: sign(user._id) },
    });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, "Email or contact number already used");
    throw err;
  } finally {
    await session.endSession();
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return fail(res, 400, "Email and password are required");

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return fail(res, 401, "Invalid email or password");
  }
  if (user.status !== "active") return fail(res, 403, "This account is not active");

  res.json({ success: true, data: { user: publicUser(user), token: sign(user._id) } });
};

export const me = (req, res) => res.json({ success: true, data: publicUser(req.user) });

// JWTs are stateless, so the client discards its own token. This just confirms the call.
export const logout = (req, res) => res.json({ success: true, data: null });