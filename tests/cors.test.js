import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.CLIENT_URL = "http://localhost:5173, http://localhost:4173";
const { default: app, parseClientOrigins } = await import("../src/app.js");

const originHeader = (port, origin) =>
  new Promise((resolve, reject) => {
    http
      .get({ port, path: "/api/health", headers: { Origin: origin } }, (res) => {
        res.resume();
        resolve(res.headers["access-control-allow-origin"] ?? null);
      })
      .on("error", reject);
  });

test("parseClientOrigins", () => {
  assert.equal(parseClientOrigins("http://a"), "http://a");
  assert.deepEqual(parseClientOrigins(" http://a , http://b "), ["http://a", "http://b"]);
  assert.equal(parseClientOrigins("http://a,"), "http://a");
  assert.equal(parseClientOrigins(undefined), undefined);
  assert.equal(parseClientOrigins(""), undefined);
});

test("both listed origins are allowed, others aren't", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    assert.equal(await originHeader(port, "http://localhost:4173"), "http://localhost:4173");
    assert.equal(await originHeader(port, "http://localhost:5173"), "http://localhost:5173");
    assert.equal(await originHeader(port, "http://evil.test"), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
