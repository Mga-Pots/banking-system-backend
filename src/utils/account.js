import { randomInt } from "node:crypto";
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
export const getOrCreateAccount = async (ownerId) => {
  const existing = await BankAccount.findOne({ owner: ownerId });
  if (existing) return existing;
  try {
    return await createAccountFor(ownerId);
  } catch (err) {
    // A concurrent request may have created it first (owner is unique).
    if (err.code === 11000) {
      const created = await BankAccount.findOne({ owner: ownerId });
      if (created) return created;
    }
    throw err;
  }
};
