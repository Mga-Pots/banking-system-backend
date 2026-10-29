
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const publicUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  contactNumber: user.contactNumber ?? "",
  role: user.role,
  status: user.status,
  isVerified: user.isVerified,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// Admin creates Staff accounts only.
export const createStaff = async (req, res) => {
  const { name, email, password, contactNumber } = req.body ?? {};

  if (!name?.trim() || !email?.trim() || !password) {
    return fail(res, 400, "Name, email and password are required");
  }

  if (typeof password !== "string" || password.length < 8) {
    return fail(res, 400, "Password must be at least 8 characters");
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const staff = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      contactNumber: String(contactNumber ?? "").trim() || undefined,
      passwordHash,
      role: "staff",
      status: "active",
    });

    return res.status(201).json({
      success: true,
      data: publicUser(staff),
    });
  } catch (err) {
    if (err.code === 11000) {
      return fail(res, 409, "Email or contact number already used");
    }

    console.error("Create staff error:", err);
    return fail(res, 500, "Unable to create Staff account");
  }
};


export const updateStaffStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid Staff ID");
  }

  if (!["active", "deactivated", "disabled", "closed"].includes(status)) {
    return fail(res, 400, "Invalid account status");
  }

  try {
    const staff = await User.findById(id);

    if (!staff) {
      return fail(res, 404, "User not found");
    }

    if (staff.role !== "staff") {
      return fail(res, 403, "This endpoint only manages Staff accounts");
    }

    // Prevent a closed staff account from being reactivated.
    if (staff.status === "closed" && status !== "closed") {
      return fail(
        res,
        400,
        "Closed Staff accounts cannot be reactivated"
      );
    }

    if (status === "closed" && staff.status !== "closed") {
      staff.isClosed = true;
      staff.closedAt = new Date();
    }

    staff.status = status;
    await staff.save();

    return res.status(200).json({
      success: true,
      data: publicUser(staff),
    });
  } catch (err) {
    console.error("Update Staff status error:", err);
    return fail(res, 500, "Unable to update Staff status");
  }
};
