import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Transaction from "../src/models/Transaction.js";
import BankAccount from "../src/models/BankAccount.js";
import Notification from "../src/models/Notification.js";
import { transfer } from "../src/controllers/transactionController.js";
import { lookupAccount, getRecentRecipients } from "../src/controllers/accountController.js";

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
// 1. Transaction Schema Note Field
// -------------------------------------------------------------
test("Transaction Schema: note field validation and default", async () => {
  const validTxn = new Transaction({
    referenceNumber: "TXN-20261030-0001",
    transactionType: "transfer",
    amount: 5000,
    sourceAccount: new mongoose.Types.ObjectId(),
    destinationAccount: new mongoose.Types.ObjectId(),
    performedBy: new mongoose.Types.ObjectId(),
    note: "Payment for services rendered",
  });
  await validTxn.validate();
  assert.equal(validTxn.note, "Payment for services rendered");

  // Note defaults to null when omitted
  const defaultNoteTxn = new Transaction({
    referenceNumber: "TXN-20261030-0002",
    transactionType: "cash_in",
    amount: 1000,
    destinationAccount: new mongoose.Types.ObjectId(),
    performedBy: new mongoose.Types.ObjectId(),
  });
  assert.equal(defaultNoteTxn.note, null);

  // Note exceeding 200 characters fails schema validation
  const tooLongNoteTxn = new Transaction({
    referenceNumber: "TXN-20261030-0003",
    transactionType: "transfer",
    amount: 5000,
    sourceAccount: new mongoose.Types.ObjectId(),
    destinationAccount: new mongoose.Types.ObjectId(),
    performedBy: new mongoose.Types.ObjectId(),
    note: "x".repeat(201),
  });
  let caughtErr = null;
  try {
    await tooLongNoteTxn.validate();
  } catch (err) {
    caughtErr = err;
  }
  assert.ok(caughtErr);
  assert.ok(caughtErr.errors.note);
  assert.equal(caughtErr.errors.note.message, "Note cannot exceed 200 characters");
});

// -------------------------------------------------------------
// 2. Transfer Controller: Note Length Validation (400)
// -------------------------------------------------------------
test("transfer: fails with 400 when note exceeds 200 characters", async () => {
  const req = {
    user: { _id: new mongoose.Types.ObjectId() },
    body: {
      amount: 1000,
      recipientAccountNumber: "123456789012",
      note: "x".repeat(201),
    },
  };
  const res = createRes();
  await transfer(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Note cannot exceed 200 characters");
});

// -------------------------------------------------------------
// 3. Transfer Controller: Recipient Standing Invariant (403)
// -------------------------------------------------------------
test("transfer: fails with 403 when recipient user account is deactivated", async () => {
  const senderUserId = new mongoose.Types.ObjectId();
  const recipientUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalFindOne = BankAccount.findOne;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const mockSourceAccount = {
    _id: sourceAccountId,
    owner: senderUserId,
    accountNumber: "111122223333",
    balance: 50000,
    status: "active",
    save: async () => {},
  };

  const mockDestAccount = {
    _id: destAccountId,
    accountNumber: "123456789012",
    status: "active",
    owner: {
      _id: recipientUserId,
      status: "deactivated",
    },
  };

  BankAccount.findOne = (query) => {
    if (query?.owner) {
      return mockQuery(mockSourceAccount);
    }
    return mockQuery(mockDestAccount);
  };

  try {
    const req = {
      user: { _id: senderUserId },
      body: {
        amount: 5000,
        recipientAccountNumber: "123456789012",
        note: "Test transfer",
      },
    };
    const res = createRes();
    await transfer(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Recipient user account is not active and cannot receive money");
  } finally {
    mongoose.startSession = originalStartSession;
    BankAccount.findOne = originalFindOne;
  }
});

test("transfer: fails with 403 when recipient user owner is null", async () => {
  const senderUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalFindOne = BankAccount.findOne;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const mockSourceAccount = {
    _id: sourceAccountId,
    owner: senderUserId,
    accountNumber: "111122223333",
    balance: 50000,
    status: "active",
    save: async () => {},
  };

  const mockDestAccount = {
    _id: destAccountId,
    accountNumber: "123456789012",
    status: "active",
    owner: null,
  };

  BankAccount.findOne = (query) => {
    if (query?.owner) {
      return mockQuery(mockSourceAccount);
    }
    return mockQuery(mockDestAccount);
  };

  try {
    const req = {
      user: { _id: senderUserId },
      body: {
        amount: 5000,
        recipientAccountNumber: "123456789012",
      },
    };
    const res = createRes();
    await transfer(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Recipient user account is not active and cannot receive money");
  } finally {
    mongoose.startSession = originalStartSession;
    BankAccount.findOne = originalFindOne;
  }
});

// -------------------------------------------------------------
// 4. Transfer Controller: Valid Transfer Saves and Returns Note
// -------------------------------------------------------------
test("transfer: valid transfer saves and returns note", async () => {
  const senderUserId = new mongoose.Types.ObjectId();
  const recipientUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();
  const createdTxnId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalFindOne = BankAccount.findOne;
  const originalTxnCreate = Transaction.create;
  const originalTxnFindById = Transaction.findById;
  const originalNotificationCreate = Notification.create;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const mockSourceAccount = {
    _id: sourceAccountId,
    owner: senderUserId,
    accountNumber: "111122223333",
    balance: 50000,
    status: "active",
    save: async () => {},
  };

  const mockDestAccount = {
    _id: destAccountId,
    accountNumber: "123456789012",
    status: "active",
    balance: 1000,
    owner: {
      _id: recipientUserId,
      status: "active",
    },
    save: async () => {},
  };

  BankAccount.findOne = (query) => {
    if (query?.owner) {
      return mockQuery(mockSourceAccount);
    }
    return mockQuery(mockDestAccount);
  };

  let capturedTxnData = null;
  Transaction.create = async (docs) => {
    capturedTxnData = docs[0];
    return [{ _id: createdTxnId, ...docs[0] }];
  };

  Transaction.findById = (id) =>
    mockQuery({
      _id: id,
      referenceNumber: capturedTxnData.referenceNumber,
      transactionType: "transfer",
      amount: 5000,
      sourceAccount: { _id: sourceAccountId, accountNumber: "111122223333" },
      destinationAccount: { _id: destAccountId, accountNumber: "123456789012" },
      performedBy: senderUserId,
      status: "completed",
      flagReason: null,
      note: capturedTxnData.note,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  Notification.create = async () => [];

  try {
    const req = {
      user: { _id: senderUserId },
      body: {
        amount: 5000,
        recipientAccountNumber: "123456789012",
        note: "Rent for November",
      },
    };
    const res = createRes();
    await transfer(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(capturedTxnData.note, "Rent for November");
    assert.equal(res.body.data.note, "Rent for November");
  } finally {
    mongoose.startSession = originalStartSession;
    BankAccount.findOne = originalFindOne;
    Transaction.create = originalTxnCreate;
    Transaction.findById = originalTxnFindById;
    Notification.create = originalNotificationCreate;
  }
});

// -------------------------------------------------------------
// 5. Account Controller: lookupAccount Recipient Standing (403)
// -------------------------------------------------------------
test("lookupAccount: fails with 403 when recipient user is deactivated", async () => {
  const currentUserId = new mongoose.Types.ObjectId();
  const destUserId = new mongoose.Types.ObjectId();
  const originalFindOne = BankAccount.findOne;

  BankAccount.findOne = () => ({
    populate: (path, select) => {
      assert.equal(path, "owner");
      assert.equal(select, "name status");
      return Promise.resolve({
        accountNumber: "123456789012",
        status: "active",
        owner: {
          _id: destUserId,
          name: "Alice Bob",
          status: "deactivated",
        },
      });
    },
  });

  try {
    const req = {
      user: { _id: currentUserId },
      params: { accountNumber: "123456789012" },
    };
    const res = createRes();
    await lookupAccount(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Recipient user account is not active and cannot receive money");
  } finally {
    BankAccount.findOne = originalFindOne;
  }
});

test("lookupAccount: succeeds when recipient user is active", async () => {
  const currentUserId = new mongoose.Types.ObjectId();
  const destUserId = new mongoose.Types.ObjectId();
  const originalFindOne = BankAccount.findOne;

  BankAccount.findOne = () => ({
    populate: (path, select) => {
      assert.equal(path, "owner");
      assert.equal(select, "name status");
      return Promise.resolve({
        accountNumber: "123456789012",
        status: "active",
        owner: {
          _id: destUserId,
          name: "Juan Dela Cruz",
          status: "active",
        },
      });
    },
  });

  try {
    const req = {
      user: { _id: currentUserId },
      params: { accountNumber: "123456789012" },
    };
    const res = createRes();
    await lookupAccount(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.accountNumber, "123456789012");
    assert.equal(res.body.data.displayName, "Juan C.");
  } finally {
    BankAccount.findOne = originalFindOne;
  }
});

// -------------------------------------------------------------
// 6. Account Controller: getRecentRecipients Filters Inactive Owners
// -------------------------------------------------------------
test("getRecentRecipients: filters out recipients whose owner is not active", async () => {
  const currentUserId = new mongoose.Types.ObjectId();
  const userAccount = { _id: new mongoose.Types.ObjectId() };
  const destActiveId = new mongoose.Types.ObjectId();
  const destInactiveId = new mongoose.Types.ObjectId();

  const originalFindOne = BankAccount.findOne;
  const originalAggregate = Transaction.aggregate;
  const originalFind = BankAccount.find;

  BankAccount.findOne = () => mockQuery(userAccount);

  Transaction.aggregate = async () => [
    { _id: destActiveId, lastTransferAt: new Date() },
    { _id: destInactiveId, lastTransferAt: new Date() },
  ];

  BankAccount.find = () => ({
    populate: (path, select) => {
      assert.equal(path, "owner");
      assert.equal(select, "name status");
      return {
        lean: async () => [
          {
            _id: destActiveId,
            accountNumber: "111111111111",
            status: "active",
            owner: { name: "Active User", status: "active" },
          },
          {
            _id: destInactiveId,
            accountNumber: "222222222222",
            status: "active",
            owner: { name: "Inactive User", status: "deactivated" },
          },
        ],
      };
    },
  });

  try {
    const req = {
      user: { _id: currentUserId },
      query: { limit: "5" },
    };
    const res = createRes();
    await getRecentRecipients(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].accountNumber, "111111111111");
    assert.equal(res.body.data[0].displayName, "Active U.");
  } finally {
    BankAccount.findOne = originalFindOne;
    Transaction.aggregate = originalAggregate;
    BankAccount.find = originalFind;
  }
});
