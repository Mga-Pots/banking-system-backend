import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";

const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  process.exit(1);
}

await connectDB();

if (await User.findOne({ email: ADMIN_EMAIL.toLowerCase() })) {
  console.log("Admin already exists");
} else {
  await User.create({
    name: "Admin",
    email: ADMIN_EMAIL,
    contactNumber: "0000000000",
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
    role: "admin",
  });
  console.log("Admin created");
}

await mongoose.disconnect();