import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import BankAccount from "../src/models/BankAccount.js";
import Transaction from "../src/models/Transaction.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import { register, login } from "../src/controllers/authController.js";
import { updateMe } from "../src/controllers/userController.js";
import { updateCustomerStatus, verifyCustomer } from "../src/controllers/staffController.js";
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

const stub = async (target, names, replacements, fn) => {
  const originals = names.map((n) => target[n]);
  names.forEach((n, i) => {
    target[n] = replacements[i];
  });
  try {
    await fn();
  } finally {
    names.forEach((n, i) => {
      target[n] = originals[i];
    });
  }
};

test("login uses isClosed $ne true", async () => {
  let filter;
  await stub(
    User,
    ["findOne"],
    [
      async (f) => {
        filter = f;
        return null;
      },
    ],
    async () => {
      const res = createRes();
      await login({ body: { email: "A@X.com ", password: "Password123" } }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.message, "Invalid email or password");
      assert.deepEqual(filter, { email: "a@x.com", isClosed: { $ne: true } });
    }
  );
});

test("register email check uses isClosed $ne true", async () => {
  const filters = [];
  await stub(
    User,
    ["exists"],
    [
      async (f) => {
        filters.push(f);
        return { _id: 1 };
      },
    ],
    async () => {
      const res = createRes();
      await register(
        { body: { name: "Ana", email: "ana@x.com", password: "Password123" } },
        res
      );
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.message, "Email or contact number already used");
      assert.deepEqual(filters[0], { email: "ana@x.com", isClosed: { $ne: true } });
    }
  );
});

test("register contact check uses isClosed $ne true", async () => {
  const filters = [];
  await stub(
    User,
    ["exists"],
    [
      async (f) => {
        filters.push(f);
        return filters.length === 1 ? null : { _id: 1 };
      },
    ],
    async () => {
      const res = createRes();
      await register(
        {
          body: {
            name: "Ana",
            email: "ana@x.com",
            password: "Password123",
            contactNumber: "09171234567",
          },
        },
        res
      );
      assert.equal(res.statusCode, 409);
      assert.deepEqual(filters[1], {
        contactNumber: "09171234567",
        isClosed: { $ne: true },
      });
    }
  );
});

test("updateMe email check uses isClosed $ne true", async () => {
  let filter;
  await stub(
    User,
    ["exists"],
    [
      async (f) => {
        filter = f;
        return { _id: 1 };
      },
    ],
    async () => {
      const res = createRes();
      await updateMe(
        {
          user: { _id: new mongoose.Types.ObjectId() },
          body: { name: "Ana", email: "ana@x.com" },
        },
        res
      );
      assert.equal(res.statusCode, 409);
      assert.deepEqual(filter.isClosed, { $ne: true });
    }
  );
});

const closeStubs = (txExists, state) => {
  const customerId = new mongoose.Types.ObjectId();
  const customer = {
    _id: customerId,
    role: "customer",
    status: "active",
    save: async () => {
      state.saved = true;
    },
  };
  const account = {
    _id: new mongoose.Types.ObjectId(),
    balance: 0,
    save: async () => {
      state.accountSaved = true;
    },
  };
  return {
    customer,
    account,
    names: ["findById", "findOne", "exists"],
    targets: [User, BankAccount, Transaction],
    fns: [
      async () => customer,
      async () => account,
      async (f) => {
        state.filter = f;
        return txExists;
      },
    ],
  };
};

test("close is refused while a flagged transfer exists", async () => {
  const state = {};
  const s = closeStubs({ _id: 1 }, state);
  const origs = [User.findById, BankAccount.findOne, Transaction.exists];
  User.findById = s.fns[0];
  BankAccount.findOne = s.fns[1];
  Transaction.exists = s.fns[2];
  try {
    const res = createRes();
    await updateCustomerStatus(
      {
        params: { id: String(s.customer._id) },
        body: { status: "closed" },
        user: { _id: new mongoose.Types.ObjectId(), role: "staff" },
      },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(
      res.body.message,
      "Cannot close customer account while transactions are pending"
    );
    assert.deepEqual(state.filter.status, { $in: ["pending", "flagged"] });
    assert.equal(state.saved, undefined);
    assert.equal(state.accountSaved, undefined);
  } finally {
    [User.findById, BankAccount.findOne, Transaction.exists] = origs;
  }
});

test("close succeeds and logs ACCOUNT_CLOSED", async () => {
  const state = {};
  const s = closeStubs(null, state);
  const origs = [User.findById, BankAccount.findOne, Transaction.exists, AuditLog.create];
  User.findById = s.fns[0];
  BankAccount.findOne = s.fns[1];
  Transaction.exists = s.fns[2];
  let logged;
  AuditLog.create = async (docs) => {
    logged = docs[0];
    return docs;
  };
  try {
    const res = createRes();
    await updateCustomerStatus(
      {
        params: { id: String(s.customer._id) },
        body: { status: "closed" },
        user: { _id: new mongoose.Types.ObjectId(), role: "staff" },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(s.account.status, "closed");
    assert.equal(s.customer.isClosed, true);
    assert.equal(logged.action, "ACCOUNT_CLOSED");
  } finally {
    [User.findById, BankAccount.findOne, Transaction.exists, AuditLog.create] = origs;
  }
});

test("getAdminUsers no longer filters out closed users", async () => {
  let findFilter;
  let countFilter;
  const rows = [
    {
      _id: new mongoose.Types.ObjectId(),
      name: "Closed Staff",
      email: "c@x.com",
      role: "staff",
      status: "closed",
      isClosed: true,
    },
  ];
  const chain = {
    select: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: () => Promise.resolve(rows),
  };
  await stub(
    User,
    ["find", "countDocuments"],
    [
      (f) => {
        findFilter = f;
        return chain;
      },
      async (f) => {
        countFilter = f;
        return 1;
      },
    ],
    async () => {
      const res = createRes();
      await getAdminUsers({ query: {} }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(findFilter, {});
      assert.deepEqual(countFilter, {});
      assert.equal(res.body.data[0].status, "closed");
    }
  );
});

const verifySetup = (isVerified) => {
  const customerId = new mongoose.Types.ObjectId();
  const customer = {
    _id: customerId,
    role: "customer",
    isVerified,
    save: async () => {},
  };
  const req = {
    params: { id: String(customerId) },
    user: { _id: new mongoose.Types.ObjectId(), role: "staff" },
  };
  return { customer, req };
};

test("verifyCustomer notifies and logs CUSTOMER_VERIFIED", async () => {
  const { customer, req } = verifySetup(false);
  let notified;
  let logged;
  await stub(
    User,
    ["findById"],
    [async () => customer],
    () =>
      stub(
        Notification,
        ["create"],
        [
          async (doc) => {
            notified = doc;
            return doc;
          },
        ],
        () =>
          stub(
            AuditLog,
            ["create"],
            [
              async (docs) => {
                logged = docs[0];
                return docs;
              },
            ],
            async () => {
              const res = createRes();
              await verifyCustomer(req, res);
              assert.equal(res.statusCode, 200);
              assert.equal(String(notified.recipient), String(customer._id));
              assert.equal(notified.type, "account");
              assert.equal(
                notified.message,
                "Your account is verified. You can now transfer money and view your card details."
              );
              assert.equal(logged.action, "CUSTOMER_VERIFIED");
            }
          )
      )
  );
});

test("verifyCustomer doesn't notify twice", async () => {
  const { customer, req } = verifySetup(true);
  let logged;
  await stub(
    User,
    ["findById"],
    [async () => customer],
    () =>
      stub(
        Notification,
        ["create"],
        [
          async () => {
            throw new Error("should not be called");
          },
        ],
        () =>
          stub(
            AuditLog,
            ["create"],
            [
              async (docs) => {
                logged = docs[0];
                return docs;
              },
            ],
            async () => {
              const res = createRes();
              await verifyCustomer(req, res);
              assert.equal(res.statusCode, 200);
              assert.equal(logged.action, "CUSTOMER_VERIFIED");
            }
          )
      )
  );
});

test("a failed notification doesn't fail verification", async () => {
  const { customer, req } = verifySetup(false);
  let logged;
  await stub(
    User,
    ["findById"],
    [async () => customer],
    () =>
      stub(
        Notification,
        ["create"],
        [
          async () => {
            throw new Error("down");
          },
        ],
        () =>
          stub(
            AuditLog,
            ["create"],
            [
              async (docs) => {
                logged = docs[0];
                return docs;
              },
            ],
            async () => {
              const res = createRes();
              await verifyCustomer(req, res);
              assert.equal(res.statusCode, 200);
              assert.equal(logged.action, "CUSTOMER_VERIFIED");
            }
          )
      )
  );
});

test("no old audit action strings remain", () => {
  const text = [
    "accountController.js",
    "staffController.js",
    "transactionController.js",
  ]
    .map((f) => fs.readFileSync(new URL(`../src/controllers/${f}`, import.meta.url), "utf8"))
    .join("\n");
  for (const old of [
    "Acount Frozen",
    "Account Unfrozen",
    "Customer Verified",
    "Transfer Approved",
    "Transfer Rejected",
    "Transfer Flagged",
  ]) {
    assert.equal(text.includes(`"${old}"`), false, old);
  }
  for (const code of [
    "ACCOUNT_FROZEN",
    "ACCOUNT_UNFROZEN",
    "CUSTOMER_VERIFIED",
    "ACCOUNT_CLOSED",
    "TRANSACTION_APPROVED",
    "TRANSACTION_REJECTED",
    "TRANSACTION_FLAGGED",
  ]) {
    assert.equal(text.includes(`"${code}"`), true, code);
  }
});
