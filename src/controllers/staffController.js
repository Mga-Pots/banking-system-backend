
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

// Staff manages customer user-account statuses only.
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

    customer.status = status;
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