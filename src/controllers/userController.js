import User from "../models/User.js";

const fail = (res, code, message) => res.status(code).json({ success: false, message });

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

    // Return updated user matching publicUser shape in authController
    return res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        contactNumber: user.contactNumber ?? "",
        role: user.role,
        status: user.status,
        isVerified: user.isVerified,
        notificationPreferences: user.notificationPreferences,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    console.error("Update notification preferences error:", err);
    return fail(res, 500, "Unable to update notification preferences");
  }
};
