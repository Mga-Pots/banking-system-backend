import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import BankAccount from "../src/models/BankAccount.js";
import Transaction from "../src/models/Transaction.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import User from "../src/models/User.js";
import { accountEnding } from "../src/utils/notification.js";
import { publicUser } from "../src/utils/user.js";
import { freezeAccount, unfreezeAccount } from "../src/controllers/accountController.js";
import { transfer, approveTransfer } from "../src/controllers/transactionController.js";
import { updateNotificationPreferences } from "../src/controllers/userController.js";

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
// 1. accountEnding Helper Unit Tests
// -------------------------------------------------------------
test("accountEnding: formats account number with last 4 digits only", () => {
  assert.equal(accountEnding("001285165389"), "account ending 5389");
  assert.equal(accountEnding("0012 8516 5389"), "account ending 5389");
  assert.equal(accountEnding("987654321098"), "account ending 1098");
});

test("accountEnding: handles short, empty, null, and non-numeric inputs safely", () => {
  assert.equal(accountEnding("123"), "an external account");
  assert.equal(accountEnding(""), "an external account");
  assert.equal(accountEnding(null), "an external account");
  assert.equal(accountEnding(undefined), "an external account");
  assert.equal(accountEnding("an external account"), "an external account");
});

// -------------------------------------------------------------
// 2. publicUser Serializer Hygiene Unit Tests
// -------------------------------------------------------------
test("publicUser: omits contactNumber key when null, empty string, or undefined", () => {
  const userWithoutContact = {
    _id: new mongoose.Types.ObjectId(),
    name: "Juan Dela Cruz",
    email: "juan@example.com",
    contactNumber: undefined,
    role: "customer",
    status: "active",
    isVerified: true,
    notificationPreferences: { email: true, sms: false },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const formatted1 = publicUser(userWithoutContact);
  assert.equal("contactNumber" in formatted1, false);

  const userWithEmptyContact = {
    ...userWithoutContact,
    contactNumber: "",
  };
  const formatted2 = publicUser(userWithEmptyContact);
  assert.equal("contactNumber" in formatted2, false);

  const userWithNullContact = {
    ...userWithoutContact,
    contactNumber: null,
  };
  const formatted3 = publicUser(userWithNullContact);
  assert.equal("contactNumber" in formatted3, false);
});

test("publicUser: includes contactNumber when present and valid", () => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    name: "Juan Dela Cruz",
    email: "juan@example.com",
    contactNumber: "+639171234567",
    role: "customer",
    status: "active",
    isVerified: false,
  };

  const formatted = publicUser(user);
  assert.equal(formatted.contactNumber, "+639171234567");
  assert.strictEqual(formatted.isVerified, false);
  assert.deepEqual(formatted.notificationPreferences, { email: true, sms: false });
});

test("publicUser: returns null when passed null or undefined", () => {
  assert.equal(publicUser(null), null);
  assert.equal(publicUser(undefined), null);
});

// -------------------------------------------------------------
// 3. Account Freeze & Unfreeze Notification Masking Tests
// -------------------------------------------------------------
test("freezeAccount: notification masks account number as 'account ending XXXX'", async () => {
  const accountId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  const fullAccountNumber = "001285165389";

  const originalFindById = BankAccount.findById;
  const originalAuditCreate = AuditLog.create;
  const originalNotificationCreate = Notification.create;

  const mockAccount = {
    _id: accountId,
    accountNumber: fullAccountNumber,
    owner: ownerId,
    status: "active",
    save: async () => {},
  };

  BankAccount.findById = () => Promise.resolve(mockAccount);
  AuditLog.create = async () => [];

  let capturedNotification = null;
  Notification.create = async (doc) => {
    capturedNotification = doc;
    return doc;
  };

  try {
    const req = {
      params: { id: accountId.toString() },
      body: { reason: "Suspicious activity detected" },
      user: { _id: new mongoose.Types.ObjectId(), role: "staff" },
    };
    const res = createRes();
    await freezeAccount(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(capturedNotification);
    assert.equal(
      capturedNotification.message,
      "Your account ending 5389 has been frozen. Reason: Suspicious activity detected. Please contact staff for assistance."
    );
    // Crucial privacy invariant: full 12 digits must never appear
    assert.equal(capturedNotification.message.includes(fullAccountNumber), false);
  } finally {
    BankAccount.findById = originalFindById;
    AuditLog.create = originalAuditCreate;
    Notification.create = originalNotificationCreate;
  }
});

test("unfreezeAccount: notification masks account number as 'account ending XXXX'", async () => {
  const accountId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  const fullAccountNumber = "001285165389";

  const originalFindById = BankAccount.findById;
  const originalAuditCreate = AuditLog.create;
  const originalNotificationCreate = Notification.create;

  const mockAccount = {
    _id: accountId,
    accountNumber: fullAccountNumber,
    owner: ownerId,
    status: "frozen",
    save: async () => {},
  };

  BankAccount.findById = () => Promise.resolve(mockAccount);
  AuditLog.create = async () => [];

  let capturedNotification = null;
  Notification.create = async (doc) => {
    capturedNotification = doc;
    return doc;
  };

  try {
    const req = {
      params: { id: accountId.toString() },
      user: { _id: new mongoose.Types.ObjectId(), role: "staff" },
    };
    const res = createRes();
    await unfreezeAccount(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(capturedNotification);
    assert.equal(
      capturedNotification.message,
      "Your account ending 5389 has been reactivated. You can now cash in and transfer funds."
    );
    assert.equal(capturedNotification.message.includes(fullAccountNumber), false);
  } finally {
    BankAccount.findById = originalFindById;
    AuditLog.create = originalAuditCreate;
    Notification.create = originalNotificationCreate;
  }
});

// -------------------------------------------------------------
// 4. Transfer Notifications Masking Tests
// -------------------------------------------------------------
test("transfer: completed transfer masks recipient and source account numbers", async () => {
  const senderUserId = new mongoose.Types.ObjectId();
  const recipientUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();
  const createdTxnId = new mongoose.Types.ObjectId();

  const sourceNumber = "001211112222";
  const destNumber = "001299998888";

  const originalStartSession = mongoose.startSession;
  const originalBankFindOne = BankAccount.findOne;
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
    accountNumber: sourceNumber,
    balance: 50000,
    status: "active",
    save: async () => {},
  };

  const mockDestAccount = {
    _id: destAccountId,
    accountNumber: destNumber,
    balance: 10000,
    status: "active",
    owner: { _id: recipientUserId, status: "active" },
    save: async () => {},
  };

  BankAccount.findOne = (query) => {
    if (query?.owner) return mockQuery(mockSourceAccount);
    return mockQuery(mockDestAccount);
  };

  let capturedTxn = null;
  Transaction.create = async (docs) => {
    capturedTxn = docs[0];
    return [{ _id: createdTxnId, ...docs[0] }];
  };

  Transaction.findById = (id) =>
    mockQuery({
      _id: id,
      referenceNumber: capturedTxn.referenceNumber,
      transactionType: "transfer",
      amount: 5000,
      sourceAccount: { _id: sourceAccountId, accountNumber: sourceNumber },
      destinationAccount: { _id: destAccountId, accountNumber: destNumber },
      performedBy: senderUserId,
      status: "completed",
      flagReason: null,
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  const capturedNotifications = [];
  Notification.create = async (docs) => {
    if (Array.isArray(docs)) capturedNotifications.push(...docs);
    else capturedNotifications.push(docs);
    return docs;
  };

  try {
    const req = {
      user: { _id: senderUserId },
      body: {
        amount: 5000,
        recipientAccountNumber: destNumber,
      },
    };
    const res = createRes();
    await transfer(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(capturedNotifications.length, 2);

    const senderNotice = capturedNotifications[0];
    const recipientNotice = capturedNotifications[1];

    assert.equal(
      senderNotice.message,
      "Your transfer of ₱50.00 to account ending 8888 was completed."
    );
    assert.equal(senderNotice.message.includes(destNumber), false);

    assert.equal(
      recipientNotice.message,
      "You received ₱50.00 from account ending 2222."
    );
    assert.equal(recipientNotice.message.includes(sourceNumber), false);
  } finally {
    mongoose.startSession = originalStartSession;
    BankAccount.findOne = originalBankFindOne;
    Transaction.create = originalTxnCreate;
    Transaction.findById = originalTxnFindById;
    Notification.create = originalNotificationCreate;
  }
});

test("transfer: held for review transfer masks destination account number", async () => {
  const senderUserId = new mongoose.Types.ObjectId();
  const recipientUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();
  const createdTxnId = new mongoose.Types.ObjectId();

  const sourceNumber = "001211112222";
  const destNumber = "001299998888";

  const originalStartSession = mongoose.startSession;
  const originalBankFindOne = BankAccount.findOne;
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
    accountNumber: sourceNumber,
    balance: 50000000,
    status: "active",
    save: async () => {},
  };

  const mockDestAccount = {
    _id: destAccountId,
    accountNumber: destNumber,
    balance: 10000,
    status: "active",
    owner: { _id: recipientUserId, status: "active" },
    save: async () => {},
  };

  BankAccount.findOne = (query) => {
    if (query?.owner) return mockQuery(mockSourceAccount);
    return mockQuery(mockDestAccount);
  };

  let capturedTxn = null;
  Transaction.create = async (docs) => {
    capturedTxn = docs[0];
    return [{ _id: createdTxnId, ...docs[0] }];
  };

  Transaction.findById = (id) =>
    mockQuery({
      _id: id,
      referenceNumber: capturedTxn.referenceNumber,
      transactionType: "transfer",
      amount: 5000000,
      sourceAccount: { _id: sourceAccountId, accountNumber: sourceNumber },
      destinationAccount: { _id: destAccountId, accountNumber: destNumber },
      performedBy: senderUserId,
      status: "pending",
      flagReason: "Held for staff review",
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  const capturedNotifications = [];
  Notification.create = async (docs) => {
    if (Array.isArray(docs)) capturedNotifications.push(...docs);
    else capturedNotifications.push(docs);
    return docs;
  };

  try {
    const req = {
      user: { _id: senderUserId },
      body: {
        amount: 5000000, // ₱50,000 held for review
        recipientAccountNumber: destNumber,
      },
    };
    const res = createRes();
    await transfer(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(capturedNotifications.length, 1);

    const senderNotice = capturedNotifications[0];
    assert.equal(
      senderNotice.message,
      "Your transfer of ₱50,000.00 to account ending 8888 is being held for review."
    );
    assert.equal(senderNotice.message.includes(destNumber), false);
  } finally {
    mongoose.startSession = originalStartSession;
    BankAccount.findOne = originalBankFindOne;
    Transaction.create = originalTxnCreate;
    Transaction.findById = originalTxnFindById;
    Notification.create = originalNotificationCreate;
  }
});

// -------------------------------------------------------------
// 5. approveTransfer Notifications & External Fallback
// -------------------------------------------------------------
test("approveTransfer: masks accounts and safely falls back to 'an external account'", async () => {
  const txnId = new mongoose.Types.ObjectId();
  const staffUserId = new mongoose.Types.ObjectId();
  const senderUserId = new mongoose.Types.ObjectId();
  const recipientUserId = new mongoose.Types.ObjectId();
  const sourceAccountId = new mongoose.Types.ObjectId();
  const destAccountId = new mongoose.Types.ObjectId();
  const destNumber = "001299998888";

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

  const pendingTxn = {
    _id: txnId,
    referenceNumber: "TXN-20261030-5555",
    transactionType: "transfer",
    status: "pending",
    amount: 1000000, // ₱10,000
    sourceAccount: sourceAccountId,
    destinationAccount: destAccountId,
    performedBy: senderUserId,
  };

  const destAccount = {
    _id: destAccountId,
    accountNumber: destNumber,
    balance: 50000,
    status: "active",
    owner: recipientUserId,
    save: async () => {},
  };

  Transaction.findById = () => ({
    session: () => Promise.resolve(pendingTxn),
    populate: () => ({
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve({ ...pendingTxn, status: "completed" }),
        }),
      }),
    }),
  });

  Transaction.findOneAndUpdate = async () => ({ ...pendingTxn, status: "completed" });
  BankAccount.findById = (id) => ({
    session: () => {
      if (id.toString() === destAccountId.toString()) {
        return Promise.resolve(destAccount);
      }
      // Source account not found in DB simulates external account
      return Promise.resolve(null);
    },
  });

  AuditLog.create = async () => [];

  const capturedNotifications = [];
  Notification.create = async (docs) => {
    if (Array.isArray(docs)) capturedNotifications.push(...docs);
    else capturedNotifications.push(docs);
    return docs;
  };

  try {
    const req = {
      params: { id: txnId.toString() },
      user: { _id: staffUserId, role: "staff" },
    };
    const res = createRes();
    await approveTransfer(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(capturedNotifications.length, 2);

    const senderNotice = capturedNotifications[0];
    const recipientNotice = capturedNotifications[1];

    assert.equal(
      senderNotice.message,
      "Your transfer of ₱10,000.00 to account ending 8888 was approved by staff and completed."
    );
    assert.equal(senderNotice.message.includes(destNumber), false);

    // External fallback test: recipient notice outputs "from an external account."
    assert.equal(
      recipientNotice.message,
      "You received ₱10,000.00 from an external account."
    );
    assert.equal(recipientNotice.message.includes("undefined"), false);
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
// 6. User Controller: updateNotificationPreferences Adoption
// -------------------------------------------------------------
test("updateNotificationPreferences: returns publicUser omitting unset contactNumber", async () => {
  const userId = new mongoose.Types.ObjectId();
  const originalUserFindById = User.findById;

  const mockUser = {
    _id: userId,
    name: "Maria Santos",
    email: "maria@example.com",
    contactNumber: undefined,
    role: "customer",
    status: "active",
    isVerified: true,
    notificationPreferences: { email: true, sms: false },
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async () => {},
  };

  User.findById = () => Promise.resolve(mockUser);

  try {
    const req = {
      user: { _id: userId },
      body: { email: true, sms: true },
    };
    const res = createRes();
    await updateNotificationPreferences(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal("contactNumber" in res.body.data, false);
    assert.equal(res.body.data.notificationPreferences.sms, true);
    assert.equal(res.body.data.name, "Maria Santos");
  } finally {
    User.findById = originalUserFindById;
  }
});
