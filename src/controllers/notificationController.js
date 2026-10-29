import mongoose from "mongoose";
import Notification from "../models/Notification.js";

const fail = (res, code, message) => res.status(code).json({ success: false, message });

/**
 * GET /api/notifications
 * Retrieves notifications for the logged-in user.
 * Defaults to the latest 50 notifications sorted newest first.
 * Attaches X-Total-Count and X-Unread-Count response headers.
 */
export const getMyNotifications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ recipient: req.user._id }),
      Notification.countDocuments({ recipient: req.user._id, isRead: false }),
    ]);

    res.set("X-Total-Count", String(total));
    res.set("X-Unread-Count", String(unreadCount));

    return res.status(200).json({
      success: true,
      data: notifications,
    });
  } catch (err) {
    console.error("Get notifications error:", err);
    return fail(res, 500, "Unable to fetch notifications");
  }
};

/**
 * GET /api/notifications/unread-count
 * Returns unread notification count for the logged-in user.
 */
export const getUnreadNotificationCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      data: { unreadCount },
    });
  } catch (err) {
    console.error("Get unread count error:", err);
    return fail(res, 500, "Unable to count unread notifications");
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Marks a single notification as read.
 */
export const markAsRead = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid notification ID");
  }

  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.user._id },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notification) {
      return fail(res, 404, "Notification not found");
    }

    return res.status(200).json({
      success: true,
      data: notification,
    });
  } catch (err) {
    console.error("Mark notification as read error:", err);
    return fail(res, 500, "Unable to update notification");
  }
};

/**
 * PATCH /api/notifications/read-all
 * Marks all notifications for the logged-in user as read.
 */
export const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (err) {
    console.error("Mark all notifications as read error:", err);
    return fail(res, 500, "Unable to mark all notifications as read");
  }
};

/**
 * DELETE /api/notifications/:id
 * Deletes a single notification.
 */
export const deleteNotification = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid notification ID");
  }

  try {
    const notification = await Notification.findOneAndDelete({
      _id: id,
      recipient: req.user._id,
    });

    if (!notification) {
      return fail(res, 404, "Notification not found");
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted",
    });
  } catch (err) {
    console.error("Delete notification error:", err);
    return fail(res, 500, "Unable to delete notification");
  }
};

/**
 * DELETE /api/notifications
 * Clears all notifications for the logged-in user.
 */
export const clearNotifications = async (req, res) => {
  try {
    await Notification.deleteMany({ recipient: req.user._id });

    return res.status(200).json({
      success: true,
      message: "Notifications cleared",
    });
  } catch (err) {
    console.error("Clear notifications error:", err);
    return fail(res, 500, "Unable to clear notifications");
  }
};

/**
 * GET /api/admin/notifications
 * Returns sanitized system-wide notification metadata for Admin.
 * Does not expose notification messages or transaction details.
 */

export const getAdminNotificationLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 50)
    );
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find({})
        .select("_id recipient type createdAt isRead")
        .populate("recipient", "name email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({}),
    ]);

    const data = notifications.map((notification) => ({
      id: notification._id,
      recipient: notification.recipient
        ? {
            id: notification.recipient._id,
            name: notification.recipient.name,
            email: notification.recipient.email,
            role: notification.recipient.role,
          }
        : null,
      type: notification.type,
      createdAt: notification.createdAt,
      isRead: notification.isRead,
    }));

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
  } catch (err) {
    console.error("Get admin notification logs error:", err);
    return fail(res, 500, "Unable to fetch notification logs");
  }
};

