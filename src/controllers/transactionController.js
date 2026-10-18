import { randomInt } from "node:crypto";
import mongoose from "mongoose";
import BankAccount from "../models/BankAccount.js";
import Transaction from "../models/Transaction.js";
import { getOrCreateAccount } from "../utils/account.js";

const MAX_REFERENCE_ATTEMPTS = 5;

const fail = (res, code, message) => res.status(code).json({ success: false, message });

const httpError = (status, message) => Object.assign(new Error(message), { status });

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// Positive finite number with at most 2 decimal places.
const isValidAmount = (amount) =>
  typeof amount === "number" &&
  Number.isFinite(amount) &&
  amount > 0 &&
  Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;

// TXN-YYYYMMDD-XXXX, where XXXX is a random 4-digit number
const generateReference = () => {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `TXN-${date}-${String(randomInt(0, 10000)).padStart(4, "0")}`;
};

const isDuplicateReference = (err) =>
  err?.code === 11000 && (err.keyPattern?.referenceNumber || err.keyValue?.referenceNumber);

export const cashIn = async (req, res) => {
  const amount = req.body?.amount;
  if (!isValidAmount(amount)) {
    return fail(res, 400, "Amount must be a positive number with at most 2 decimal places");
  }
  const value = round2(amount);

  const session = await mongoose.startSession();
  try {
    // Ensures existing customers without an account don't hit a 404
    const { _id: accountId } = await getOrCreateAccount(req.user.id);

    let result;
    for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt++) {
      const referenceNumber = generateReference();
      try {
        // A duplicate key aborts the DB transaction, so a retry restarts the whole unit of work.
        await session.withTransaction(async () => {
          const account = await BankAccount.findById(accountId).session(session);
          if (!account) throw httpError(404, "Bank account not found");
          if (account.status !== "active") {
            throw httpError(403, `Account is ${account.status} and cannot receive funds`);
          }

          account.balance = round2(account.balance + value);
          await account.save({ session });

          const [txn] = await Transaction.create(
            [
              {
                referenceNumber,
                transactionType: "cash_in",
                amount: value,
                destinationAccount: account._id,
                performedBy: req.user.id,
                status: "completed",
              },
            ],
            { session }
          );

          result = {
            reference: txn.referenceNumber,
            amount: txn.amount,
            status: txn.status,
            createdAt: txn.createdAt,
            newBalance: account.balance,
          };
        });
        break;
      } catch (err) {
        if (isDuplicateReference(err) && attempt < MAX_REFERENCE_ATTEMPTS) continue;
        throw err;
      }
    }

    return res.status(200).json({
      success: true,
      message: "Cash in successful",
      ...result,
      data: { ...result },
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Cash in error:", err);
    return fail(res, 500, "Unable to process cash in");
  } finally {
    await session.endSession();
  }
};
