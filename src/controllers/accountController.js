import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import BankAccount from "../models/BankAccount.js";
import User from "../models/User.js";
import {
  getOrCreateAccount,
  normalizeAccountNumber,
  deriveCardDetails,
  formatAccount,
} from "../utils/account.js";

const MAX_LOGIN_ATTEMPTS = 3;
const LOCK_MINUTES = 15;

const fail = (res, code, message) => res.status(code).json({ success: false, message });

export const getMyAccount = async (req, res) => {
  try {
    const account = await getOrCreateAccount(req.user._id);
    res.status(200).json({ success: true, data: formatAccount(account) });
  } catch (err) {
    console.error("Get my account error:", err);
    fail(res, 500, "Unable to fetch account");
  }
};

export const getMyBalance = async (req, res) => {
  try {
    const { accountNumber, balance, status } = await getOrCreateAccount(req.user._id);
    res.status(200).json({ success: true, data: { accountNumber, balance, status } });
  } catch (err) {
    console.error("Get my balance error:", err);
    fail(res, 500, "Unable to fetch balance");
  }
};

export const getMyCardDetails = async (req, res) => {
  if (!req.user.isVerified) {
    return fail(res, 403, "Your account must be verified to use the card");
  }

  const password = req.body?.password;
  if (!password || typeof password !== "string") {
    return fail(res, 400, "Password is required");
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) return fail(res, 404, "User not found");

    if (user.lockUntil && user.lockUntil > Date.now()) {
      const minutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return fail(res, 429, `Too many failed attempts. Try again in ${minutes} minute(s).`);
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
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
        return fail(res, 429, `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`);
      }
      return fail(res, 403, "Incorrect password");
    }

    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockUntil: null });
    }

    const account = await getOrCreateAccount(req.user._id);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ success: true, data: deriveCardDetails(account) });
  } catch (err) {
    console.error("Get my card details error:", err);
    return fail(res, 500, "Unable to fetch card details");
  }
};

export const getAccountById = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "Invalid account ID");

  try {
    const account = await BankAccount.findById(id);
    if (!account) return fail(res, 404, "Account not found");

    // Customers may only view their own account; staff and admin can view any.
    if (
      req.user.role === "customer" &&
      account.owner?.toString() !== req.user._id.toString()
    ) {
      return fail(res, 403, "Forbidden");
    }

    res.status(200).json({ success: true, data: formatAccount(account) });
  } catch (err) {
    console.error("Get account by id error:", err);
    fail(res, 500, "Unable to fetch account");
  }
};

const getInitials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .slice(0, 2)
    .join("");

// "Juan Dela Cruz" -> "Juan C." (first name + last initial only)
const maskName = (name = "") => {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

export const lookupAccount = async (req, res) => {
  const accountNumber = normalizeAccountNumber(req.params.accountNumber);
  if (!accountNumber) return fail(res, 400, "Account number must be a 12-digit number");

  try {
    const account = await BankAccount.findOne({ accountNumber }).populate("owner", "name");
    if (!account) return fail(res, 404, "Account not found");

    if (account.owner?._id?.toString() === req.user._id.toString()) {
      return fail(res, 400, "You can't send money to your own account");
    }
    if (account.status !== "active") {
      return fail(res, 403, "Recipient account cannot receive money");
    }

    const ownerName = account.owner?.name ?? "";
    res.status(200).json({
      success: true,
      data: {
        accountNumber: account.accountNumber,
        displayName: maskName(ownerName),
        initials: getInitials(ownerName),
      },
    });
  } catch (err) {
    console.error("Lookup account error:", err);
    fail(res, 500, "Unable to look up account");
  }
};


export const freezeAccount = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid account ID");
  }

  if (!reason?.trim()) {
    return fail(res, 400, "A reason is required to freeze an account");
  }

  try {
    const account = await BankAccount.findById(id);

    if (!account) {
      return fail(res, 404, "Account not found");
    }

    if (account.status === "closed") {
      return fail(res, 400, "Cannot freeze a closed account");
    }

    if (account.status === "frozen") {
      return fail(res, 400, "Account is already frozen");
    }

    account.status = "frozen";
    await account.save();

    res.status(200).json({
      success: true,
      message: "Account frozen successfully",
      data: account,
    });
  } catch (err) {
    console.error("Freeze account error:", err);
    fail(res, 500, "Unable to freeze account");
  }
};

export const unfreezeAccount = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid account ID");
  }

  try {
    const account = await BankAccount.findById(id);

    if (!account) {
      return fail(res, 404, "Account not found");
    }

    if (account.status === "closed") {
      return fail(res, 400, "Cannot unfreeze a closed account");
    }

    if (account.status === "active") {
      return fail(res, 400, "Account is already active");
    }

    account.status = "active";
    await account.save();

    res.status(200).json({
      success: true,
      message: "Account unfrozen successfully",
      data: account,
    });
  } catch (err) {
    console.error("Unfreeze account error:", err);
    fail(res, 500, "Unable to unfreeze account");
  }
};

