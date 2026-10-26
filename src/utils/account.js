import { createHmac, randomInt } from "node:crypto";
import BankAccount from "../models/BankAccount.js";

const MAX_ATTEMPTS = 5;

// 12 digits: "0012" + 8 random digits, e.g. 001234567890
const generateAccountNumber = () => `0012${String(randomInt(0, 100000000)).padStart(8, "0")}`;

// Creates a BankAccount for the owner. Pass a session to join an existing transaction.
export const createAccountFor = async (ownerId, session) => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const accountNumber = generateAccountNumber();
    if (await BankAccount.exists({ accountNumber }).session(session ?? null)) continue;
    const [account] = await BankAccount.create([{ accountNumber, owner: ownerId }], { session });
    return account;
  }
  throw new Error("Could not generate a unique account number");
};

// Returns the owner's account, lazily creating one for users registered before accounts existed.
// Pass a session to join an existing transaction.
export const getOrCreateAccount = async (ownerId, session) => {
  const existing = await BankAccount.findOne({ owner: ownerId }).session(session ?? null);
  if (existing) return existing;
  try {
    return await createAccountFor(ownerId, session);
  } catch (err) {
    // A concurrent request may have created it first (owner is unique).
    if (err.code === 11000) {
      const created = await BankAccount.findOne({ owner: ownerId }).session(session ?? null);
      if (created) return created;
    }
    throw err;
  }
};

// Strips whitespace and returns the 12-digit account number, or null if the input is invalid.
export const normalizeAccountNumber = (raw) => {
  if (typeof raw !== "string") return null;
  const normalized = raw.replace(/\s+/g, "");
  return /^\d{12}$/.test(normalized) ? normalized : null;
};

// Deterministically derives simulated virtual card details from the account without storing PAN/CVC in MongoDB.
export const deriveCardDetails = (account) => {
  const secret = process.env.JWT_SECRET || "sinop-card-secret";
  const panHmacHex = createHmac("sha256", secret)
    .update(`pan:${account._id}:${account.accountNumber}`)
    .digest("hex");
  const cvcHmacHex = createHmac("sha256", secret)
    .update(`cvc:${account._id}:${account.accountNumber}`)
    .digest("hex");

  const panSuffix = String(BigInt("0x" + panHmacHex) % 100000000n).padStart(8, "0");
  const cardNumber = `45218830${panSuffix}`;

  const created = account.createdAt ? new Date(account.createdAt) : new Date();
  const month = String(created.getUTCMonth() + 1).padStart(2, "0");
  const year = String((created.getUTCFullYear() + 5) % 100).padStart(2, "0");
  const cardExpiry = `${month}/${year}`;

  const cardCvc = String(BigInt("0x" + cvcHmacHex) % 1000n).padStart(3, "0");

  return { cardNumber, cardExpiry, cardCvc };
};

export const formatAccount = (account) => {
  const { cardNumber } = deriveCardDetails(account);
  return {
    _id: account._id,
    accountNumber: account.accountNumber,
    cardLastFour: cardNumber.slice(-4),
    owner: account.owner?._id ?? account.owner,
    balance: account.balance,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
};
