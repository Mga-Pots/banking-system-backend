import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    previousEmail: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },

    contactNumber: {
      type: String,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["customer", "staff", "admin"],
      default: "customer",
    },

    status: {
      type: String,
      enum: ["active", "deactivated", "disabled", "closed"],
      default: "active",
    },

    closedAt: {
      type: Date,
      default: null,
    },

    isClosed: {
      type: Boolean,
      default: false,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    notificationPreferences: {
      email: {
        type: Boolean,
        default: true,
      },
      sms: {
        type: Boolean,
        default: false,
      },
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { isClosed: false },
  }
);

userSchema.index(
  { contactNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isClosed: false,
      contactNumber: { $type: "string" },
    },
  }
);

export default mongoose.model("User", userSchema);