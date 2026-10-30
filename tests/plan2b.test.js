import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../src/models/User.js";
import BankAccount from "../src/models/BankAccount.js";
import Transaction from "../src/models/Transaction.js";
import Notification from "../src/models/Notification.js";
import { protect } from "../src/middleware/auth.js";
import {
  updateMe,
  changePassword,
  deactivateMe,
} from "../src/controllers/userController.js";
import { getStaffCustomers, getStaffCustomerById } from "../src/controllers/staffController.js";
import { getAdminUsers } from "../src/controllers/adminController.js";

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

// -------------------------------------------------------------
// 1. Profile Update: Clearing Mobile Number & Index Collision Safety
// -------------------------------------------------------------
test("updateMe: clearing contactNumber with empty string completely unsets the key", async () => {
  const userId = new mongoose.Types.ObjectId();
  const originalUserFindById = User.findById;
  const originalUserExists = User.exists;

  const mockUser = new User({
    _id: userId,
    name: "Juan Dela Cruz",
    email: "juan@example.com",
    contactNumber: "09171234567",
    passwordHash: "hash",
    role: "customer",
    status: "active",
  });
  mockUser.save = async () => {};

  User.exists = async () => false;
  User.findById = () => Promise.resolve(mockUser);

  try {
    const req = {
      user: { _id: userId },
      body: {
        name: "Juan Dela Cruz",
        email: "juan@example.com",
        contactNumber: "", // Empty string means clear
      },
    };
    const res = createRes();
    await updateMe(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(mockUser.contactNumber, undefined);
    assert.equal("contactNumber" in res.body.data, false);
  } finally {
    User.findById = originalUserFindById;
    User.exists = originalUserExists;
  }
});

test("updateMe: multiple users clearing contact number causes no collision", async () => {
  const user1Id = new mongoose.Types.ObjectId();
  const user2Id = new mongoose.Types.ObjectId();
  const originalUserFindById = User.findById;
  const originalUserExists = User.exists;

  const user1 = new User({
    _id: user1Id,
    name: "User One",
    email: "user1@example.com",
    contactNumber: "09171111111",
    passwordHash: "hash",
  });
  user1.save = async () => {};

  const user2 = new User({
    _id: user2Id,
    name: "User Two",
    email: "user2@example.com",
    contactNumber: "09172222222",
    passwordHash: "hash",
  });
  user2.save = async () => {};

  User.exists = async () => false;

  try {
    // User 1 clears contact
    User.findById = () => Promise.resolve(user1);
    const req1 = {
      user: { _id: user1Id },
      body: { name: "User One", email: "user1@example.com", contactNumber: "   " },
    };
    const res1 = createRes();
    await updateMe(req1, res1);
    assert.equal(res1.statusCode, 200);
    assert.equal(user1.contactNumber, undefined);
    assert.equal("contactNumber" in res1.body.data, false);

    // User 2 clears contact
    User.findById = () => Promise.resolve(user2);
    const req2 = {
      user: { _id: user2Id },
      body: { name: "User Two", email: "user2@example.com", contactNumber: "" },
    };
    const res2 = createRes();
    await updateMe(req2, res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(user2.contactNumber, undefined);
    assert.equal("contactNumber" in res2.body.data, false);
  } finally {
    User.findById = originalUserFindById;
    User.exists = originalUserExists;
  }
});

// -------------------------------------------------------------
// 2. Profile Update: Validation and Duplicate Detection
// -------------------------------------------------------------
test("updateMe: rejects invalid email format or empty name", async () => {
  const userId = new mongoose.Types.ObjectId();

  // Empty name
  const req1 = {
    user: { _id: userId },
    body: { name: "", email: "juan@example.com" },
  };
  const res1 = createRes();
  await updateMe(req1, res1);
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.body.message, "Name and email are required");

  // Invalid email
  const req2 = {
    user: { _id: userId },
    body: { name: "Juan", email: "not-an-email" },
  };
  const res2 = createRes();
  await updateMe(req2, res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.message, "Enter a valid email address");

  // Invalid Philippine mobile number
  const req3 = {
    user: { _id: userId },
    body: { name: "Juan", email: "juan@example.com", contactNumber: "12345" },
  };
  const res3 = createRes();
  await updateMe(req3, res3);
  assert.equal(res3.statusCode, 400);
  assert.equal(res3.body.message, "Enter a valid Philippine mobile number");

  // Non-string contactNumber (e.g. number or boolean)
  const req4 = {
    user: { _id: userId },
    body: { name: "Juan", email: "juan@example.com", contactNumber: 12345 },
  };
  const res4 = createRes();
  await updateMe(req4, res4);
  assert.equal(res4.statusCode, 400);
  assert.equal(res4.body.message, "Enter a valid Philippine mobile number");
});

test("updateMe: normalizes +63 mobile number to 09 format", async () => {
  const userId = new mongoose.Types.ObjectId();
  const originalUserFindById = User.findById;
  const originalUserExists = User.exists;

  const mockUser = new User({
    _id: userId,
    name: "Juan",
    email: "juan@example.com",
    passwordHash: "hash",
  });
  mockUser.save = async () => {};

  User.exists = async () => false;
  User.findById = () => Promise.resolve(mockUser);

  try {
    const req = {
      user: { _id: userId },
      body: {
        name: "Juan",
        email: "juan@example.com",
        contactNumber: "+639171234567",
      },
    };
    const res = createRes();
    await updateMe(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(mockUser.contactNumber, "09171234567");
    assert.equal(res.body.data.contactNumber, "09171234567");
  } finally {
    User.findById = originalUserFindById;
    User.exists = originalUserExists;
  }
});

test("updateMe: rejects taken email or taken contact number with 409", async () => {
  const userId = new mongoose.Types.ObjectId();
  const originalUserExists = User.exists;

  // Taken email
  User.exists = async (filter) => {
    if (filter.email) return true;
    return false;
  };

  const req1 = {
    user: { _id: userId },
    body: { name: "Juan", email: "taken@example.com" },
  };
  const res1 = createRes();
  await updateMe(req1, res1);
  assert.equal(res1.statusCode, 409);
  assert.equal(res1.body.message, "Email or contact number already used");

  // Taken contact
  User.exists = async (filter) => {
    if (filter.contactNumber) return true;
    return false;
  };

  const req2 = {
    user: { _id: userId },
    body: {
      name: "Juan",
      email: "available@example.com",
      contactNumber: "09179999999",
    },
  };
  const res2 = createRes();
  await updateMe(req2, res2);
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.body.message, "Email or contact number already used");

  User.exists = originalUserExists;
});

// -------------------------------------------------------------
// 3. Password Change: Validation, Reuse Check & Notification
// -------------------------------------------------------------
test("changePassword: rejects invalid inputs, incorrect current, and password reuse", async () => {
  const userId = new mongoose.Types.ObjectId();
  const originalUserFindById = User.findById;

  const currentPass = "Password123!";
  const currentHash = await bcrypt.hash(currentPass, 10);

  const mockUser = {
    _id: userId,
    passwordHash: currentHash,
    save: async () => {},
  };

  User.findById = () => Promise.resolve(mockUser);

  try {
    // Missing fields
    const req1 = { user: { _id: userId }, body: { currentPassword: "" } };
    const res1 = createRes();
    await changePassword(req1, res1);
    assert.equal(res1.statusCode, 400);
    assert.equal(res1.body.message, "Current and new password are required");

    // New password too short
    const req2 = {
      user: { _id: userId },
      body: { currentPassword: currentPass, newPassword: "short" },
    };
    const res2 = createRes();
    await changePassword(req2, res2);
    assert.equal(res2.statusCode, 400);
    assert.equal(res2.body.message, "Password must be at least 8 characters");

    // Incorrect current password
    const req3 = {
      user: { _id: userId },
      body: { currentPassword: "WrongPassword!", newPassword: "NewPassword123!" },
    };
    const res3 = createRes();
    await changePassword(req3, res3);
    assert.equal(res3.statusCode, 400);
    assert.equal(res3.body.message, "Incorrect password");

    // Password reuse
    const req4 = {
      user: { _id: userId },
      body: { currentPassword: currentPass, newPassword: currentPass },
    };
    const res4 = createRes();
    await changePassword(req4, res4);
    assert.equal(res4.statusCode, 400);
    assert.equal(res4.body.message, "Choose a password you haven't used here before");
  } finally {
    User.findById = originalUserFindById;
  }
});

test("changePassword: updates password and dispatches security notification", async () => {
  const userId = new mongoose.Types.ObjectId();
  const originalUserFindById = User.findById;
  const originalNotificationCreate = Notification.create;

  const currentPass = "OldPassword123!";
  const currentHash = await bcrypt.hash(currentPass, 10);

  const mockUser = {
    _id: userId,
    passwordHash: currentHash,
    save: async () => {},
  };

  User.findById = () => Promise.resolve(mockUser);

  let capturedNotification = null;
  Notification.create = async (doc) => {
    capturedNotification = Array.isArray(doc) ? doc[0] : doc;
    return doc;
  };

  try {
    const req = {
      user: { _id: userId },
      body: { currentPassword: currentPass, newPassword: "BrandNewPassword123!" },
    };
    const res = createRes();
    await changePassword(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, "Password updated");

    // Verify password hash updated
    const match = await bcrypt.compare("BrandNewPassword123!", mockUser.passwordHash);
    assert.strictEqual(match, true);

    // Verify security notification
    assert.ok(capturedNotification);
    assert.equal(capturedNotification.type, "security");
    assert.equal(
      capturedNotification.message,
      "Your password was changed. If this wasn't you, contact the bank."
    );
  } finally {
    User.findById = originalUserFindById;
    Notification.create = originalNotificationCreate;
  }
});

// -------------------------------------------------------------
// 4. Customer Self-Deactivation: Invariants & Blocking
// -------------------------------------------------------------
test("deactivateMe: blocks customer with remaining balance > 0", async () => {
  const userId = new mongoose.Types.ObjectId();
  const originalStartSession = mongoose.startSession;
  const originalBankFindOne = BankAccount.findOne;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  BankAccount.findOne = () => ({
    session: () =>
      Promise.resolve({
        owner: userId,
        balance: 10000, // ₱100.00 remaining
      }),
  });

  try {
    const req = { user: { _id: userId } };
    const res = createRes();
    await deactivateMe(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(
      res.body.message,
      "Move your remaining balance out before deactivating your account"
    );
  } finally {
    mongoose.startSession = originalStartSession;
    BankAccount.findOne = originalBankFindOne;
  }
});

test("deactivateMe: blocks customer with pending or flagged transfers", async () => {
  const userId = new mongoose.Types.ObjectId();
  const accountId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalBankFindOne = BankAccount.findOne;
  const originalTxnExists = Transaction.exists;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const mockAccount = {
    _id: accountId,
    owner: userId,
    balance: 0,
    status: "active",
    save: async () => {},
  };

  BankAccount.findOne = () => ({
    session: () => Promise.resolve(mockAccount),
  });

  Transaction.exists = () => ({
    session: () => Promise.resolve(true), // In-flight transfer exists
  });

  try {
    const req = { user: { _id: userId } };
    const res = createRes();
    await deactivateMe(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(
      res.body.message,
      "You can't deactivate while a transfer is still being processed"
    );
  } finally {
    mongoose.startSession = originalStartSession;
    BankAccount.findOne = originalBankFindOne;
    Transaction.exists = originalTxnExists;
  }
});

test("deactivateMe: successful deactivation sets status to deactivated and dispatches notification", async () => {
  const userId = new mongoose.Types.ObjectId();
  const accountId = new mongoose.Types.ObjectId();

  const originalStartSession = mongoose.startSession;
  const originalBankFindOne = BankAccount.findOne;
  const originalTxnExists = Transaction.exists;
  const originalUserFindById = User.findById;
  const originalNotificationCreate = Notification.create;

  const mockSession = {
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => mockSession;

  const mockAccount = {
    _id: accountId,
    owner: userId,
    balance: 0,
    status: "active",
    save: async () => {},
  };

  BankAccount.findOne = () => ({
    session: () => Promise.resolve(mockAccount),
  });

  Transaction.exists = () => ({
    session: () => Promise.resolve(false), // No pending transfers
  });

  const mockUser = {
    _id: userId,
    name: "Juan Dela Cruz",
    email: "juan@example.com",
    role: "customer",
    status: "active",
    isVerified: true,
    save: async () => {},
  };

  User.findById = () => ({
    session: () => Promise.resolve(mockUser),
  });

  let capturedNotification = null;
  Notification.create = async (doc) => {
    capturedNotification = Array.isArray(doc) ? doc[0] : doc;
    return doc;
  };

  try {
    const req = { user: { _id: userId } };
    const res = createRes();
    await deactivateMe(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(mockUser.status, "deactivated");
    assert.equal(mockAccount.status, "frozen");
    assert.equal(res.body.data.status, "deactivated");

    assert.ok(capturedNotification);
    assert.equal(capturedNotification.type, "security");
    assert.equal(
      capturedNotification.message,
      "Your account was deactivated. Contact staff if you wish to reactivate."
    );
  } finally {
    mongoose.startSession = originalStartSession;
    BankAccount.findOne = originalBankFindOne;
    Transaction.exists = originalTxnExists;
    User.findById = originalUserFindById;
    Notification.create = originalNotificationCreate;
  }
});

test("protect: deactivated user is blocked on subsequent requests with 401", async () => {
  const userId = new mongoose.Types.ObjectId();
  const secret = process.env.JWT_SECRET || "test-jwt-secret";
  process.env.JWT_SECRET = secret;

  const token = jwt.sign({ id: userId.toString() }, secret);

  const originalUserFindById = User.findById;
  User.findById = () => ({
    select: () => Promise.resolve({ _id: userId, status: "deactivated" }),
  });

  try {
    const req = {
      headers: { authorization: `Bearer ${token}` },
    };
    const res = createRes();
    let nextCalled = false;
    await protect(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Account unavailable");
  } finally {
    User.findById = originalUserFindById;
  }
});

test("staffController: publicUser omits contactNumber when unset in list and by-ID", async () => {
  const originalFind = User.find;
  const originalFindById = User.findById;
  const customerId = new mongoose.Types.ObjectId();

  const mockCustomer = {
    _id: customerId,
    name: "Customer Without Phone",
    email: "nophone@example.com",
    contactNumber: undefined,
    role: "customer",
    status: "active",
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  User.find = () => ({
    select: () => ({
      sort: () => ({
        lean: () => Promise.resolve([mockCustomer]),
      }),
    }),
  });

  User.findById = () => ({
    select: () => ({
      lean: () => Promise.resolve(mockCustomer),
    }),
  });

  try {
    // List
    const res1 = createRes();
    await getStaffCustomers({}, res1);
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.data.length, 1);
    assert.equal("contactNumber" in res1.body.data[0], false);

    // By ID
    const res2 = createRes();
    await getStaffCustomerById({ params: { id: customerId.toString() } }, res2);
    assert.equal(res2.statusCode, 200);
    assert.equal("contactNumber" in res2.body.data, false);
  } finally {
    User.find = originalFind;
    User.findById = originalFindById;
  }
});

test("adminController: publicUser omits contactNumber when unset in user list", async () => {
  const originalFind = User.find;
  const originalCount = User.countDocuments;

  const mockUser = {
    _id: new mongoose.Types.ObjectId(),
    name: "Staff Without Phone",
    email: "staffnophone@example.com",
    contactNumber: undefined,
    role: "staff",
    status: "active",
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  User.find = () => ({
    select: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: () => Promise.resolve([mockUser]),
          }),
        }),
      }),
    }),
  });

  User.countDocuments = () => Promise.resolve(1);

  try {
    const res = createRes();
    await getAdminUsers({ query: { page: 1, limit: 10 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal("contactNumber" in res.body.data[0], false);
  } finally {
    User.find = originalFind;
    User.countDocuments = originalCount;
  }
});
