import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { writeAuditLog } from "../utils/auditLog.js";

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

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string"
  ) {
    return fail(res, 400, "Name, email, and password are required.");
  }

  if (password.length < 8) {
    return fail(res, 400, "Password must be at least 8 characters.");
  }

  if (
    contactNumber !== undefined &&
    contactNumber !== null &&
    typeof contactNumber !== "string"
  ) {
    return fail(res, 400, "Contact number must be a string.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedContactNumber = contactNumber?.trim() || undefined;

  const session = await mongoose.startSession();

  try {
    let staff;

    await session.withTransaction(async () => {
      const passwordHash = await bcrypt.hash(password, 12);

      [staff] = await User.create(
        [
          {
            name: name.trim(),
            email: normalizedEmail,
            contactNumber: normalizedContactNumber,
            passwordHash,
            role: "staff",
            status: "active",
          },
        ],
        { session }
      );

      await writeAuditLog({
        actor: req.user._id,
        actorRole: req.user.role,
        action: "STAFF_CREATED",
        targetType: "User",
        targetId: staff._id,
        outcome: "success",
        metadata: {
          targetRole: staff.role,
          targetStatus: staff.status,
        },
        session,
      });
    });

    return res.status(201).json({
      success: true,
      data: publicUser(staff),
    });
  } catch (error) {
    if (error.code === 11000) {
      return fail(
        res,
        409,
        "Email or contact number already used."
      );
    }

    console.error("Create staff error:", error);
    return fail(res, 500, "Unable to create Staff account.");
  } finally {
    await session.endSession();
  }
};

// Admin can update Staff status only.
export const updateStaffStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};

  if (!mongoose.isValidObjectId(id)) {
    return fail(res, 400, "Invalid Staff ID.");
  }

  const allowedStatuses = [
    "active",
    "deactivated",
    "disabled",
    "closed",
  ];

  if (!allowedStatuses.includes(status)) {
    return fail(res, 400, "Invalid account status.");
  }

  const session = await mongoose.startSession();

  try {
    let staff;

    await session.withTransaction(async () => {
      staff = await User.findOne({
        _id: id,
        role: "staff",
      }).session(session);

      if (!staff) {
        const error = new Error("Staff account not found.");
        error.statusCode = 404;
        throw error;
      }

      if (staff.status === "closed" && status !== "closed") {
        const error = new Error(
          "Closed Staff accounts cannot be reactivated."
        );
        error.statusCode = 400;
        throw error;
      }

      if (status === "closed" && staff.status !== "closed") {
        staff.isClosed = true;
        staff.closedAt = new Date();
      }

      staff.status = status;

      await staff.save({ session });

      await writeAuditLog({
        actor: req.user._id,
        actorRole: req.user.role,
        action: "STAFF_STATUS_UPDATED",
        targetType: "User",
        targetId: staff._id,
        outcome: "success",
        metadata: {
          newStatus: staff.status,
        },
        session,
      });
    });

    return res.status(200).json({
      success: true,
      data: publicUser(staff),
    });
  } catch (error) {
    if (error.statusCode) {
      return fail(res, error.statusCode, error.message);
    }

    console.error("Update Staff status error:", error);
    return fail(res, 500, "Unable to update Staff status.");
  } finally {
    await session.endSession();
  }
};

// Admin can view user metadata, not financial information.
export const getAdminUsers = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit, 10) || 50)
  );
  const skip = (page - 1) * limit;

  try {
    const filter = { isClosed: false };

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(
          "_id name email contactNumber role status isVerified createdAt updatedAt"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: users.map((user) => ({
        ...user,
        contactNumber: user.contactNumber ?? "",
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get admin users error:", error);
    return fail(res, 500, "Unable to fetch users.");
  }
};

// Admin can view sanitized audit logs.
export const getAdminAuditLogs = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit, 10) || 50)
  );
  const skip = (page - 1) * limit;

  const filter = {};

  if (req.query.action) {
    filter.action = req.query.action;
  }

  if (req.query.actorRole) {
    if (
      !["admin", "staff", "customer", "system"].includes(
        req.query.actorRole
      )
    ) {
      return fail(res, 400, "Invalid actor role.");
    }

    filter.actorRole = req.query.actorRole;
  }

  try {
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .select(
          "_id actor actorRole action targetType targetId outcome metadata createdAt"
        )
        .populate("actor", "name email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    const validStatuses = [
      "active",
      "deactivated",
      "disabled",
      "closed",
    ];

    const data = logs.map((log) => {
      const metadata = {};

      if (log.action === "STAFF_CREATED") {
        if (["admin", "staff"].includes(log.metadata?.targetRole)) {
          metadata.targetRole = log.metadata.targetRole;
        }

        if (validStatuses.includes(log.metadata?.targetStatus)) {
          metadata.targetStatus = log.metadata.targetStatus;
        }
      }

      if (log.action === "STAFF_STATUS_UPDATED") {
        if (validStatuses.includes(log.metadata?.newStatus)) {
          metadata.newStatus = log.metadata.newStatus;
        }
      }

      return {
        id: log._id,
        actor: log.actor
          ? {
              id: log.actor._id,
              name: log.actor.name,
              email: log.actor.email,
              role: log.actor.role,
            }
          : null,
        actorRole: log.actorRole,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        outcome: log.outcome,
        metadata,
        createdAt: log.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get admin audit logs error:", error);
    return fail(res, 500, "Unable to fetch audit logs.");
  }
};
