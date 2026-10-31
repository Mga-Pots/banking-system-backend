
import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";

const { STAFF_EMAIL, STAFF_PASSWORD, STAFF_CONTACT_NUMBER } = process.env;

if (!STAFF_EMAIL || !STAFF_PASSWORD) {
  console.error("Set STAFF_EMAIL and STAFF_PASSWORD in .env");
  process.exit(1);
}

if (STAFF_PASSWORD.length < 8) {
  console.error("STAFF_PASSWORD must be at least 12 characters");
  process.exit(1);
}

try {
  await connectDB();

  const email = STAFF_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ email });

  if (existing) {
    if (existing.role !== "staff") {
      throw new Error(
        "The configured email already belongs to a non-Staff user."
      );
    }

    console.log("Staff account already exists; no changes made.");
  } else {
    const userData = {
      name: "Sheldon Plankton",
      email,
      passwordHash: await bcrypt.hash(STAFF_PASSWORD, 10),
      role: "staff",
      isVerified: true,
    };

    if (STAFF_CONTACT_NUMBER?.trim()) {
      userData.contactNumber = STAFF_CONTACT_NUMBER.trim();
    }

    await User.create(userData);
    console.log("Development Staff account created.");
  }
} catch (error) {
  console.error("Failed to create Staff account:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
