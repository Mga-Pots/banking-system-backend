import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import BankAccount from "../models/BankAccount.js";
import Transaction from "../models/Transaction.js";
import { createNotification } from "../utils/notification.js";
import { publicUser } from "../utils/user.js";

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const httpError = (status, message) => Object.assign(new Error(message), { status });

export const updateNotificationPreferences = async (req, res) => {
  const { email, sms } = req.body ?? {};

  if (email !== undefined && typeof email !== "boolean") {
    return fail(res, 400, "email preference must be a boolean");
  }
  if (sms !== undefined && typeof sms !== "boolean") {
    return fail(res, 400, "sms preference must be a boolean");
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) return fail(res, 404, "User not found");

    // Defensive initialization prevents TypeError on legacy documents (QA-SUG-004)
    if (!user.notificationPreferences) {
      user.notificationPreferences = { email: true, sms: false };
    }

    if (email !== undefined) user.notificationPreferences.email = email;
    if (sms !== undefined) user.notificationPreferences.sms = sms;

    await user.save();

    return res.status(200).json({
      success: true,
      data: publicUser(user),
    });
  } catch (err) {
    console.error("Update notification preferences error:", err);
    return fail(res, 500, "Unable to update notification preferences");
  }
};

export const updateMe = async (req, res) => {
  const { name, email, contactNumber } = req.body ?? {};
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!trimmedName || !trimmedEmail) {
    return fail(res, 400, "Name and email are required");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return fail(res, 400, "Enter a valid email address");
  }

  if (
    contactNumber !== undefined &&
    contactNumber !== null &&
    typeof contactNumber !== "string"
  ) {
    return fail(res, 400, "Enter a valid Philippine mobile number");
  }

  let normalizedContact = undefined;
  if (typeof contactNumber === "string" && contactNumber.trim()) {
    const rawContact = contactNumber.trim();
    const mobileRegex = /^(09|\+639)\d{9}$/;
    if (!mobileRegex.test(rawContact)) {
      return fail(res, 400, "Enter a valid Philippine mobile number");
    }
    normalizedContact = rawContact.startsWith("+63")
      ? `0${rawContact.slice(3)}`
      : rawContact;
  }

  try {
    const existingEmail = await User.exists({
      email: trimmedEmail,
      isClosed: false,
      _id: { $ne: req.user._id },
    });
    if (existingEmail) {
      return fail(res, 409, "Email or contact number already used");
    }

    if (normalizedContact) {
      const existingContact = await User.exists({
        contactNumber: normalizedContact,
        isClosed: false,
        _id: { $ne: req.user._id },
      });
      if (existingContact) {
        return fail(res, 409, "Email or contact number already used");
      }
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return fail(res, 404, "User not found");
    }

    user.name = trimmedName;
    user.email = trimmedEmail;
    user.contactNumber = normalizedContact;

    await user.save();

    return res.status(200).json({
      success: true,
      data: publicUser(user),
    });
  } catch (err) {
    if (err.code === 11000) {
      return fail(res, 409, "Email or contact number already used");
    }
    console.error("Update profile error:", err);
    return fail(res, 500, "Unable to update profile");
  }
};

export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (
    !currentPassword ||
    typeof currentPassword !== "string" ||
    !newPassword ||
    typeof newPassword !== "string"
  ) {
    return fail(res, 400, "Current and new password are required");
  }

  if (newPassword.length < 8) {
    return fail(res, 400, "Password must be at least 8 characters");
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return fail(res, 404, "User not found");
    }

    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      return fail(res, 400, "Incorrect password");
    }

    const isReuse = await bcrypt.compare(newPassword, user.passwordHash);
    if (isReuse) {
      return fail(res, 400, "Choose a password you haven't used here before");
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    await createNotification({
      recipient: user._id,
      type: "security",
      message: "Your password was changed. If this wasn't you, contact the bank.",
    });

    return res.status(200).json({
      success: true,
      message: "Password updated",
    });
  } catch (err) {
    console.error("Change password error:", err);
    return fail(res, 500, "Unable to change password");
  }
};

export const deactivateMe = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let updatedUser;
    await session.withTransaction(async () => {
      const account = await BankAccount.findOne({ owner: req.user._id }).session(session);
      if (account && account.balance > 0) {
        throw httpError(400, "Move your remaining balance out before deactivating your account");
      }

      if (account) {
        const hasHeld = await Transaction.exists({
          $or: [{ sourceAccount: account._id }, { destinationAccount: account._id }],
          status: { $in: ["pending", "flagged"] },
        }).session(session);

        if (hasHeld) {
          throw httpError(400, "You can't deactivate while a transfer is still being processed");
        }

        account.status = "frozen";
        await account.save({ session });
      }

      const user = await User.findById(req.user._id).session(session);
      if (!user) {
        throw httpError(404, "User not found");
      }

      user.status = "deactivated";
      await user.save({ session });

      await createNotification({
        recipient: user._id,
        type: "security",
        message: "Your account was deactivated. Contact staff if you wish to reactivate.",
        session,
      });

      updatedUser = user;
    });

    return res.status(200).json({
      success: true,
      data: publicUser(updatedUser),
    });
  } catch (err) {
    if (err.status) {
      return fail(res, err.status, err.message);
    }
    console.error("Deactivate user error:", err);
    return fail(res, 500, "Unable to deactivate account");
  } finally {
    await session.endSession();
  }
};
