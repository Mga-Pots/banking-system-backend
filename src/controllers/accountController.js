import mongoose from "mongoose";
import BankAccount from "../models/BankAccount.js";
import { getOrCreateAccount } from "../utils/account.js";

const fail = (res, code, message) => res.status(code).json({ success: false, message });

export const getMyAccount = async (req, res) => {
  try {
    const account = await getOrCreateAccount(req.user._id);
    await account.populate("owner", "name email contactNumber isVerified");
    res.status(200).json({ success: true, account, data: account });
  } catch (err) {
    console.error("Get my account error:", err);
    fail(res, 500, "Unable to fetch account");
  }
};

export const getMyBalance = async (req, res) => {
  try {
    const { accountNumber, balance, status } = await getOrCreateAccount(req.user._id);
    const summary = { accountNumber, balance, status };
    res.status(200).json({ success: true, ...summary, data: summary });
  } catch (err) {
    console.error("Get my balance error:", err);
    fail(res, 500, "Unable to fetch balance");
  }
};

export const getAccountById = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "Invalid account ID");

  try {
    const account = await BankAccount.findById(id).populate(
      "owner",
      "name email contactNumber role isVerified"
    );
    if (!account) return fail(res, 404, "Account not found");

    // Customers may only view their own account; staff and admin can view any.
    if (
      req.user.role === "customer" &&
      account.owner?._id?.toString() !== req.user._id.toString()
    ) {
      return fail(res, 403, "Forbidden");
    }

    res.status(200).json({ success: true, account, data: account });
  } catch (err) {
    console.error("Get account by id error:", err);
    fail(res, 500, "Unable to fetch account");
  }
};
