export const PRODUCT_FIELDS = [
  "name",
  "price",
  "amount",
  "unit",
  "pack",
  "currency",
  "exchangeRate",
  "shipping",
  "feePercent",
  "fixedFee",
  "discount",
  "discountValue",
  "offerCount",
  "offerPrice",
  "taxPercent",
  "dutyPercent",
  "deposit",
  "rebate",
  "wastePercent",
  "yieldFactor",
  "store",
  "date",
  "barcode",
  "notes",
  "quality",
  "basketItem",
  "basketCount",
  "targetPrice",
];
const dangerous = new Set(["__proto__", "prototype", "constructor"]);
const localSnapshots = new Map(), localIssues = new Map();
const LOCAL_BYTES = 2000000, LOCAL_NODES = 120000;
let writable = true;
let erased = false;
let erasure;
export const localDataErased = () => erased;
export const storageWritable = () => writable && !erased;
export const setStorageWritable = (value) => { writable = value === true; };
export const storageIssues = () => [...localIssues.values()].map((issue) => ({ ...issue }));
export function eraseLocalData(broadcast = true) {
  if (erasure) return erasure;
  // Stop late FX responses and unload handlers from recreating erased data.
  erased = true;
  globalThis.dispatchEvent?.(new Event("parimere:erase-data"));
  erasure = (async () => {
    const failures = [];
    if (broadcast) {
      try {
        // Other open tabs must also discard their in-memory state and membership.
        localStorage.setItem("parimere:erase-request", String(Date.now()));
      } catch {}
    }
    for (const name of ["localStorage", "sessionStorage"]) {
      try {
        const storage = globalThis[name];
        for (let i = storage.length - 1; i >= 0; i--) {
          const key = storage.key(i);
          if (key?.startsWith("parimere:")) storage.removeItem(key);
        }
      } catch {
        failures.push(name === "localStorage" ? "saved data" : "session data");
      }
    }
    if (globalThis.caches) {
      try {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith("parimere-"))
          .map((name) => caches.delete(name)));
      } catch {
        failures.push("offline files");
      }
    }
    globalThis.dispatchEvent?.(new CustomEvent("parimere:data-erased", { detail: failures }));
    return failures;
  })();
  return erasure;
}
globalThis.addEventListener?.("storage", (event) => {
  if (event.key === "parimere:erase-request" && event.newValue) void eraseLocalData(false);
});
function boundedJSON(text, max, maxNodes) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > max)
    throw new Error("This file exceeds the size limit.");
  const value = JSON.parse(text);
  let count = 0;
  function visit(v, depth) {
    if (++count > maxNodes || depth > 16)
      throw new Error("Data nesting exceeds the limit.");
    if (v && typeof v === "object")
      for (const [k, item] of Object.entries(v)) {
        if (dangerous.has(k)) throw new Error("Unsupported data key.");
        visit(item, depth + 1);
      }
  }
  visit(value, 0);
  return value;
}
export function safeJSON(text, max = 250000) {
  return boundedJSON(text, max, 12000);
}
export function documentData(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    typeof value.name !== "string" ||
    value.name.length > 100 ||
    !Array.isArray(value.products) ||
    value.products.length < 2 ||
    value.products.length > 24 ||
    !/^[A-Z]{3}$/.test(value.currency)
  )
    throw new Error("Use a version 1 comparison containing 2–24 products.");
  const products = value.products.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("Invalid product.");
    const p = {};
    for (const key of PRODUCT_FIELDS) {
      const v = row[key];
      if (v !== undefined) {
        if (
          typeof v !== "string" ||
          v.length > (["notes", "quality"].includes(key) ? 1000 : 200)
        )
          throw new Error("Invalid product field: " + key);
        p[key] = v;
      }
    }
    if (row.fx) {
      if (
        !row.fx ||
        !["auto", "manual", "saved"].includes(row.fx.mode) ||
        typeof row.fx.pair !== "string" ||
        row.fx.pair.length > 8 ||
        typeof row.fx.date !== "string" ||
        row.fx.date.length > 32
      )
        throw new Error("Invalid rate metadata.");
      p.fx = { mode: row.fx.mode, pair: row.fx.pair, date: row.fx.date };
    }
    return p;
  });
  const options = {};
  for (const key of ["basis", "target", "budget", "usage", "rank"])
    if (value.options?.[key] !== undefined) {
      const v = value.options[key];
      if (typeof v !== "string" || v.length > 32)
        throw new Error("Invalid planning option.");
      options[key] = v;
    }
  return {
    schemaVersion: 1,
    name: value.name,
    currency: value.currency,
    products,
    options,
  };
}
export function readLocal(key, fallback) {
  let text;
  try {
    text = localStorage.getItem("parimere:" + key);
  } catch {
    localSnapshots.set(key, { blocked: true });
    localIssue(key, "unavailable", "Local storage is unavailable. Existing data has not been changed.");
    return fallback;
  }
  try {
    const value = text === null ? fallback : boundedJSON(text, LOCAL_BYTES, LOCAL_NODES);
    localSnapshots.set(key, { text, blocked: false });
    localIssues.delete(key);
    return value;
  } catch {
    localSnapshots.set(key, { text, blocked: true });
    localIssue(key, "unreadable", "Stored " + key + " data could not be read. It has been kept and will not be overwritten. Recover it or remove this site's stored data before saving again.");
    return fallback;
  }
}
function localIssue(key, kind, message) {
  localIssues.set(key, { key, kind, message });
  const error = new Error(message);
  error.code = "PARIMERE_STORAGE_" + kind.toUpperCase();
  return error;
}
export function protectLocalData(key, message) {
  const snapshot = localSnapshots.get(key) || {};
  localSnapshots.set(key, { ...snapshot, blocked: true });
  return localIssue(key, "unreadable", message);
}
export function writeLocal(key, value) {
  return writeLocalValue(key, value, false);
}
export function replaceLocalData(key, value) {
  return writeLocalValue(key, value, true);
}
function writeLocalValue(key, value, replaceUnreadable) {
  if (erased) return;
  if (!writable) {
    const error = new Error("This tab is read-only. Use the editing tab to save changes.");
    error.code = "PARIMERE_STORAGE_READONLY";
    throw error;
  }
  if (replaceUnreadable && !localSnapshots.has(key))
    throw localIssue(key, "unavailable", "Load saved data before resetting it so changes from another tab can be checked.");
  if (!localSnapshots.has(key)) readLocal(key, null);
  const snapshot = localSnapshots.get(key);
  if (snapshot.blocked && !(replaceUnreadable && Object.hasOwn(snapshot, "text"))) {
    const issue = localIssues.get(key);
    throw localIssue(key, issue.kind, issue.message);
  }
  let previous;
  try {
    previous = localStorage.getItem("parimere:" + key);
  } catch {
    throw localIssue(key, "unavailable", "Local storage is unavailable. Export your comparison before closing.");
  }
  if (previous !== snapshot.text)
    throw localIssue(key, "conflict", "Stored " + key + " data changed in another tab. Your changes have not overwritten it. Export this comparison, then reload to use the latest saved data.");
  let text;
  try {
    text = JSON.stringify(value);
    boundedJSON(text, LOCAL_BYTES, LOCAL_NODES);
  } catch {
    const error = new Error("This data exceeds local storage limits or contains unsupported values. Existing data has not been changed.");
    error.code = "PARIMERE_STORAGE_INVALID";
    throw error;
  }
  try {
    localStorage.setItem("parimere:" + key, text);
  } catch {
    throw localIssue(key, "unavailable", "Local storage is full or unavailable. Export your comparison before closing.");
  }
  localSnapshots.set(key, { text, blocked: false });
  localIssues.delete(key);
}
export function csvCell(value) {
  const text = String(value ?? "");
  return (
    '"' +
    (/^[\s]*[=+@-]/.test(text) ? "'" : "") +
    text.replaceAll('"', '""') +
    '"'
  );
}
