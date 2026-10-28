import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import { createAccountFor } from "../utils/account.js";
import { createNotification } from "../utils/notification.js";

const MAX_LOGIN_ATTEMPTS = 3;
const LOCK_MINUTES = 15;

const sign = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const publicUser = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  contactNumber: u.contactNumber ?? "",
  role: u.role,
  status: u.status,
  isVerified: u.isVerified,
  notificationPreferences: u.notificationPreferences,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

const fail = (res, code, message) => res.status(code).json({ success: false, message });

export const register = async (req, res) => {
  const { name, email, password } = req.body;
  // Contact number is optional: an empty value is stored as "not set"
  const contactNumber = String(req.body.contactNumber ?? "").trim() || undefined;

  if (!name || !email || !password) {
    return fail(res, 400, "Name, email and password are required");
  }
  if (password.length < 8) {
    return fail(res, 400, "Password must be at least 8 characters");
  }
  const session = await mongoose.startSession();
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    // role is never read from the request body
    const user = await User.create({ name, email, contactNumber, passwordHash });
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
  if (!user) return fail(res, 401, "Invalid email or password");

  // Locked? Refuse even the correct password until the lock expires
  if (user.lockUntil && user.lockUntil > Date.now()) {
    const minutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
    return fail(res, 429, `Too many failed attempts. Try again in ${minutes} minute(s).`);
  }

  const match = await bcrypt.compare(password, user.passwordHash);

  if (!match) {
    // $inc is atomic, so rapid-fire attempts can't slip past the count
    const updated = await User.findByIdAndUpdate(
      user._id,
      { $inc: { failedLoginAttempts: 1 } },
      { new: true }
    );
    const remaining = MAX_LOGIN_ATTEMPTS - updated.failedLoginAttempts;

    if (remaining <= 0) {
      await User.updateOne(
        { _id: user._id },
        {
          failedLoginAttempts: 0,
          lockUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000),
        }
      );
      await createNotification({
        recipient: user._id,
        type: "security",
        message: `Your account was temporarily locked for ${LOCK_MINUTES} minutes due to multiple failed login attempts.`,
      });
      return fail(res, 429, `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`);
    }
    return fail(res, 401, `Invalid email or password. ${remaining} attempt(s) left.`);
  }

  if (user.status !== "active") return fail(res, 403, "This account is not active");

  // Successful login: clear the counter and any expired lock
  if (user.failedLoginAttempts > 0 || user.lockUntil) {
    await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockUntil: null });
  }

  res.json({ success: true, data: { user: publicUser(user), token: sign(user._id) } });
};

export const me = (req, res) => res.json({ success: true, data: publicUser(req.user) });

// JWTs are stateless, so the client discards its own token. This just confirms the call.
export const logout = (req, res) => res.json({ success: true, data: null });