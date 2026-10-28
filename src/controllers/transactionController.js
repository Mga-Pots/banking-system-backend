import { randomInt } from "node:crypto";
import mongoose from "mongoose";
import BankAccount from "../models/BankAccount.js";
import Transaction from "../models/Transaction.js";
import { getOrCreateAccount, normalizeAccountNumber } from "../utils/account.js";
import { createNotification, formatPeso, formatAccountNumber } from "../utils/notification.js";

const MAX_REFERENCE_ATTEMPTS = 5;
// Transfers at or above this amount (in centavos) are held for staff review instead of completing immediately.
const HOLD_THRESHOLD = 5000000; // ₱50,000.00 (5,000,000 centavos)
const HOLD_REASON = "Held for staff review";
const CASH_IN_LIMIT = 5000000; // ₱50,000.00 (5,000,000 centavos) per cash in

const fail = (res, code, message) => res.status(code).json({ success: false, message });

const httpError = (status, message) => Object.assign(new Error(message), { status });

const round2 = (value) => Math.round(value);

// Positive safe integer in centavos (e.g. ₱1.00 = 100 centavos)
const isValidAmount = (amount) =>
  typeof amount === "number" &&
  Number.isSafeInteger(amount) &&
  amount > 0;

// TXN-YYYYMMDD-XXXX, where XXXX is a random 4-digit number
const generateReference = () => {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `TXN-${date}-${String(randomInt(0, 10000)).padStart(4, "0")}`;
};

const isDuplicateReference = (err) =>
  err?.code === 11000 && (err.keyPattern?.referenceNumber || err.keyValue?.referenceNumber);

// Populate an account strictly with its _id and accountNumber for customer responses,
// or include limited owner fields for staff/admin review endpoints.
const accountPopulate = (path, ownerFields = null) =>
  ownerFields
    ? {
        path,
        select: "accountNumber owner",
        populate: { path: "owner", select: ownerFields },
      }
    : {
        path,
        select: "accountNumber",
      };

const formatAccountRef = (acc) => {
  if (!acc) return null;
  const ref = { _id: acc._id, accountNumber: acc.accountNumber };
  if (acc.owner !== undefined) ref.owner = acc.owner;
  return ref;
};

// Formats a populated Transaction into the exact contract shape.
const formatTransaction = (txn) => ({
  _id: txn._id,
  referenceNumber: txn.referenceNumber,
  transactionType: txn.transactionType,
  amount: txn.amount,
  sourceAccount: formatAccountRef(txn.sourceAccount),
  destinationAccount: formatAccountRef(txn.destinationAccount),
  performedBy: txn.performedBy?._id ?? txn.performedBy,
  status: txn.status,
  flagReason: txn.flagReason ?? null,
  createdAt: txn.createdAt,
  updatedAt: txn.updatedAt,
});

export const cashIn = async (req, res) => {
  const amount = req.body?.amount;
  if (!isValidAmount(amount)) {
    return fail(res, 400, "Amount must be a positive integer in centavos");
  }
  if (amount > CASH_IN_LIMIT) {
    return fail(res, 400, "Cash-in limit of ₱50,000 per transaction exceeded");
  }
  const value = amount;

  const session = await mongoose.startSession();
  try {
    // Ensures existing customers without an account don't hit a 404
    const { _id: accountId } = await getOrCreateAccount(req.user.id);

    let createdTxnId;
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

          await createNotification({
            recipient: req.user._id ?? req.user.id,
            type: "transaction",
            message: `Your cash in of ${formatPeso(value)} was successful.`,
            relatedTransaction: txn._id,
            session,
          });

          createdTxnId = txn._id;
        });
        break;
      } catch (err) {
        if (isDuplicateReference(err) && attempt < MAX_REFERENCE_ATTEMPTS) continue;
        throw err;
      }
    }

    const populated = await Transaction.findById(createdTxnId)
      .populate(accountPopulate("sourceAccount"))
      .populate(accountPopulate("destinationAccount"))
      .lean();

    return res.status(200).json({
      success: true,
      data: formatTransaction(populated),
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Cash in error:", err);
    return fail(res, 500, "Unable to process cash in");
  } finally {
    await session.endSession();
  }
};

export const transfer = async (req, res) => {
  const body = req.body ?? {};
  const amount = body.amount;
  if (!isValidAmount(amount)) {
    return fail(res, 400, "Amount must be a positive integer in centavos");
  }
  const value = amount;

  const rawRecipient =
    body.recipientAccountNumber ?? body.destinationAccountNumber ?? body.accountNumber;
  const recipientNumber = normalizeAccountNumber(rawRecipient);
  if (!recipientNumber) {
    return fail(res, 400, "Recipient account number must be a 12-digit number");
  }

  const holdForReview = value >= HOLD_THRESHOLD || body.holdForReview === true;

  const session = await mongoose.startSession();
  try {
    // Ensure the sender has an account before the transaction starts, so a lazy create
    // can't abort (and be retried inside) the transfer's DB transaction.
    await getOrCreateAccount(req.user._id);

    let createdTxnId;
    for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt++) {
      const referenceNumber = generateReference();
      try {
        // A duplicate key aborts the DB transaction, so a retry restarts the whole unit of work.
        await session.withTransaction(async () => {
          const sourceAccount = await getOrCreateAccount(req.user._id, session);
          if (sourceAccount.status !== "active") {
            throw httpError(403, "Frozen or deactivated accounts can't send or receive money");
          }

          const destinationAccount = await BankAccount.findOne({
            accountNumber: recipientNumber,
          }).session(session);
          if (!destinationAccount) throw httpError(404, "Recipient account not found");

          if (sourceAccount._id.equals(destinationAccount._id)) {
            throw httpError(400, "You can't send money to your own account");
          }
          if (destinationAccount.status !== "active") {
            throw httpError(403, "Recipient account is frozen or closed and cannot receive money");
          }
          if (sourceAccount.balance < value) throw httpError(400, "Insufficient balance");

          // Funds always leave the sender immediately so a pending transfer can't be double-spent;
          // the recipient is only credited once the transfer completes.
          sourceAccount.balance = round2(sourceAccount.balance - value);
          await sourceAccount.save({ session });

          if (!holdForReview) {
            destinationAccount.balance = round2(destinationAccount.balance + value);
            await destinationAccount.save({ session });
          }

          const [txn] = await Transaction.create(
            [
              {
                referenceNumber,
                transactionType: "transfer",
                amount: value,
                sourceAccount: sourceAccount._id,
                destinationAccount: destinationAccount._id,
                performedBy: req.user._id,
                status: holdForReview ? "pending" : "completed",
                flagReason: holdForReview ? HOLD_REASON : null,
              },
            ],
            { session }
          );

          if (holdForReview) {
            await createNotification({
              recipient: req.user._id,
              type: "transaction",
              message: `Your transfer of ${formatPeso(value)} to ${formatAccountNumber(destinationAccount.accountNumber)} is being held for review.`,
              relatedTransaction: txn._id,
              session,
            });
          } else {
            await createNotification({
              recipient: req.user._id,
              type: "transaction",
              message: `Your transfer of ${formatPeso(value)} to ${formatAccountNumber(destinationAccount.accountNumber)} was completed.`,
              relatedTransaction: txn._id,
              session,
            });

            await createNotification({
              recipient: destinationAccount.owner,
              type: "transaction",
              message: `You received ${formatPeso(value)} from ${formatAccountNumber(sourceAccount.accountNumber)}.`,
              relatedTransaction: txn._id,
              session,
            });
          }

          createdTxnId = txn._id;
        });
        break;
      } catch (err) {
        if (isDuplicateReference(err) && attempt < MAX_REFERENCE_ATTEMPTS) continue;
        throw err;
      }
    }

    const populated = await Transaction.findById(createdTxnId)
      .populate(accountPopulate("sourceAccount"))
      .populate(accountPopulate("destinationAccount"))
      .lean();

    return res.status(200).json({
      success: true,
      data: formatTransaction(populated),
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Transfer error:", err);
    return fail(res, 500, "Unable to process transfer");
  } finally {
    await session.endSession();
  }
};

// ---------------------------------------------------------------------------
// Commit #4: history, details, cancellation
// ---------------------------------------------------------------------------

const STATUSES = ["completed", "pending", "failed", "cancelled", "flagged"];
const TYPES = ["cash_in", "transfer"];
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 100;

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const idOf = (value) => value?._id ?? value ?? null;
const sameId = (a, b) => a != null && b != null && String(idOf(a)) === String(idOf(b));

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

export const getTransactions = async (req, res) => {
  const query = req.query ?? {};

  const statusParam = String(query.status ?? "all").trim().toLowerCase();
  if (statusParam !== "all" && !STATUSES.includes(statusParam)) {
    return fail(res, 400, `Invalid status. Use one of: all, ${STATUSES.join(", ")}`);
  }
  const typeParam = String(query.type ?? query.transactionType ?? "all").trim().toLowerCase();
  if (typeParam !== "all" && !TYPES.includes(typeParam)) {
    return fail(res, 400, `Invalid type. Use one of: all, ${TYPES.join(", ")}`);
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));

  try {
    const account = await getOrCreateAccount(req.user._id);

    // Money that never reached the user (pending/failed/cancelled incoming transfers) stays hidden.
    const visibility = {
      $or: [
        { sourceAccount: account._id },
        { destinationAccount: account._id, transactionType: "cash_in" },
        { destinationAccount: account._id, transactionType: "transfer", status: "completed" },
      ],
    };

    // Filters shared by the list and the status counts (everything except `status`).
    const clauses = [visibility];
    if (typeParam !== "all") clauses.push({ transactionType: typeParam });

    const periodRaw = String(query.days ?? query.period ?? "").trim().toLowerCase();
    const fromRaw = typeof query.from === "string" ? query.from.trim() : "";
    const toRaw = typeof query.to === "string" ? query.to.trim() : "";

    if (periodRaw === "custom" || fromRaw || toRaw) {
      const createdAtClause = {};
      let parsedFrom = null;
      let parsedTo = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
        parsedFrom = new Date(`${fromRaw}T00:00:00.000Z`);
        if (!isNaN(parsedFrom.getTime())) createdAtClause.$gte = parsedFrom;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
        parsedTo = new Date(`${toRaw}T23:59:59.999Z`);
        if (!isNaN(parsedTo.getTime())) createdAtClause.$lte = parsedTo;
      }
      if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
        return fail(res, 400, "Start date must be on or before the end date");
      }
      if (Object.keys(createdAtClause).length > 0) {
        clauses.push({ createdAt: createdAtClause });
      }
    } else if (periodRaw === "month") {
      clauses.push({ createdAt: { $gte: startOfMonth() } });
    } else if (periodRaw === "7d") {
      clauses.push({ createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } });
    } else if (periodRaw === "30d") {
      clauses.push({ createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } });
    } else if (periodRaw === "3m") {
      clauses.push({ createdAt: { $gte: new Date(Date.now() - 90 * 86400000) } });
    } else if (/^\d+$/.test(periodRaw) && Number(periodRaw) > 0) {
      clauses.push({ createdAt: { $gte: new Date(Date.now() - Number(periodRaw) * 86400000) } });
    } // anything else (including "all") is ignored

    const search = String(query.search ?? query.q ?? "").trim().replace(/\s+/g, "");
    if (search) {
      const or = [{ referenceNumber: { $regex: escapeRegex(search), $options: "i" } }];
      if (/^\d+$/.test(search)) {
        const matched = await BankAccount.find({
          accountNumber: { $regex: escapeRegex(search) },
          _id: { $ne: account._id },
        })
          .select("_id")
          .lean();
        if (matched.length) {
          const ids = matched.map((a) => a._id);
          or.push({ sourceAccount: { $in: ids } }, { destinationAccount: { $in: ids } });
        }
      }
      clauses.push({ $or: or });
    }

    const baseFilter = { $and: clauses };
    const listFilter = statusParam === "all" ? baseFilter : { $and: [...clauses, { status: statusParam }] };

    const monthFilter = {
      $and: [visibility, { status: "completed" }, { createdAt: { $gte: startOfMonth() } }],
    };

    const [transactions, statusGroups, monthly] = await Promise.all([
      Transaction.find(listFilter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(accountPopulate("sourceAccount"))
        .populate(accountPopulate("destinationAccount"))
        .lean(),
      Transaction.aggregate([
        { $match: baseFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $match: monthFilter },
        {
          $group: {
            _id: null,
            moneyIn: {
              $sum: { $cond: [{ $eq: ["$destinationAccount", account._id] }, "$amount", 0] },
            },
            moneyOut: {
              $sum: { $cond: [{ $eq: ["$sourceAccount", account._id] }, "$amount", 0] },
            },
          },
        },
      ]),
    ]);

    const counts = { all: 0, completed: 0, pending: 0, failed: 0, cancelled: 0, flagged: 0 };
    for (const { _id, count } of statusGroups) {
      if (_id in counts) counts[_id] = count;
      counts.all += count;
    }

    const summary = {
      moneyInThisMonth: round2(monthly[0]?.moneyIn ?? 0),
      moneyOutThisMonth: round2(monthly[0]?.moneyOut ?? 0),
    };

    const total = statusParam === "all" ? counts.all : counts[statusParam];
    const pagination = { page, limit, total, totalPages: Math.ceil(total / limit) };
    const items = transactions.map((txn) => formatTransaction(txn));

    return res.status(200).json({
      success: true,
      data: { transactions: items, pagination, counts, summary },
    });
  } catch (err) {
    console.error("Get transactions error:", err);
    return fail(res, 500, "Unable to fetch transactions");
  }
};

export const getTransactionById = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "Invalid transaction ID");

  try {
    if (!["customer", "staff"].includes(req.user.role)) {
    return fail(res, 403, "Forbidden");
  }
  
  const isCustomer = req.user.role === "customer";
  const txn = await Transaction.findById(id)
      .populate(accountPopulate("sourceAccount"))
      .populate(accountPopulate("destinationAccount"))
      .lean();
    if (!txn) return fail(res, 404, "Transaction not found");

    if (!isCustomer) {
      return res.status(200).json({ success: true, data: formatTransaction(txn) });
    }
    
  // Check all accounts owned by this customer.
  const accounts = await BankAccount.find({
    owner: req.user._id,
  })
    .select("_id")
    .lean();

  const accountIds = new Set(
    accounts.map((account) => account._id.toString())
  );

  const sourceAccountId = idOf(txn.sourceAccount)?.toString();
  const destinationAccountId = idOf(txn.destinationAccount)?.toString();

  const isSender =
    sourceAccountId != null && accountIds.has(sourceAccountId);

  const isRecipient =
    destinationAccountId != null &&
    accountIds.has(destinationAccountId);

  // Incoming money only counts once it has actually arrived (or for cash-ins).
  const recipientCanView =
    txn.transactionType === "cash_in" || txn.status === "completed";

  if (!(isSender || (isRecipient && recipientCanView))) {
    return fail(res, 403, "Forbidden");
  }

    return res.status(200).json({ success: true, data: formatTransaction(txn) });
  } catch (err) {
    console.error("Get transaction by id error:", err);
    return fail(res, 500, "Unable to fetch transaction");
  }
};

export const cancelTransaction = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "Invalid transaction ID");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const txn = await Transaction.findById(id).session(session);
      if (!txn) throw httpError(404, "Transaction not found");

      const sourceAccount = txn.sourceAccount
        ? await BankAccount.findById(txn.sourceAccount).session(session)
        : null;
      if (!sourceAccount || !sourceAccount.owner.equals(req.user._id)) {
        throw httpError(403, "Only the sender can cancel this transaction");
      }
      if (txn.transactionType !== "transfer" || txn.status !== "pending") {
        throw httpError(400, "Only pending transfers can be cancelled");
      }

      // Atomic status flip guards against a double refund if the transfer is resolved concurrently.
      // flagReason is intentionally kept as a record of why it was held.
      const cancelled = await Transaction.findOneAndUpdate(
        { _id: txn._id, status: "pending" },
        { $set: { status: "cancelled" } },
        { new: true, session }
      );
      if (!cancelled) throw httpError(400, "Only pending transfers can be cancelled");

      // Refund even if the sender's account has since been frozen or closed: it's their money.
      sourceAccount.balance = round2(sourceAccount.balance + txn.amount);
      await sourceAccount.save({ session });

      await createNotification({
        recipient: req.user._id,
        type: "transaction",
        message: `Your transfer of ${formatPeso(txn.amount)} was cancelled and refunded.`,
        relatedTransaction: txn._id,
        session,
      });
    });

    const updated = await Transaction.findById(id)
      .populate(accountPopulate("sourceAccount"))
      .populate(accountPopulate("destinationAccount"))
      .lean();

    return res.status(200).json({
      success: true,
      data: formatTransaction(updated),
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Cancel transaction error:", err);
    return fail(res, 500, "Unable to cancel transaction");
  } finally {
    await session.endSession();
  }
};


export const getPendingTransfers = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

  try {
    const filter = {
      transactionType: "transfer",
      status: "pending",
    };

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(accountPopulate("sourceAccount", "name email"))
        .populate(accountPopulate("destinationAccount", "name email"))
        .populate("performedBy", "name email")
        .lean(),

      Transaction.countDocuments(filter),
    ]);

    const items = transactions.map((txn) => formatTransaction(txn));

    return res.status(200).json({
      success: true,
      transactions: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: {
        transactions: items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error("Get pending transfers error:", err);
    return fail(res, 500, "Unable to fetch pending transfers");
  }
};

export const approveTransfer = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid transaction ID");
  }

  const session = await mongoose.startSession();

  try {
    let destinationBalance;

    await session.withTransaction(async () => {
      const txn = await Transaction.findById(id).session(session);

      if (!txn) {
        throw httpError(404, "Transaction not found");
      }

      if (txn.transactionType !== "transfer") {
        throw httpError(400, "Only transfers can be approved");
      }

      if (txn.status !== "pending") {
        throw httpError(400, "Only pending transfers can be approved");
      }

      if (!txn.sourceAccount || !txn.destinationAccount) {
        throw httpError(400, "Transfer is missing account information");
      }

      const destinationAccount = await BankAccount.findById(
        txn.destinationAccount
      ).session(session);

      if (!destinationAccount) {
        throw httpError(404, "Recipient account not found");
      }

      if (destinationAccount.status !== "active") {
        throw httpError(
          403,
          "Recipient account is not active; reject the transfer if it cannot be completed"
        );
      }

      // Claim the pending transaction before crediting the recipient.
      // The conditional update prevents processing an already-resolved transfer.
      const approved = await Transaction.findOneAndUpdate(
        {
          _id: txn._id,
          transactionType: "transfer",
          status: "pending",
        },
        {
          $set: { status: "completed" },
        },
        {
          new: true,
          session,
        }
      );

      if (!approved) {
        throw httpError(400, "Transfer has already been reviewed");
      }

      // The sender was debited when the transfer was created.
      // Approval only credits the recipient.
      destinationAccount.balance = round2(
        destinationAccount.balance + txn.amount
      );

      await destinationAccount.save({ session });

      const sourceAccount = await BankAccount.findById(txn.sourceAccount).session(session);
      const senderUserId = sourceAccount?.owner ?? txn.performedBy;

      await createNotification({
        recipient: senderUserId,
        type: "transaction",
        message: `Your transfer of ${formatPeso(txn.amount)} to ${formatAccountNumber(destinationAccount.accountNumber)} was approved by staff and completed.`,
        relatedTransaction: txn._id,
        session,
      });

      await createNotification({
        recipient: destinationAccount.owner,
        type: "transaction",
        message: `You received ${formatPeso(txn.amount)} from ${formatAccountNumber(sourceAccount?.accountNumber ?? "an external account")}.`,
        relatedTransaction: txn._id,
        session,
      });

      destinationBalance = destinationAccount.balance;
    });

    const updated = await Transaction.findById(id)
      .populate(accountPopulate("sourceAccount", "name email"))
      .populate(accountPopulate("destinationAccount", "name email"))
      .populate("performedBy", "name email")
      .lean();

    const transaction = formatTransaction(updated);

    return res.status(200).json({
      success: true,
      message: "Transfer approved successfully",
      status: updated.status,
      newBalance: destinationBalance,
      transaction,
      data: {
        status: updated.status,
        newBalance: destinationBalance,
        transaction,
      },
    });
  } catch (err) {
    if (err.status) {
      return fail(res, err.status, err.message);
    }

    console.error("Approve transfer error:", err);
    return fail(res, 500, "Unable to approve transfer");
  } finally {
    await session.endSession();
  }
};

export const rejectTransfer = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid transaction ID");
  }

  const session = await mongoose.startSession();

  try {
    let sourceBalance;

    await session.withTransaction(async () => {
      const txn = await Transaction.findById(id).session(session);

      if (!txn) {
        throw httpError(404, "Transaction not found");
      }

      if (txn.transactionType !== "transfer") {
        throw httpError(400, "Only transfers can be rejected");
      }

      if (txn.status !== "pending") {
        throw httpError(400, "Only pending transfers can be rejected");
      }

      if (!txn.sourceAccount) {
        throw httpError(400, "Transfer is missing its source account");
      }

      const sourceAccount = await BankAccount.findById(
        txn.sourceAccount
      ).session(session);

      if (!sourceAccount) {
        throw httpError(404, "Sender account not found");
      }

      // Claim the pending transaction before issuing the refund.
      const rejected = await Transaction.findOneAndUpdate(
        {
          _id: txn._id,
          transactionType: "transfer",
          status: "pending",
        },
        {
          $set: { status: "failed" },
        },
        {
          new: true,
          session,
        }
      );

      if (!rejected) {
        throw httpError(400, "Transfer has already been reviewed");
      }

      // Refund the sender even if their account is now frozen or closed.
      sourceAccount.balance = round2(sourceAccount.balance + txn.amount);

      await sourceAccount.save({ session });

      const senderUserId = sourceAccount?.owner ?? txn.performedBy;
      await createNotification({
        recipient: senderUserId,
        type: "transaction",
        message: `Your transfer of ${formatPeso(txn.amount)} was rejected by staff and refunded to your account.`,
        relatedTransaction: txn._id,
        session,
      });

      sourceBalance = sourceAccount.balance;
    });

    const updated = await Transaction.findById(id)
      .populate(accountPopulate("sourceAccount", "name email"))
      .populate(accountPopulate("destinationAccount", "name email"))
      .populate("performedBy", "name email")
      .lean();

    const transaction = formatTransaction(updated);

    return res.status(200).json({
      success: true,
      message: "Transfer rejected and sender refunded",
      status: updated.status,
      newBalance: sourceBalance,
      transaction,
      data: {
        status: updated.status,
        newBalance: sourceBalance,
        transaction,
      },
    });
  } catch (err) {
    if (err.status) {
      return fail(res, err.status, err.message);
    }

    console.error("Reject transfer error:", err);
    return fail(res, 500, "Unable to reject transfer");
  } finally {
    await session.endSession();
  }
};

const formatStaffTransaction = (txn) => ({
  _id: txn._id,
  referenceNumber: txn.referenceNumber,
  transactionType: txn.transactionType,
  amount: txn.amount,
  sourceAccount: txn.sourceAccount?._id ?? txn.sourceAccount ?? null,
  destinationAccount: txn.destinationAccount?._id ?? txn.destinationAccount ?? null,
  performedBy: txn.performedBy?._id ?? txn.performedBy ?? null,
  status: txn.status,
  flagReason: txn.flagReason ?? null,
  createdAt: txn.createdAt,
  updatedAt: txn.updatedAt,
});

export const getAllStaffTransactions = async (req, res) => {
    try {
    const transactions = await Transaction.find({})
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: transactions.map(formatStaffTransaction),
    });
  } catch (err) {
    console.error("Get all admin transactions error:", err);
    return fail(res, 500, "Unable to fetch admin transactions");
  }
};

export const updateStaffTransactionStatus = async (req, res) => {
    const { id } = req.params;
  const { status, reason } = req.body ?? {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return fail(res, 400, "Invalid transaction ID");
  }

  if (!["completed", "cancelled", "failed", "flagged"].includes(status)) {
    return fail(res, 400, "Status must be one of: completed, cancelled, failed, flagged");
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const txn = await Transaction.findById(id).session(session);
      if (!txn) throw httpError(404, "Transaction not found");

      if (status === "flagged") {
        txn.status = "flagged";
        txn.flagReason =
          typeof reason === "string" && reason.trim()
            ? reason.trim()
            : "Flagged by staff/admin";
        await txn.save({ session });
        return;
      }

      if (txn.transactionType !== "transfer") {
        throw httpError(400, "Only transfers can be reviewed");
      }
      if (txn.status !== "pending") {
        throw httpError(400, "Only pending transfers can be updated");
      }

      if (status === "completed") {
        if (!txn.sourceAccount || !txn.destinationAccount) {
          throw httpError(400, "Transfer is missing account information");
        }

        const destinationAccount = await BankAccount.findById(txn.destinationAccount).session(
          session
        );
        if (!destinationAccount) throw httpError(404, "Recipient account not found");
        if (destinationAccount.status !== "active") {
          throw httpError(
            403,
            "Recipient account is not active; reject the transfer if it cannot be completed"
          );
        }

        const updateFields = { status: "completed" };
        if (typeof reason === "string" && reason.trim()) {
          updateFields.flagReason = reason.trim();
        }

        const approved = await Transaction.findOneAndUpdate(
          { _id: txn._id, transactionType: "transfer", status: "pending" },
          { $set: updateFields },
          { new: true, session }
        );
        if (!approved) throw httpError(400, "Transfer has already been reviewed");

        destinationAccount.balance = round2(destinationAccount.balance + txn.amount);
        await destinationAccount.save({ session });

        const sourceAccount = await BankAccount.findById(txn.sourceAccount).session(session);
        const senderUserId = sourceAccount?.owner ?? txn.performedBy;

        await createNotification({
          recipient: senderUserId,
          type: "transaction",
          message: `Your transfer of ${formatPeso(txn.amount)} to ${formatAccountNumber(destinationAccount.accountNumber)} was approved by staff and completed.`,
          relatedTransaction: txn._id,
          session,
        });

        await createNotification({
          recipient: destinationAccount.owner,
          type: "transaction",
          message: `You received ${formatPeso(txn.amount)} from ${formatAccountNumber(sourceAccount?.accountNumber ?? "an external account")}.`,
          relatedTransaction: txn._id,
          session,
        });
      } else {
        if (!txn.sourceAccount) {
          throw httpError(400, "Transfer is missing its source account");
        }

        const sourceAccount = await BankAccount.findById(txn.sourceAccount).session(session);
        if (!sourceAccount) throw httpError(404, "Sender account not found");

        const updateFields = { status };
        if (typeof reason === "string" && reason.trim()) {
          updateFields.flagReason = reason.trim();
        }

        const rejected = await Transaction.findOneAndUpdate(
          { _id: txn._id, transactionType: "transfer", status: "pending" },
          { $set: updateFields },
          { new: true, session }
        );
        if (!rejected) throw httpError(400, "Transfer has already been reviewed");

        sourceAccount.balance = round2(sourceAccount.balance + txn.amount);
        await sourceAccount.save({ session });

        const senderUserId = sourceAccount?.owner ?? txn.performedBy;
        await createNotification({
          recipient: senderUserId,
          type: "transaction",
          message: `Your transfer of ${formatPeso(txn.amount)} was rejected by staff and refunded to your account.`,
          relatedTransaction: txn._id,
          session,
        });
      }
    });

    const updated = await Transaction.findById(id)
      .populate(accountPopulate("sourceAccount"))
      .populate(accountPopulate("destinationAccount"))
      .lean();

    return res.status(200).json({
      success: true,
      data: formatTransaction(updated),
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Update admin transaction status error:", err);
    return fail(res, 500, "Unable to update transaction status");
  } finally {
    await session.endSession();
  }
};

