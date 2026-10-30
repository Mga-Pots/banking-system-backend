import mongoose from "mongoose";
import User from "../models/User.js";
import BankAccount from "../models/BankAccount.js";
import Transaction from "../models/Transaction.js";

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

export const getStaffCustomers = async (req, res) => {
  try {
    const customers = await User.find({ role: "customer" })
      .select("name email contactNumber role status isVerified createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: customers.map((customer) => ({
        ...customer,
        contactNumber: customer.contactNumber ?? "",
      })),
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

    return res.status(200).json({
      success: true,
      data: {
        ...customer,
        contactNumber: customer.contactNumber ?? "",
      },
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

    customer.isVerified = true;
    await customer.save();

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

  if (!["active", "deactivated", "disabled", "closed"].includes(status)) {
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
        status: "pending",
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

    return res.status(200).json({
      success: true,
      data: publicUser(customer),
    });
  } catch (err) {
    console.error("Update customer status error:", err);
    return fail(res, 500, "Unable to update customer status");
  }
};