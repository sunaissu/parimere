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
export function safeJSON(text, max = 250000) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > max)
    throw new Error("This file exceeds the size limit.");
  const value = JSON.parse(text);
  let count = 0;
  function visit(v, depth) {
    if (++count > 12000 || depth > 16)
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
  try {
    const value = localStorage.getItem("parimere:" + key);
    return value ? safeJSON(value, 2000000) : fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key, value) {
  try {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > 2000000) throw new Error();
    localStorage.setItem("parimere:" + key, text);
  } catch {
    throw new Error(
      "Local storage is full or unavailable. Export your comparison before closing.",
    );
  }
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
