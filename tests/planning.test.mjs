import test from "node:test";
import assert from "node:assert/strict";
import {
  calculate,
  comparePlanned,
  optimizeMix,
  basketTotals,
} from "../dist/planning.mjs";
import { compareMany } from "../dist/math.mjs";
import { documentData, safeJSON, csvCell } from "../dist/storage.mjs";
const p = (price, amount = "1", extra = {}) => ({
  price: String(price),
  amount: String(amount),
  unit: "item",
  pack: "1",
  currency: "PHP",
  ...extra,
});
test('maximum fixed discount and FX winner boundaries stay valid',()=>{
 const max=comparePlanned([p('1000000000',1,{discount:'fixed',discountValue:'1000000000'}),p(1)]);assert.deepEqual(max.winners,[0]);assert.equal(max.plans[0].breakEvenPrice,1000000000);
 const best=comparePlanned([p(10,1,{currency:'USD',exchangeRate:'1'}),p(20)]);assert.equal(best.plans[0].fxThreshold,2);
 const losing=comparePlanned([p(10,1,{currency:'USD',exchangeRate:'4'}),p(20)]);assert.equal(losing.plans[0].fxThreshold,2);
});
test("advanced model preserves old exact rankings and checkout formula", () => {
  for (let i = 1; i < 50; i++) {
    const products = [
      p(i * 3, 7, { shipping: ".2", feePercent: "2.5", fixedFee: ".1" }),
      p(i * 5, 12),
      p(i * 7, 17),
    ];
    const old = compareMany(products),
      next = comparePlanned(products);
    assert.deepEqual(next.winners, old.winners);
    assert.deepEqual(next.order, old.order);
    next.prices.forEach((v, n) =>
      assert.ok(Math.abs(v - old.prices[n]) < 1e-9),
    );
  }
  assert.equal(
    comparePlanned([p(".3", ".3"), p(".1", ".1")]).winners.length,
    2,
  );
});
test("offer rules distinguish quantity and checkout, including fractional target rounding", () => {
  assert.equal(
    calculate(
      p(100, 1, { discount: "percent", discountValue: "20" }),
    ).cash.number(),
    80,
  );
  assert.equal(
    calculate(
      p(100, 1, { discount: "fixed", discountValue: "20" }),
    ).cash.number(),
    80,
  );
  const bogo = calculate(p(100, 1, { discount: "bogo" }));
  assert.equal(bogo.quantity.number(), 2);
  assert.equal(bogo.cash.number(), 100);
  const r = comparePlanned(
    [
      p(100, 1, { discount: "multibuy", offerCount: "3", offerPrice: "200" }),
      p(75),
    ],
    "PHP",
    { target: "4", budget: "350" },
  );
  assert.equal(r.plans[0].packs, 2);
  assert.equal(r.plans[0].physicalPacks, 6);
  assert.equal(r.plans[0].checkout, 400);
  assert.equal(r.plans[0].leftover, 2);
  assert.equal(r.plans[0].affordable, false);
  assert.equal(r.plans[1].affordable, true);
});
test("tax duty fee deposit rebate and FX follow the stated order", () => {
  const v = calculate(
    p(100, 1, {
      currency: "USD",
      exchangeRate: "2",
      dutyPercent: "10",
      shipping: "5",
      taxPercent: "20",
      feePercent: "5",
      fixedFee: "3",
      deposit: "10",
      rebate: "7",
    }),
  );
  assert.equal(v.cash.number(), 315.8);
  assert.equal(v.net.number(), 281.8);
  assert.equal(v.breakdown.tax, 23);
  assert.equal(v.breakdown.percentageFee, 6.9);
});
test("waste yield consumption and independent basis use usable quantity", () => {
  const r = comparePlanned(
    [
      p(100, 1, { unit: "L", wastePercent: "20", yieldFactor: "4" }),
      p(100, 4, { unit: "L" }),
    ],
    "PHP",
    { basis: "1000", usage: "200" },
  );
  assert.deepEqual(r.totals, [3200, 4000]);
  assert.equal(r.plans[0].days, 16);
  assert.equal(r.rates[0], 31.25);
  for (const unit of ["sheet", "dose", "m", "m2"])
    assert.throws(() => comparePlanned([p(10), p(10, 1, { unit })]), /family/);
});
test("absent, blank and zero comparison bases use each family's default", () => {
  for (const { products, basis, rates, winners } of [
    {
      products: [p(149, 750, { unit: "ml" }), p(189, 1, { unit: "L" })],
      basis: 100,
      rates: [149 / 7.5, 18.9],
      winners: [1],
    },
    {
      products: [p(10, 5), p(12, 4)],
      basis: 1,
      rates: [2, 3],
      winners: [0],
    },
  ]) {
    for (const options of [{}, { basis: "" }, { basis: "0" }, { basis: "0.000000" }]) {
      const result = comparePlanned(products, "PHP", options);
      assert.equal(result.basis, basis);
      assert.deepEqual(result.rates, rates);
      assert.deepEqual(result.winners, winners);
    }
    const custom = comparePlanned(products, "PHP", { basis: "1000" });
    assert.equal(custom.basis, 1000);
    custom.rates.forEach((rate, index) =>
      assert.ok(Math.abs(rate - (rates[index] * 1000) / basis) < 1e-9),
    );
    assert.deepEqual(custom.winners, winners);
    for (const invalid of ["-1", "not-a-number", "1e2"])
      assert.throws(
        () => comparePlanned(products, "PHP", { basis: invalid }),
        /Comparison basis/,
      );
  }
});
test("cash and expected net rankings remain separate", () => {
  const r = comparePlanned(
    [p(100, 1, { rebate: "40", deposit: "10" }), p(80)],
    "PHP",
    { rank: "net" },
  );
  assert.deepEqual(r.winners, [0]);
  assert.deepEqual(r.prices, [110, 80]);
  assert.deepEqual(r.netPrices, [60, 80]);
});
test("break-even retains mandatory fees and fixed discount bounds", () => {
  const r = comparePlanned([p(100, 1, { shipping: "20" }), p(80)], "PHP");
  assert.equal(r.plans[0].breakEvenPrice, 60);
  const fixed = comparePlanned(
    [
      p(100, 1, { discount: "fixed", discountValue: "20", rebate: "30" }),
      p(40),
    ],
    "PHP",
    { rank: "net" },
  );
  assert.equal(fixed.plans[0].breakEvenPrice, 90);
});
test("cash break-even never recommends a price that invalidates the fixed rebate", () => {
  const products = [p(100, 1, { rebate: "90", deposit: "5" }), p(20)];
  assert.equal(comparePlanned(products).plans[0].breakEvenPrice, null);
  const feasible = comparePlanned([products[0], p(95)]).plans[0].breakEvenPrice;
  assert.equal(feasible, 90);
  assert.equal(calculate({ ...products[0], price: String(feasible) }).cash.number(), 95);
  const net = comparePlanned(products, "PHP", { rank: "net" });
  assert.equal(net.plans[0].breakEvenPrice, 100);
});
test("invalid values never silently produce a winner", () => {
  for (const data of [
    { price: "" },
    { wastePercent: "100" },
    { yieldFactor: "0" },
    { discount: "fixed", discountValue: "101" },
    { rebate: "101" },
    { taxPercent: "101" },
    { amount: "1e2" },
    { offerCount: "1.5", discount: "multibuy", offerPrice: "20" },
  ])
    assert.throws(() => calculate({ ...p(100), ...data }));
});
test("mixed optimizer finds combinations better than any single pack rounding", () => {
  const result = optimizeMix([p(7, 6), p(5, 4)], "PHP", "10");
  assert.deepEqual(result.counts, [1, 1]);
  assert.equal(result.cost, 12);
  assert.equal(result.leftover, 0);
  const oversized = optimizeMix([p(2, 100), p(5, 4)], "PHP", "10");
  assert.equal(oversized.cost, 2);
  assert.equal(oversized.quantity, 100);
  assert.throws(
    () => optimizeMix([p(1, ".000001"), p(2, "1")], "PHP", "1"),
    /30,000/,
  );
});
test("basket compares complete stores and applies delivery once", () => {
  const rows = [
    p(10, 1, { name: "A", store: "one", shipping: "99" }),
    p(20, 1, { name: "B", store: "one" }),
    p(12, 1, { name: "A", store: "two" }),
  ];
  const result = basketTotals(rows, "PHP", {
    one: { shipping: "5", minimum: "25", freeShipping: "30" },
    two: { shipping: "2", minimum: "20" },
  });
  assert.equal(result[0].total, 30);
  assert.equal(result[0].meetsMinimum, true);
  assert.deepEqual(result[1].missing, ["B"]);
  assert.equal(result[1].meetsMinimum, false);
});
test("basket store names normalize whitespace and blank names consistently", () => {
  const result = basketTotals([
    p(10, 1, { name: "A", store: " Market " }),
    p(20, 1, { name: "B", store: "Market" }),
    p(15, 1, { name: "A", store: "   " }),
  ], "PHP", { Market: { shipping: "5" }, "Unspecified store": { shipping: "2" } });
  assert.equal(result[0].store, "Market");
  assert.equal(result[0].total, 35);
  assert.equal(result[1].store, "Unspecified store");
  assert.equal(result[1].total, 17);
});
test("imports are bounded and spreadsheet exports cannot become formulas", () => {
  assert.throws(() => safeJSON('{"__proto__":{"polluted":true}}'), /key/);
  assert.throws(() => safeJSON(" ".repeat(250001)), /size/);
  assert.match(csvCell('=HYPERLINK("x")'), /^"'/);
  assert.match(csvCell(" \t@SUM(1)"), /^"'/);
  const doc = documentData({
    schemaVersion: 1,
    name: "One",
    currency: "PHP",
    products: [p(1), p(2)],
    options: {},
    credential: "do-not-export",
  });
  assert.equal(doc.credential, undefined);
  assert.throws(() => documentData({ ...doc, products: Array(25).fill(p(1)) }));
});
