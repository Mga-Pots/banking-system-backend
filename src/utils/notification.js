import Notification from "../models/Notification.js";

/**
 * Formats integer centavos to Philippine Peso string: e.g. 1000000 -> "₱10,000.00"
 */
export const formatPeso = (centavos) => {
  const pesos = (Number(centavos) || 0) / 100;
  return `₱${pesos.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Formats 12-digit account number into groups of 4: e.g. "009876543210" -> "0098 7654 3210"
 */
export const formatAccountNumber = (accountNumber) => {
  const digits = String(accountNumber || "").replace(/\D/g, "");
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
};

/**
 * Creates a notification record. Optionally accepts a Mongoose session.
 */
export const createNotification = async ({
  recipient,
  type = "system",
  message,
  relatedTransaction = null,
  session = null,
}) => {
  if (!recipient || !message) return null;

  const doc = {
    recipient,
    type,
    message,
    relatedTransaction,
    isRead: false,
  };

  if (session) {
    const [created] = await Notification.create([doc], { session });
    return created;
  }

  return await Notification.create(doc);
};
