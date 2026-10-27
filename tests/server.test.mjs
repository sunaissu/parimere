import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createAppServer } from "../serve.mjs";
import { createHouseholdStore } from "../households.mjs";

const origin = "https://parimere.test";
async function fixture(t, { sync = true, trustProxy = false } = {}) {
  const store = sync ? createHouseholdStore(":memory:") : null;
  const server = createAppServer({ configuredOrigin: origin, store, trustProxy });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store?.close();
  });
  return (path, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port: server.address().port,
        path,
        method,
        headers: { Host: "parimere.test", ...headers },
        agent: false,
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: response.statusCode, headers: response.headers, text });
        });
      });
      request.on("error", reject);
      request.end(body);
    });
}
const create = (ip) => ({
  method: "POST",
  headers: {
    Origin: origin,
    "Content-Type": "application/json",
    ...(ip ? { "X-Real-IP": ip } : {}),
  },
  body: JSON.stringify({ name: "Home", memberName: "Owner" }),
});

test("deployment origin rejects ambiguous URLs and public HTTP", () => {
  for (const configuredOrigin of [
    "http://parimere.test", "ftp://localhost", "https://parimere.test/app",
    "https://name:password@parimere.test", "https://parimere.test/?query=1",
    "https://parimere.test/#fragment",
  ]) assert.throws(() => createAppServer({ configuredOrigin }));
});

test("HTTP routes enforce host, static allowlist, security headers and disabled sync", async (t) => {
  const request = await fixture(t, { sync: false });
  assert.equal((await request("/", { headers: { Host: "other.test" } })).status, 403);
  for (const path of ["/serve.mjs", "/data/households.sqlite", "/../package.json"])
    assert.equal((await request(path)).status, 404);
  const page = await request("/", { method: "HEAD" });
  assert.equal(page.status, 200);
  assert.equal(page.text, "");
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.doesNotMatch(page.headers["content-security-policy"], /wasm-unsafe-eval/);
  const info = await request("/api/service-info");
  assert.equal(info.status, 200);
  assert.equal(JSON.parse(info.text).householdSync, false);
  assert.match(info.headers["cache-control"], /no-store/);
  assert.equal((await request("/api/households", create())).status, 503);
});

test("HTTP mutations reject foreign origins, invalid bodies and oversized requests", async (t) => {
  const request = await fixture(t);
  for (const headers of [
    { "Content-Type": "application/json" },
    { Origin: "https://other.test", "Content-Type": "application/json" },
    { Origin: origin, "Content-Type": "text/plain" },
  ]) assert.equal((await request("/api/households", { ...create(), headers })).status, 403);
  for (const body of ["null", "[]", "{", '{"__proto__":{}}'])
    assert.equal((await request("/api/households", { ...create(), body })).status, 400);
  assert.equal((await request("/api/households", {
    ...create(), body: JSON.stringify({ name: "x".repeat(210001) }),
  })).status, 413);
  const created = await request("/api/households", create());
  assert.equal(created.status, 200);
  const household = JSON.parse(created.text);
  const denied = await request("/api/households/" + household.id);
  assert.equal(denied.status, 401);
  const allowed = await request("/api/households/" + household.id, {
    headers: { Authorization: "Bearer " + household.credential },
  });
  assert.equal(allowed.status, 200);
  assert.ok(!allowed.text.includes(household.credential));
});

test("trusted proxy clients receive independent creation quotas", async (t) => {
  const request = await fixture(t, { trustProxy: true });
  for (let count = 0; count < 10; count++)
    assert.equal((await request("/api/households", create("192.0.2.1"))).status, 200);
  assert.equal((await request("/api/households", create("192.0.2.1"))).status, 429);
  assert.equal((await request("/api/households", create("192.0.2.2"))).status, 200);
  for (const ip of [undefined, "invalid", "192.0.2.1, 192.0.2.2"])
    assert.equal((await request("/api/households", create(ip))).status, 400);
});

test("forwarded headers cannot bypass quotas unless proxy trust is enabled", async (t) => {
  const request = await fixture(t);
  for (let count = 0; count < 10; count++)
    assert.equal((await request("/api/households", create("192.0.2.1"))).status, 200);
  assert.equal((await request("/api/households", create("192.0.2.2"))).status, 429);
});
