import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import BankAccount from "../src/models/BankAccount.js";
import { getStaffCustomers, getStaffCustomerById } from "../src/controllers/staffController.js";

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

const makeCustomer = (name) => ({
  _id: new mongoose.Types.ObjectId(),
  name,
  email: `${name.toLowerCase()}@example.com`,
  role: "customer",
  status: "active",
  isVerified: true,
  notificationPreferences: { email: true, sms: false },
  createdAt: new Date(),
  updatedAt: new Date(),
});

const stubUserFind = (customers) => {
  User.find = () => ({
    select: () => ({
      sort: () => ({ lean: () => Promise.resolve(customers) }),
    }),
  });
};

const stubUserFindById = (result) => {
  User.findById = () => ({
    select: () => ({ lean: () => Promise.resolve(result) }),
  });
};

const withStubs = async (fn) => {
  const originals = {
    userFind: User.find,
    userFindById: User.findById,
    bankFind: BankAccount.find,
    bankFindOne: BankAccount.findOne,
  };
  try {
    await fn();
  } finally {
    User.find = originals.userFind;
    User.findById = originals.userFindById;
    BankAccount.find = originals.bankFind;
    BankAccount.findOne = originals.bankFindOne;
  }
};

test("getStaffCustomers: attaches account without balance, filtered by customer ids", async () => {
  await withStubs(async () => {
    const A = makeCustomer("A");
    const B = makeCustomer("B");
    const account = {
      _id: new mongoose.Types.ObjectId(),
      accountNumber: "001285165389",
      status: "frozen",
      balance: 99999,
      owner: A._id,
    };
    let filter;
    stubUserFind([A, B]);
    BankAccount.find = (f) => {
      filter = f;
      return { select: () => ({ lean: () => Promise.resolve([account]) }) };
    };

    const res = createRes();
    await getStaffCustomers({}, res);

    assert.equal(res.statusCode, 200);
    const { data } = res.body;
    assert.deepEqual(data[0].account, {
      _id: account._id,
      accountNumber: "001285165389",
      status: "frozen",
    });
    assert.equal("balance" in data[0].account, false);
    assert.equal(data[1].account, null);
    assert.equal("role" in data[0], false);
    assert.equal("notificationPreferences" in data[0], false);
    assert.deepEqual(filter.owner.$in.map(String), [String(A._id), String(B._id)]);
  });
});

test("getStaffCustomerById: includes the balance", async () => {
  await withStubs(async () => {
    const A = makeCustomer("A");
    const account = {
      _id: new mongoose.Types.ObjectId(),
      accountNumber: "001285165389",
      status: "active",
      balance: 15025,
      owner: A._id,
    };
    stubUserFindById(A);
    BankAccount.findOne = () => ({ select: () => ({ lean: () => Promise.resolve(account) }) });

    const res = createRes();
    await getStaffCustomerById({ params: { id: String(A._id) } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.account, {
      _id: account._id,
      accountNumber: "001285165389",
      status: "active",
      balance: 15025,
    });
    assert.equal("role" in res.body.data, false);
    assert.equal("notificationPreferences" in res.body.data, false);
  });
});

test("getStaffCustomerById: no account gives account null", async () => {
  await withStubs(async () => {
    const A = makeCustomer("A");
    stubUserFindById(A);
    BankAccount.findOne = () => ({ select: () => ({ lean: () => Promise.resolve(null) }) });

    const res = createRes();
    await getStaffCustomerById({ params: { id: String(A._id) } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.account, null);
  });
});

test("getStaffCustomerById: error responses unchanged", async () => {
  await withStubs(async () => {
    const A = makeCustomer("A");
    BankAccount.findOne = () => {
      throw new Error("should not be reached");
    };

    const res1 = createRes();
    await getStaffCustomerById({ params: { id: "abc" } }, res1);
    assert.equal(res1.statusCode, 400);
    assert.equal(res1.body.message, "Invalid customer ID");

    stubUserFindById(null);
    const res2 = createRes();
    await getStaffCustomerById({ params: { id: String(A._id) } }, res2);
    assert.equal(res2.statusCode, 404);
    assert.equal(res2.body.message, "User not found");

    stubUserFindById({ ...A, role: "staff" });
    const res3 = createRes();
    await getStaffCustomerById({ params: { id: String(A._id) } }, res3);
    assert.equal(res3.statusCode, 404);
    assert.equal(res3.body.message, "Customer not found");
  });
});

test("getStaffCustomers: account lookup failure returns 500", async () => {
  await withStubs(async () => {
    const A = makeCustomer("A");
    stubUserFind([A]);
    BankAccount.find = () => ({
      select: () => ({ lean: () => Promise.reject(new Error("db down")) }),
    });

    const res = createRes();
    await getStaffCustomers({}, res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, "Unable to retrieve customers");
  });
});

test("getStaffCustomerById: account lookup failure returns 500", async () => {
  await withStubs(async () => {
    const A = makeCustomer("A");
    stubUserFindById(A);
    BankAccount.findOne = () => ({
      select: () => ({ lean: () => Promise.reject(new Error("db down")) }),
    });

    const res = createRes();
    await getStaffCustomerById({ params: { id: String(A._id) } }, res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, "Unable to retrieve customer");
  });
});
