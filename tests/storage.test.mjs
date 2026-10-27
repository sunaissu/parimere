import test from "node:test";
import assert from "node:assert/strict";

let sequence = 0;
async function fixture(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
  const tab = () => import(new URL("../dist/storage.mjs?storage-test=" + sequence++, import.meta.url));
  return { values, storage, tab, api: await tab() };
}

function product(api) {
  return {
    ...Object.fromEntries(api.PRODUCT_FIELDS.map((key) => [key, ""])),
    name: "Rice", price: "10", amount: "1", unit: "kg", pack: "1", currency: "PHP",
    fx: { mode: "manual", pair: "PHP/PHP", date: "" },
  };
}

test("all supported saved comparisons and catalog history survive persistence", async (t) => {
  const { api } = await fixture(t);
  const document = api.documentData({
    schemaVersion: 1, name: "Weekly comparison", currency: "PHP",
    products: Array.from({ length: 24 }, () => product(api)),
    options: { basis: "1", target: "", budget: "", usage: "", rank: "price" },
  });
  const saved = Array.from({ length: 40 }, (_, i) => ({
    id: String(i), at: "2026-10-22T00:00:00.000Z", document,
  }));
  api.writeLocal("saved", saved);
  assert.deepEqual(api.readLocal("saved", []), saved);

  const catalog = Array.from({ length: 200 }, (_, i) => ({
    id: String(i), key: "Rice " + i, product: product(api),
    history: Array.from({ length: 100 }, () => ({ date: "2026-10-22", price: 10, currency: "PHP" })),
  }));
  api.writeLocal("catalog", catalog);
  assert.deepEqual(api.readLocal("catalog", []), catalog);
  assert.deepEqual(api.storageIssues(), []);
});

test("larger persisted collections do not relax untrusted import limits", async (t) => {
  const { api } = await fixture(t);
  const values = Array(12001).fill(0);
  const text = JSON.stringify(values);
  assert.throws(() => api.safeJSON(text), /nesting/);
  assert.throws(() => api.safeJSON(text, 2000000), /nesting/);
  api.writeLocal("large", values);
  assert.deepEqual(api.readLocal("large", []), values);
  assert.throws(() => api.safeJSON('{"__proto__":{}}'), /key/);
});

test("unreadable stored values are reported and cannot be overwritten", async (t) => {
  const { api, values } = await fixture(t);
  for (const [index, text] of ["{", "", '{"__proto__":{}}'].entries()) {
    const key = "broken" + index;
    values.set("parimere:" + key, text);
    assert.deepEqual(api.readLocal(key, []), []);
    assert.throws(() => api.writeLocal(key, ["replacement"]), { code: "PARIMERE_STORAGE_UNREADABLE" });
    assert.equal(values.get("parimere:" + key), text);
  }
  const issues = api.storageIssues();
  assert.equal(issues.length, 3);
  assert.ok(issues.every((issue) => issue.kind === "unreadable" && issue.message.includes("kept")));
  issues[0].kind = "changed outside module";
  assert.equal(api.storageIssues()[0].kind, "unreadable");

  values.set("parimere:unread", "invalid JSON");
  assert.throws(() => api.writeLocal("unread", []), { code: "PARIMERE_STORAGE_UNREADABLE" });
  assert.equal(values.get("parimere:unread"), "invalid JSON");

  values.set("parimere:broken0", '["recovered"]');
  assert.deepEqual(api.readLocal("broken0", []), ["recovered"]);
  api.writeLocal("broken0", ["recovered", "new"]);
  assert.ok(!api.storageIssues().some((issue) => issue.key === "broken0"));
});

test("a stale tab cannot replace another tab's saved data or undo a deletion", async (t) => {
  const { api: first, tab, values } = await fixture(t);
  const second = await tab();
  first.readLocal("saved", []);
  second.readLocal("saved", []);
  first.writeLocal("saved", ["comparison A"]);
  assert.throws(() => second.writeLocal("saved", ["comparison B"]), { code: "PARIMERE_STORAGE_CONFLICT" });
  assert.equal(values.get("parimere:saved"), '["comparison A"]');
  assert.equal(second.storageIssues()[0].kind, "conflict");
  const latest = second.readLocal("saved", []);
  second.writeLocal("saved", [...latest, "comparison B"]);
  assert.equal(values.get("parimere:saved"), '["comparison A","comparison B"]');
  assert.deepEqual(second.storageIssues(), []);

  second.readLocal("saved", []);
  values.delete("parimere:saved");
  assert.throws(() => second.writeLocal("saved", ["stale"]), { code: "PARIMERE_STORAGE_CONFLICT" });
  assert.ok(!values.has("parimere:saved"));
});

test("writes reject values that the persisted reader cannot accept", async (t) => {
  const { api, values } = await fixture(t);
  api.writeLocal("current", { name: "original" });
  let nested = null;
  for (let depth = 0; depth < 18; depth++) nested = { child: nested };
  for (const invalid of [undefined, Array(120001).fill(0), "x".repeat(2000001), nested, JSON.parse('{"constructor":{}}')]) {
    assert.throws(() => api.writeLocal("current", invalid), { code: "PARIMERE_STORAGE_INVALID" });
    assert.equal(values.get("parimere:current"), '{"name":"original"}');
  }
  api.writeLocal("current", { name: "valid update" });
  assert.deepEqual(api.readLocal("current", null), { name: "valid update" });
});

test("read-only tabs preserve stored data until editing is enabled", async (t) => {
  const { api, values } = await fixture(t);
  api.writeLocal("current", "original");
  api.setStorageWritable(false);
  assert.equal(api.storageWritable(), false);
  assert.throws(() => api.writeLocal("current", "replacement"), { code: "PARIMERE_STORAGE_READONLY" });
  assert.equal(values.get("parimere:current"), '"original"');
  assert.equal(api.readLocal("current", null), "original");
  api.setStorageWritable(true);
  api.writeLocal("current", "replacement");
  assert.equal(api.storageWritable(), true);
});

test("storage failures preserve values and require recovery after failed reads", async (t) => {
  const { api, storage, values } = await fixture(t);
  const getItem = storage.getItem, setItem = storage.setItem;
  values.set("parimere:saved", '["original"]');
  storage.getItem = () => { throw new Error("Access blocked"); };
  assert.deepEqual(api.readLocal("saved", []), []);
  storage.getItem = getItem;
  assert.throws(() => api.writeLocal("saved", []), { code: "PARIMERE_STORAGE_UNAVAILABLE" });
  assert.equal(values.get("parimere:saved"), '["original"]');
  assert.deepEqual(api.readLocal("saved", []), ["original"]);
  storage.setItem = () => { throw new Error("Quota exceeded"); };
  assert.throws(() => api.writeLocal("saved", ["new"]), { code: "PARIMERE_STORAGE_UNAVAILABLE" });
  assert.equal(values.get("parimere:saved"), '["original"]');
  storage.setItem = setItem;
  api.writeLocal("saved", ["new"]);
  assert.deepEqual(api.storageIssues(), []);
});

test("explicit recovery replacement keeps concurrency, permissions and size checks", async (t) => {
  const { api, values, storage } = await fixture(t);
  values.set("parimere:unseen", "original");
  assert.throws(() => api.replaceLocalData("unseen", {}), { code: "PARIMERE_STORAGE_UNAVAILABLE" });
  assert.equal(values.get("parimere:unseen"), "original");
  api.readLocal("unseen", null);
  api.replaceLocalData("unseen", null);
  values.set("parimere:basket", "broken JSON");
  api.readLocal("basket", {});
  api.setStorageWritable(false);
  assert.throws(() => api.replaceLocalData("basket", {}), { code: "PARIMERE_STORAGE_READONLY" });
  api.setStorageWritable(true);
  assert.throws(() => api.replaceLocalData("basket", Array(120001).fill(0)), { code: "PARIMERE_STORAGE_INVALID" });
  assert.equal(values.get("parimere:basket"), "broken JSON");
  values.set("parimere:basket", "changed externally");
  assert.throws(() => api.replaceLocalData("basket", {}), { code: "PARIMERE_STORAGE_CONFLICT" });
  assert.equal(values.get("parimere:basket"), "changed externally");
  api.readLocal("basket", {});
  api.replaceLocalData("basket", { currency: "PHP", stores: {} });
  assert.deepEqual(api.readLocal("basket", null), { currency: "PHP", stores: {} });
  assert.deepEqual(api.storageIssues(), []);

  const getItem = storage.getItem;
  storage.getItem = () => { throw new Error("Access blocked"); };
  api.readLocal("unknown", null);
  storage.getItem = getItem;
  assert.throws(() => api.replaceLocalData("unknown", {}), { code: "PARIMERE_STORAGE_UNAVAILABLE" });
  await api.eraseLocalData(false);
  api.replaceLocalData("basket", { shouldNotReturn: true });
  assert.ok(!values.has("parimere:basket"));
});
