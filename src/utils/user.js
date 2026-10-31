/**
 * Standardized user response shape.
 * Omits contactNumber when unset to avoid MongoDB partial index collision
 * and maintain contract parity across all user endpoints.
 */
export const publicUser = (u) => {
  if (!u) return null;
  return {
    _id: u._id,
    name: u.name,
    email: u.email,
    ...(u.contactNumber ? { contactNumber: u.contactNumber } : {}),
    role: u.role,
    status: u.status,
    isVerified: Boolean(u.isVerified),
    notificationPreferences: u.notificationPreferences ?? { email: true, sms: false },
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
};
