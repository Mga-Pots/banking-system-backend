import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    contactNumber: { type: String, unique: true, sparse: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["customer", "staff", "admin"], default: "customer" },
    status: {
      type: String,
      enum: ["active", "deactivated", "disabled", "closed"],
      default: "active",
    },
    isVerified: { type: Boolean, default: false },
    notificationPreferences: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
    },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);