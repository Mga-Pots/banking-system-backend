import mongoose from "mongoose";
import User from "../models/User.js";
import BankAccount from "../models/BankAccount.js";
import Transaction from "../models/Transaction.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { publicUser } from "../utils/user.js";
import { createNotification } from "../utils/notification.js";

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

// What staff see about a customer: identity fields and their bank account.
// No role or notification preferences. The balance is only on the detail view.
const staffCustomerView = (user, account, { withBalance = false } = {}) => {
  const { role, notificationPreferences, ...view } = publicUser(user);
  return {
    ...view,
    account: account
      ? {
          _id: account._id,
          accountNumber: account.accountNumber,
          status: account.status,
          ...(withBalance && { balance: account.balance }),
        }
      : null,
  };
};

export const getStaffCustomers = async (req, res) => {
  try {
    const customers = await User.find({ role: "customer" })
      .select("name email contactNumber role status isVerified createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    const accounts = await BankAccount.find({
      owner: { $in: customers.map((c) => c._id) },
    })
      .select("accountNumber status owner")
      .lean();
    const byOwner = new Map(accounts.map((a) => [String(a.owner), a]));

    return res.status(200).json({
      success: true,
      data: customers.map((c) => staffCustomerView(c, byOwner.get(String(c._id)))),
    });
  } catch (err) {
    console.error("Get staff customers error:", err);
    return fail(res, 500, "Unable to retrieve customers");
  }
};

export const getStaffCustomerById = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid customer ID");
  }

  try {
    const customer = await User.findById(id)
      .select(
        "name email contactNumber role status isVerified createdAt updatedAt"
      )
      .lean();

    if (!customer) {
      return fail(res, 404, "User not found");
    }

    if (customer.role !== "customer") {
      return fail(
        res,
        404,
        "Customer not found"
      );
    }

    const account = await BankAccount.findOne({ owner: customer._id })
      .select("accountNumber status balance")
      .lean();

    return res.status(200).json({
      success: true,
      data: staffCustomerView(customer, account, { withBalance: true }),
    });
  } catch (err) {
    console.error("Get staff customer by ID error:", err);
    return fail(res, 500, "Unable to retrieve customer");
  }
};

export const verifyCustomer = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid customer ID");
  }

  try {
    const customer = await User.findById(id);

    if (!customer) {
      return fail(res, 404, "Customer not found");
    }

    if (customer.role !== "customer") {
      return fail(res, 404, "Customer not found");
    }

    const wasVerified = customer.isVerified;
    customer.isVerified = true;
    await customer.save();

    // Notify only on the first verification, not on a repeat call.
    if (!wasVerified) {
      // A failed notification must not fail the verification or skip the audit log.
      try {
        await createNotification({
          recipient: customer._id,
          type: "account",
          message:
            "Your account is verified. You can now transfer money and view your card details.",
        });
      } catch (err) {
        console.error("Verify notification error:", err);
      }
    }

    await writeAuditLog({
      actor: req.user._id,
      actorRole: req.user.role,
      action: "CUSTOMER_VERIFIED",
      targetType: "User",
      targetId: customer._id,
      outcome: "success",
      metadata: {},
    });

    return res.status(200).json({
      success: true,
      data: publicUser(customer),
    });
  } catch (err) {
    console.error("Verify customer error:", err);
    return fail(res, 500, "Unable to verify customer");
  }
};

export const getStaffAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find()
      .populate("owner", "name email")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: accounts,
    });
  } catch (err) {
    console.error("Get staff accounts error:", err);
    return fail(res, 500, "Unable to retrieve accounts");
  }
};

export const updateCustomerStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid customer ID");
  }

  if (status !== "closed") {
    return fail(res, 400, "Invalid account status");
  }

  try {
    const customer = await User.findById(id);

    if (!customer) {
      return fail(res, 404, "User not found");
    }

    if (customer.role !== "customer") {
      return fail(
        res,
        403,
        "This endpoint only manages customer accounts"
      );
    }

    // Do not allow a closed customer to be reactivated here.
    // Their original email may already belong to a new customer.
    if (customer.status === "closed" && status !== "closed") {
      return fail(
        res,
        400,
        "Closed customer accounts cannot be reactivated"
      );
    }

    if (status === "closed" && customer.status !== "closed") {
      // Find the customer's bank account.
      const bankAccount = await BankAccount.findOne({
        owner: customer._id,
      });

      if (!bankAccount) {
        return fail(
          res,
          400,
          "Cannot close customer account because no bank account exists"
        );
      }

      // The account must have a zero balance.
      if (bankAccount.balance !== 0) {
        return fail(
          res,
          400,
          "Cannot close customer account while the bank account has a remaining balance"
        );
      }

      // Reject closure if a transaction is still pending.
      const pendingTransaction = await Transaction.exists({
        status: { $in: ["pending", "flagged"] },
        $or: [
          { sourceAccount: bankAccount._id },
          { destinationAccount: bankAccount._id },
        ],
      });

      if (pendingTransaction) {
        return fail(
          res,
          400,
          "Cannot close customer account while transactions are pending"
        );
      }

      customer.isClosed = true;
      customer.closedAt = new Date();

      // Close the bank account.
      bankAccount.status = "closed";
      await bankAccount.save();
    }

    customer.status = status;

    // Save the customer's new status and closure information.
    await customer.save();

    await writeAuditLog({
      actor: req.user._id,
      actorRole: req.user.role,
      action: "ACCOUNT_CLOSED",
      targetType: "User",
      targetId: customer._id,
      outcome: "success",
      metadata: {
        newStatus: customer.status,
      },
    });

    return res.status(200).json({
      success: true,
      data: publicUser(customer),
    });
  } catch (err) {
    console.error("Update customer status error:", err);
    return fail(res, 500, "Unable to update customer status");
  }
};