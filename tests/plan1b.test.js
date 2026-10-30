import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Transaction from "../src/models/Transaction.js";
import BankAccount from "../src/models/BankAccount.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import {
  flagTransfer,
  updateStaffTransactionStatus,
  submitTransferVerification,
  approveTransfer,
  rejectTransfer,
  cancelTransaction,
} from "../src/controllers/transactionController.js";

const createRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    set(key, val) {
      this.headers[key] = val;
      return this;
    },
  };
  return res;
};

const mockQuery = (result) => ({
  session: () => Promise.resolve(result),
  populate: () => mockQuery(result),
  lean: () => Promise.resolve(result),
  then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
});

// -------------------------------------------------------------
// 1. Staff Flags Pending Transfer
// -------------------------------------------------------------
test("flagTransfer: flags a pending transfer and requests verification", async () => {
  const txnId = new mongoose.Types.ObjectId();
  const staffUserId = new mongoose.Types.ObjectId();
  const senderUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalFindById = Transaction.findById;
  const originalFindOneAndUpdate = Transaction.findOneAndUpdate;
  const originalBankFindById = BankAccount.findById;
  const originalAuditCreate = AuditLog.create;
  const originalNotificationCreate = Notification.create;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const initialTxn = {
    _id: txnId,
    referenceNumber: "TXN-20261030-0010",
    transactionType: "transfer",
    status: "pending",
    amount: 100000,
    sourceAccount: sourceAccountId,
    destinationAccount: destAccountId,
    performedBy: senderUserId,
  };

  Transaction.findById = (id) => ({
    session: () => Promise.resolve(initialTxn),
  });

  Transaction.findOneAndUpdate = async (filter, update) => {
    assert.equal(filter.status, "pending");
    assert.equal(filter.transactionType, "transfer");
    return {
      ...initialTxn,
      status: "flagged",
      flagReason: update.$set.flagReason,
      verification: update.$set.verification,
    };
  };

  BankAccount.findById = () => ({
    session: () =>
      Promise.resolve({
        _id: sourceAccountId,
        owner: senderUserId,
        accountNumber: "111122223333",
      }),
  });

  AuditLog.create = async () => [];
  Notification.create = async () => [];

  try {
    const req = {
      params: { id: txnId.toString() },
      body: { reason: "Suspicious high-value transfer pattern" },
      user: { _id: staffUserId, role: "staff" },
    };
    const res = createRes();
    await flagTransfer(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, "Transfer flagged for verification");
    assert.equal(res.body.data.status, "flagged");
    assert.equal(res.body.data.flagReason, "Suspicious high-value transfer pattern");
    assert.equal(res.body.data.verification.status, "requested");
    assert.ok(res.body.data.verification.requestedAt);
  } finally {
    mongoose.startSession = originalStartSession;
    Transaction.findById = originalFindById;
    Transaction.findOneAndUpdate = originalFindOneAndUpdate;
    BankAccount.findById = originalBankFindById;
    AuditLog.create = originalAuditCreate;
    Notification.create = originalNotificationCreate;
  }
});

test("flagTransfer: fails if reason is missing or empty", async () => {
  const req = {
    params: { id: new mongoose.Types.ObjectId().toString() },
    body: { reason: "   " },
    user: { _id: new mongoose.Types.ObjectId(), role: "staff" },
  };
  const res = createRes();
  await flagTransfer(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "A reason is required to flag a transfer");
});

// -------------------------------------------------------------
// 2. Premature Approval Block
// -------------------------------------------------------------
test("approveTransfer: blocks approval of flagged transfer waiting for document", async () => {
  const txnId = new mongoose.Types.ObjectId();
  const staffUserId = new mongoose.Types.ObjectId();
  const senderUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalFindById = Transaction.findById;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const flaggedTxn = {
    _id: txnId,
    referenceNumber: "TXN-20261030-0011",
    transactionType: "transfer",
    status: "flagged",
    amount: 50000,
    sourceAccount: sourceAccountId,
    destinationAccount: destAccountId,
    performedBy: senderUserId,
    verification: {
      status: "requested",
      requestedAt: new Date(),
    },
  };

  Transaction.findById = (id) => ({
    session: () => Promise.resolve(flaggedTxn),
  });

  try {
    const req = {
      params: { id: txnId.toString() },
      user: { _id: staffUserId, role: "staff" },
    };
    const res = createRes();
    await approveTransfer(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(
      res.body.message,
      "This transfer is waiting for the sender's document, so it can only be rejected"
    );
  } finally {
    mongoose.startSession = originalStartSession;
    Transaction.findById = originalFindById;
  }
});

// -------------------------------------------------------------
// 3. Customer Document Submission & Duplicate Block
// -------------------------------------------------------------
test("submitTransferVerification: customer submits document and duplicate fails", async () => {
  const txnId = new mongoose.Types.ObjectId();
  const senderUserId = new mongoose.Types.ObjectId();
  const senderAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();

  const originalFindById = Transaction.findById;
  const originalFindOneAndUpdate = Transaction.findOneAndUpdate;
  const originalBankFindOne = BankAccount.findOne;

  const flaggedTxn = {
    _id: txnId,
    referenceNumber: "TXN-20261030-0012",
    transactionType: "transfer",
    status: "flagged",
    amount: 60000,
    sourceAccount: senderAccountId,
    destinationAccount: destAccountId,
    performedBy: senderUserId,
    verification: {
      status: "requested",
      requestedAt: new Date(),
      submittedAt: null,
      documentName: null,
    },
  };

  BankAccount.findOne = () =>
    mockQuery({
      _id: senderAccountId,
      owner: senderUserId,
      status: "active",
    });

  let currentTxn = { ...flaggedTxn };

  Transaction.findById = (id) => ({
    populate: () => ({
      populate: () => ({
        lean: () => Promise.resolve(currentTxn),
      }),
    }),
    then: (resolve) => resolve(currentTxn),
  });

  Transaction.findOneAndUpdate = async (filter, update) => {
    if (filter["verification.status"] !== currentTxn.verification?.status) {
      return null;
    }
    currentTxn = {
      ...currentTxn,
      verification: {
        ...currentTxn.verification,
        status: update.$set["verification.status"],
        submittedAt: update.$set["verification.submittedAt"],
        documentName: update.$set["verification.documentName"],
      },
    };
    return currentTxn;
  };

  try {
    // 1. Successful submission
    const req1 = {
      params: { id: txnId.toString() },
      body: { documentName: "passport_scan.pdf" },
      user: { _id: senderUserId },
    };
    const res1 = createRes();
    await submitTransferVerification(req1, res1);

    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.success, true);
    assert.equal(res1.body.data.verification.status, "submitted");
    assert.equal(res1.body.data.verification.documentName, "passport_scan.pdf");
    assert.ok(res1.body.data.verification.submittedAt);

    // 2. Duplicate submission fails
    const req2 = {
      params: { id: txnId.toString() },
      body: { documentName: "drivers_license.pdf" },
      user: { _id: senderUserId },
    };
    const res2 = createRes();
    await submitTransferVerification(req2, res2);

    assert.equal(res2.statusCode, 400);
    assert.equal(res2.body.success, false);
    assert.equal(res2.body.message, "An ID has already been sent for this transfer");
  } finally {
    Transaction.findById = originalFindById;
    Transaction.findOneAndUpdate = originalFindOneAndUpdate;
    BankAccount.findOne = originalBankFindOne;
  }
});

test("submitTransferVerification: non-sender cannot submit document", async () => {
  const txnId = new mongoose.Types.ObjectId();
  const senderAccountId = new mongoose.Types.ObjectId();
  const nonSenderAccountId = new mongoose.Types.ObjectId();
  const nonSenderUserId = new mongoose.Types.ObjectId();

  const originalFindById = Transaction.findById;
  const originalBankFindOne = BankAccount.findOne;

  Transaction.findById = () =>
    Promise.resolve({
      _id: txnId,
      status: "flagged",
      sourceAccount: senderAccountId,
      verification: { status: "requested" },
    });

  BankAccount.findOne = () =>
    mockQuery({
      _id: nonSenderAccountId,
      owner: nonSenderUserId,
      status: "active",
    });

  try {
    const req = {
      params: { id: txnId.toString() },
      body: { documentName: "id.pdf" },
      user: { _id: nonSenderUserId },
    };
    const res = createRes();
    await submitTransferVerification(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Only the sender can send an ID for this transfer");
  } finally {
    Transaction.findById = originalFindById;
    BankAccount.findOne = originalBankFindOne;
  }
});

// -------------------------------------------------------------
// 4. Staff Approves Transfer After Submission
// -------------------------------------------------------------
test("approveTransfer: staff approves flagged transfer after document submission", async () => {
  const txnId = new mongoose.Types.ObjectId();
  const staffUserId = new mongoose.Types.ObjectId();
  const senderUserId = new mongoose.Types.ObjectId();
  const recipientUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalTxnFindById = Transaction.findById;
  const originalTxnFindOneAndUpdate = Transaction.findOneAndUpdate;
  const originalBankFindById = BankAccount.findById;
  const originalAuditCreate = AuditLog.create;
  const originalNotificationCreate = Notification.create;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const submittedTxn = {
    _id: txnId,
    referenceNumber: "TXN-20261030-0013",
    transactionType: "transfer",
    status: "flagged",
    amount: 50000,
    sourceAccount: sourceAccountId,
    destinationAccount: destAccountId,
    performedBy: senderUserId,
    verification: {
      status: "submitted",
      requestedAt: new Date(),
      submittedAt: new Date(),
      documentName: "valid_id.png",
    },
  };

  const destAccount = {
    _id: destAccountId,
    accountNumber: "222233334444",
    balance: 10000,
    status: "active",
    owner: recipientUserId,
    save: async () => {},
  };

  const sourceAccount = {
    _id: sourceAccountId,
    accountNumber: "111122223333",
    balance: 20000,
    status: "active",
    owner: senderUserId,
  };

  const completedTxn = { ...submittedTxn, status: "completed" };

  Transaction.findById = (id) => ({
    session: () => Promise.resolve(submittedTxn),
    populate: () => ({
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve(completedTxn),
        }),
      }),
    }),
  });

  Transaction.findOneAndUpdate = async (filter) => {
    assert.deepEqual(filter.status, { $in: ["pending", "flagged"] });
    return completedTxn;
  };

  BankAccount.findById = (id) => ({
    session: () => {
      if (id.toString() === destAccountId.toString()) {
        return Promise.resolve(destAccount);
      }
      return Promise.resolve(sourceAccount);
    },
  });

  AuditLog.create = async () => [];
  Notification.create = async () => [];

  try {
    const req = {
      params: { id: txnId.toString() },
      user: { _id: staffUserId, role: "staff" },
    };
    const res = createRes();
    await approveTransfer(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(destAccount.balance, 60000); // 10000 + 50000
    assert.equal(res.body.transaction.status, "completed");
  } finally {
    mongoose.startSession = originalStartSession;
    Transaction.findById = originalTxnFindById;
    Transaction.findOneAndUpdate = originalTxnFindOneAndUpdate;
    BankAccount.findById = originalBankFindById;
    AuditLog.create = originalAuditCreate;
    Notification.create = originalNotificationCreate;
  }
});

// -------------------------------------------------------------
// 5. Staff Rejects Flagged Transfer
// -------------------------------------------------------------
test("rejectTransfer: staff rejects flagged transfer and refunds sender", async () => {
  const txnId = new mongoose.Types.ObjectId();
  const staffUserId = new mongoose.Types.ObjectId();
  const senderUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalTxnFindById = Transaction.findById;
  const originalTxnFindOneAndUpdate = Transaction.findOneAndUpdate;
  const originalBankFindById = BankAccount.findById;
  const originalAuditCreate = AuditLog.create;
  const originalNotificationCreate = Notification.create;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const flaggedTxn = {
    _id: txnId,
    referenceNumber: "TXN-20261030-0014",
    transactionType: "transfer",
    status: "flagged",
    amount: 25000,
    sourceAccount: sourceAccountId,
    destinationAccount: destAccountId,
    performedBy: senderUserId,
    verification: {
      status: "requested",
      requestedAt: new Date(),
      submittedAt: null,
      documentName: null,
    },
  };

  const sourceAccount = {
    _id: sourceAccountId,
    accountNumber: "111122223333",
    balance: 10000,
    status: "active",
    owner: senderUserId,
    save: async () => {},
  };

  const cancelledTxn = {
    ...flaggedTxn,
    status: "cancelled",
    flagReason: "Unverified identity document",
  };

  Transaction.findById = (id) => ({
    session: () => Promise.resolve(flaggedTxn),
    populate: () => ({
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve(cancelledTxn),
        }),
      }),
    }),
  });

  Transaction.findOneAndUpdate = async (filter) => {
    assert.deepEqual(filter.status, { $in: ["pending", "flagged"] });
    return cancelledTxn;
  };

  BankAccount.findById = () => ({
    session: () => Promise.resolve(sourceAccount),
  });

  AuditLog.create = async () => [];
  Notification.create = async () => [];

  try {
    const req = {
      params: { id: txnId.toString() },
      body: { reason: "Unverified identity document" },
      user: { _id: staffUserId, role: "staff" },
    };
    const res = createRes();
    await rejectTransfer(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(sourceAccount.balance, 35000); // 10000 + 25000 refunded
    assert.equal(res.body.status, "cancelled");
    assert.equal(res.body.transaction.status, "cancelled");
    assert.equal(res.body.transaction.verification.status, "requested");
  } finally {
    mongoose.startSession = originalStartSession;
    Transaction.findById = originalTxnFindById;
    Transaction.findOneAndUpdate = originalTxnFindOneAndUpdate;
    BankAccount.findById = originalBankFindById;
    AuditLog.create = originalAuditCreate;
    Notification.create = originalNotificationCreate;
  }
});

// -------------------------------------------------------------
// 6. Customer Cannot Cancel Flagged Transfer
// -------------------------------------------------------------
test("cancelTransaction: customer cannot cancel a flagged transfer", async () => {
  const txnId = new mongoose.Types.ObjectId();
  const senderUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalTxnFindById = Transaction.findById;
  const originalBankFindById = BankAccount.findById;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const flaggedTxn = {
    _id: txnId,
    transactionType: "transfer",
    status: "flagged",
    sourceAccount: sourceAccountId,
  };

  Transaction.findById = () => ({
    session: () => Promise.resolve(flaggedTxn),
  });

  BankAccount.findById = () => ({
    session: () =>
      Promise.resolve({
        _id: sourceAccountId,
        owner: { equals: (id) => id.toString() === senderUserId.toString() },
      }),
  });

  try {
    const req = {
      params: { id: txnId.toString() },
      user: { _id: senderUserId },
    };
    const res = createRes();
    await cancelTransaction(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Only pending transfers can be cancelled");
  } finally {
    mongoose.startSession = originalStartSession;
    Transaction.findById = originalTxnFindById;
    BankAccount.findById = originalBankFindById;
  }
});

// -------------------------------------------------------------
// 7. Status Dispatcher updateStaffTransactionStatus
// -------------------------------------------------------------
test("updateStaffTransactionStatus: rejects unsupported status transition", async () => {
  const req = {
    params: { id: new mongoose.Types.ObjectId().toString() },
    body: { status: "archived" },
    user: { _id: new mongoose.Types.ObjectId(), role: "staff" },
  };
  const res = createRes();
  await updateStaffTransactionStatus(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Status must be one of: completed, cancelled, flagged");
});
