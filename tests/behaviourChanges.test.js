import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import BankAccount from "../src/models/BankAccount.js";
import Transaction from "../src/models/Transaction.js";
import AuditLog from "../src/models/AuditLog.js";
import adminRoutes from "../src/routes/adminRoutes.js";
import { updateCustomerStatus } from "../src/controllers/staffController.js";
import { updateStaffStatus, getAdminUserById } from "../src/controllers/adminController.js";
import { getTransactions } from "../src/controllers/transactionController.js";

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

const staffUser = { _id: new mongoose.Types.ObjectId(), role: "staff" };
const adminUser = { _id: new mongoose.Types.ObjectId(), role: "admin" };

// Save the given methods of an object, run fn, then restore them.
const withStubs = async (targets, fn) => {
  const saved = targets.map(([obj, key]) => [obj, key, obj[key]]);
  try {
    return await fn();
  } finally {
    for (const [obj, key, original] of saved) obj[key] = original;
  }
};

const throwing = (name) => () => {
  throw new Error(`${name} should not be called`);
};

// --- #7 ---------------------------------------------------------------

test("staff can only close: other statuses are 400", async () => {
  await withStubs([[User, "findById"]], async () => {
    User.findById = throwing("User.findById");
    for (const status of ["active", "deactivated", "disabled", undefined]) {
      const res = createRes();
      await updateCustomerStatus(
        {
          params: { id: new mongoose.Types.ObjectId().toString() },
          body: { status },
          user: staffUser,
        },
        res
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.message, "Invalid account status");
    }
  });
});

test("admin can only close: other statuses are 400", async () => {
  await withStubs([[mongoose, "startSession"]], async () => {
    mongoose.startSession = throwing("mongoose.startSession");
    for (const status of ["active", "deactivated", "disabled"]) {
      const res = createRes();
      await updateStaffStatus(
        {
          params: { id: new mongoose.Types.ObjectId().toString() },
          body: { status },
          user: adminUser,
        },
        res
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.message, "Invalid account status.");
    }
  });
});

test("admin closing staff still works", async () => {
  await withStubs(
    [
      [mongoose, "startSession"],
      [User, "findOne"],
      [AuditLog, "create"],
    ],
    async () => {
      const staff = {
        _id: new mongoose.Types.ObjectId(),
        name: "S",
        email: "s@x.com",
        role: "staff",
        status: "active",
        save: async () => {},
      };
      mongoose.startSession = async () => ({
        withTransaction: async (fn) => fn(),
        endSession: async () => {},
      });
      User.findOne = () => ({ session: () => Promise.resolve(staff) });
      AuditLog.create = async (docs) => docs;

      const res = createRes();
      await updateStaffStatus(
        {
          params: { id: staff._id.toString() },
          body: { status: "closed" },
          user: adminUser,
        },
        res
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.status, "closed");
      assert.equal(staff.isClosed, true);
    }
  );
});

// --- #9 ---------------------------------------------------------------

test("GET /admin/users/:id returns identity fields, closed users included", async () => {
  await withStubs([[User, "findById"]], async () => {
    const u = {
      _id: new mongoose.Types.ObjectId(),
      name: "Closed Staff",
      email: "c@x.com",
      role: "staff",
      status: "closed",
      isVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    User.findById = () => ({ select: () => ({ lean: () => Promise.resolve(u) }) });

    const res = createRes();
    await getAdminUserById({ params: { id: u._id.toString() }, user: adminUser }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, "closed");
    assert.equal(res.body.data.email, "c@x.com");
    for (const key of ["passwordHash", "balance", "accountNumber"]) {
      assert.equal(key in res.body.data, false);
    }
    assert.equal("contactNumber" in res.body.data, false);
  });
});

test("GET /admin/users/:id errors", async () => {
  await withStubs([[User, "findById"]], async () => {
    const id = new mongoose.Types.ObjectId().toString();

    let res = createRes();
    await getAdminUserById({ params: { id: "abc" }, user: adminUser }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Invalid user ID");

    User.findById = () => ({ select: () => ({ lean: () => Promise.resolve(null) }) });
    res = createRes();
    await getAdminUserById({ params: { id }, user: adminUser }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.message, "User not found");

    User.findById = () => ({
      select: () => ({ lean: () => Promise.reject(new Error("db down")) }),
    });
    const origError = console.error;
    console.error = () => {};
    try {
      res = createRes();
      await getAdminUserById({ params: { id }, user: adminUser }, res);
    } finally {
      console.error = origError;
    }
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, "Unable to retrieve user");
  });
});

test("GET /admin/users/:id is registered, admin-only", () => {
  const layer = adminRoutes.stack.find(
    (l) => l.route?.path === "/users/:id" && l.route.methods.get
  );
  assert.ok(layer);
  assert.equal(layer.route.stack.length, 2);
});

// --- #6 ---------------------------------------------------------------

const ownId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();

// Stubs shared by the search tests. Returns state captured by the stubs.
const stubSearch = ({ users, namedAccounts } = {}) => {
  const state = { listFilter: null, userFilter: null, nameFilter: null, pipelines: [] };
  BankAccount.findOne = () => ({ session: () => Promise.resolve({ _id: ownId }) });
  BankAccount.find = (f) => {
    if (f.owner) state.nameFilter = f;
    return {
      select: () => ({
        lean: () => Promise.resolve(f.owner ? namedAccounts ?? [] : []),
      }),
    };
  };
  if (users) {
    User.find = (f) => {
      state.userFilter = f;
      return { select: () => ({ lean: () => Promise.resolve(users) }) };
    };
  } else {
    User.find = throwing("User.find");
  }
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    populate: () => chain,
    lean: () => Promise.resolve([]),
  };
  Transaction.find = (f) => {
    state.listFilter = f;
    return chain;
  };
  Transaction.aggregate = async (pipeline) => {
    state.pipelines.push(pipeline);
    return [];
  };
  return state;
};

const searchTargets = [
  [BankAccount, "findOne"],
  [BankAccount, "find"],
  [User, "find"],
  [Transaction, "find"],
  [Transaction, "aggregate"],
];

const runSearch = async (search) => {
  const res = createRes();
  await getTransactions({ user: { _id: userId }, query: { search } }, res);
  return res;
};

const searchClause = (state) => state.listFilter.$and.at(-1);

test("customer search matches amounts, without a name lookup for numbers", async () => {
  await withStubs(searchTargets, async () => {
    for (const [search, centavos] of [
      ["1,250.50", 125050],
      ["₱500", 50000],
      ["500", 50000],
    ]) {
      const state = stubSearch();
      const res = await runSearch(search);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(
        searchClause(state).$or.filter((c) => "amount" in c),
        [{ amount: centavos }]
      );
    }
  });
});

const benId = new mongoose.Types.ObjectId();
const benAccId = new mongoose.Types.ObjectId();

test("customer search matches a recipient's first name, outgoing only", async () => {
  await withStubs(searchTargets, async () => {
    const state = stubSearch({ users: [{ _id: benId }], namedAccounts: [{ _id: benAccId }] });
    const res = await runSearch(" ben ");
    assert.equal(res.statusCode, 200);
    assert.equal(state.userFilter.name.$regex, "^ben");
    assert.equal(state.userFilter.name.$options, "i");
    assert.deepEqual(state.nameFilter._id, { $ne: ownId });
    const or = searchClause(state).$or;
    assert.ok(
      or.some(
        (c) =>
          c.destinationAccount &&
          JSON.stringify(c.destinationAccount) === JSON.stringify({ $in: [benAccId] })
      )
    );
    assert.equal(or.some((c) => "sourceAccount" in c), false);
    assert.equal(or.some((c) => "amount" in c), false);
  });
});

test("multi-word and reference searches never look up names", async () => {
  await withStubs(searchTargets, async () => {
    for (const search of ["Ben Cruz", "TXN-20261030"]) {
      stubSearch();
      const res = await runSearch(search);
      assert.equal(res.statusCode, 200);
    }
  });
});

test("accented first names work", async () => {
  await withStubs(searchTargets, async () => {
    const state = stubSearch({ users: [] });
    const res = await runSearch("Niño");
    assert.equal(res.statusCode, 200);
    assert.equal(state.userFilter.name.$regex, "^Niño");
  });
});

test("a search never widens past the customer's own transactions", async () => {
  await withStubs(searchTargets, async () => {
    const state = stubSearch({ users: [{ _id: benId }], namedAccounts: [{ _id: benAccId }] });
    const res = await runSearch("ben");
    assert.equal(res.statusCode, 200);
    const visibility = {
      $or: [
        { sourceAccount: ownId },
        { destinationAccount: ownId, transactionType: "cash_in" },
        { destinationAccount: ownId, transactionType: "transfer", status: "completed" },
      ],
    };
    assert.deepEqual(state.listFilter.$and[0], visibility);
    assert.equal(state.listFilter.$and.length, 2);
    assert.deepEqual(state.pipelines[0][0].$match.$and[0], visibility);
  });
});
