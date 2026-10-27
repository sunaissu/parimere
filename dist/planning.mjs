import { UNITS } from "./math.mjs";

// Fractions keep discount, tax and FX comparisons exact.
const gcd = (a, b) => {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a < 0n ? -a : a;
};
export class Fraction {
  constructor(n, d = 1n) {
    if (!d) throw new Error("Division by zero.");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }
  add(v) {
    return new Fraction(this.n * v.d + v.n * this.d, this.d * v.d);
  }
  sub(v) {
    return new Fraction(this.n * v.d - v.n * this.d, this.d * v.d);
  }
  mul(v) {
    return new Fraction(this.n * v.n, this.d * v.d);
  }
  div(v) {
    return new Fraction(this.n * v.d, this.d * v.n);
  }
  cmp(v) {
    const d = this.n * v.d - v.n * this.d;
    return d === 0n ? 0 : d < 0n ? -1 : 1;
  }
  number() {
    return Number(this.n) / Number(this.d);
  }
  ceil() {
    return (this.n + this.d - 1n) / this.d;
  }
}
const zero = new Fraction(0n),
  one = new Fraction(1n),
  hundred = new Fraction(100n);
export function decimal(value, label = "Value", fallback = "0", digits = 6) {
  const text = String(value == null || value === "" ? fallback : value).trim();
  if (
    text.length > 32 ||
    !new RegExp(
      "^(?:\\d+(?:\\.\\d{0," + digits + "})?|\\.\\d{1," + digits + "})$",
    ).test(text)
  )
    throw new Error(
      label +
        " needs a non-negative decimal with at most " +
        digits +
        " places.",
    );
  const [a = "0", b = ""] = text.split("."),
    v = new Fraction(BigInt((a || "0") + b), 10n ** BigInt(b.length));
  if (v.cmp(new Fraction(1000000000n)) > 0)
    throw new Error(label + " must not exceed one billion.");
  return v;
}
const positive = (v, label) => {
  if (v.cmp(zero) <= 0) throw new Error(label + " must be greater than zero.");
  return v;
};
const integer = (v, label, max = 1000000) => {
  const n = positive(decimal(v, label, "1"), label);
  if (n.d !== 1n || n.n > BigInt(max))
    throw new Error(label + " needs a whole number up to " + max + ".");
  return n;
};
const percent = (v, label) => {
  const n = decimal(v, label);
  if (n.cmp(hundred) > 0)
    throw new Error(label + " must be between 0 and 100.");
  return n.div(hundred);
};
const code = (v) => {
  if (typeof v !== "string" || !/^[A-Z]{3}$/.test(v))
    throw new Error("Choose a three-letter currency.");
  return v;
};
export const FAMILIES = {
  weight: { unit: "g", basis: 100 },
  volume: { unit: "mL", basis: 100 },
  count: { unit: "item", basis: 1 },
  length: { unit: "m", basis: 1 },
  area: { unit: "m²", basis: 1 },
  sheet: { unit: "sheet", basis: 1 },
  dose: { unit: "dose", basis: 1 },
};
export const MEASURES = {
  ...UNITS,
  m: { family: "length", factor: "1" },
  cm: { family: "length", factor: ".01" },
  ft: { family: "length", factor: ".3048" },
  m2: { family: "area", factor: "1" },
  ft2: { family: "area", factor: ".09290304" },
  sheet: { family: "sheet", factor: "1" },
  dose: { family: "dose", factor: "1" },
};

export function calculate(product, base = "PHP") {
  code(base);
  if (!product || !Object.hasOwn(MEASURES, product.unit))
    throw new Error("Choose a supported unit.");
  const currency = code(product.currency || base),
    rate =
      currency === base
        ? one
        : positive(
            decimal(product.exchangeRate, "Exchange rate", "", 10),
            "Exchange rate",
          );
  const price = decimal(product.price, "Price", ""),
    amount = positive(decimal(product.amount, "Size", ""), "Size"),
    pack = integer(product.pack, "Pack count");
  let goods = price,
    bundle = one;
  const discount = product.discount || "none";
  if (discount === "percent")
    goods = price.mul(one.sub(percent(product.discountValue, "Discount")));
  else if (discount === "fixed") {
    goods = price.sub(decimal(product.discountValue, "Discount"));
    if (goods.cmp(zero) < 0)
      throw new Error("Fixed discount exceeds the pack price.");
  } else if (discount === "bogo") bundle = new Fraction(2n);
  else if (discount === "multibuy") {
    bundle = integer(product.offerCount, "Offer pack count", 1000);
    goods = decimal(product.offerPrice, "Offer total", "");
  } else if (discount !== "none")
    throw new Error("Choose a supported discount rule.");
  const shipping = decimal(product.shipping, "Shipping"),
    tax = percent(product.taxPercent, "Tax"),
    duty = percent(product.dutyPercent, "Duty"),
    fee = percent(product.feePercent, "Payment fee"),
    fixed = decimal(product.fixedFee, "Fixed fee"),
    deposit = decimal(product.deposit, "Refundable deposit");
  // Tax includes duty and shipping; fee includes tax but excludes the refundable deposit.
  const dutyCost = goods.mul(duty),
    taxable = goods.add(dutyCost).add(shipping),
    taxCost = taxable.mul(tax),
    beforeFee = taxable.add(taxCost),
    feeCost = beforeFee.mul(fee),
    beforeFX = beforeFee.add(feeCost).add(fixed).add(deposit);
  const cash = beforeFX.mul(rate),
    rebate = decimal(product.rebate, "Rebate");
  if (rebate.cmp(beforeFX.sub(deposit)) > 0)
    throw new Error("Rebate exceeds non-refundable checkout cost.");
  const net = beforeFX.sub(deposit).sub(rebate).mul(rate),
    usable = one.sub(percent(product.wastePercent, "Waste")),
    yieldFactor = positive(
      decimal(product.yieldFactor, "Prepared yield", "1"),
      "Prepared yield",
    );
  const raw = amount
      .mul(pack)
      .mul(decimal(MEASURES[product.unit].factor, "Unit factor", "", 12))
      .mul(bundle),
    quantity = positive(raw.mul(usable).mul(yieldFactor), "Usable quantity");
  return {
    cash,
    net,
    quantity,
    raw,
    goods,
    rate,
    bundle,
    family: MEASURES[product.unit].family,
    breakdown: {
      currency,
      exchangeRate: rate.number(),
      originalPrice: price.number(),
      discountedGoods: goods.number(),
      shipping: shipping.number(),
      duty: dutyCost.number(),
      tax: taxCost.number(),
      percentageFee: feeCost.number(),
      feePercent: fee.mul(hundred).number(),
      fixedFee: fixed.number(),
      deposit: deposit.number(),
      rebate: rebate.number(),
      totalBeforeConversion: beforeFX.number(),
      convertedTotal: cash.number(),
      afterRebate: net.number(),
      offerPacks: bundle.number(),
      yieldFactor: yieldFactor.number(),
      wastePercent: one.sub(usable).mul(hundred).number(),
    },
  };
}

export function comparePlanned(products, base = "PHP", options = {}) {
  if (!Array.isArray(products) || products.length < 2 || products.length > 24)
    throw new Error("Compare between 2 and 24 products.");
  const values = products.map((p) => calculate(p, base)),
    family = values[0].family;
  if (values.some((v) => v.family !== family))
    throw new Error(
      "Use one measurement family. Sheets, doses, length, area, volume, weight and items stay separate.",
    );
  const requestedBasis = decimal(
      options.basis,
      "Comparison basis",
      String(FAMILIES[family].basis),
    ),
    // Zero preserves the automatic basis in older saved comparisons.
    basis = requestedBasis.n
      ? requestedBasis
      : new Fraction(BigInt(FAMILIES[family].basis)),
    costs = values.map((v) => (options.rank === "net" ? v.net : v.cash)),
    compare = (a, b) =>
      costs[a].div(values[a].quantity).cmp(costs[b].div(values[b].quantity));
  const order = values.map((_, i) => i).sort(compare),
    winners = order.filter((i) => compare(i, order[0]) === 0),
    best = costs[order[0]].div(values[order[0]].quantity),
    next = costs[order[1]].div(values[order[1]].quantity);
  const target = decimal(options.target, "Target quantity"),
    budget =
      options.budget === "" || options.budget == null
        ? null
        : decimal(options.budget, "Budget"),
    usage = decimal(options.usage, "Daily usage");
  return {
    order,
    winners,
    percent: next.n ? next.sub(best).div(next).number() * 100 : 0,
    rates: values.map((v, i) => costs[i].div(v.quantity).mul(basis).number()),
    totals: values.map((v) => v.quantity.number()),
    prices: values.map((v) => v.cash.number()),
    netPrices: values.map((v) => v.net.number()),
    breakdowns: values.map((v) => v.breakdown),
    baseCurrency: base,
    basis: basis.number(),
    basisLabel: basis.number() + " " + FAMILIES[family].unit,
    baseUnit: FAMILIES[family].unit,
    family,
    plans: values.map((v, i) => {
      const packs = target.n ? target.div(v.quantity).ceil() : 1n,
        n = new Fraction(packs),
        cash = v.cash.mul(n);
      return {
        packs: Number(packs),
        physicalPacks: Number(packs) * v.bundle.number(),
        checkout: cash.number(),
        afterRebate: v.net.mul(n).number(),
        leftover: target.n ? v.quantity.mul(n).sub(target).number() : 0,
        affordable: budget === null ? null : cash.cmp(budget) <= 0,
        days: usage.n ? v.quantity.div(usage).number() : null,
        breakEvenCash: best.mul(v.quantity).number(),
        breakEvenPrice: breakEvenPrice(
          products[i],
          base,
          best.mul(v.quantity),
          options.rank === "net",
        ),
        fxThreshold:
          v.breakdown.currency !== base && costs[i].n
            ? order
                .filter((index) => index !== i)
                .map((index) => costs[index].div(values[index].quantity))
                .sort((a, b) => a.cmp(b))[0]
                .mul(v.quantity)
                .div(costs[i].div(v.rate))
                .number()
            : null,
      };
    }),
  };
}
// Hold other costs fixed when solving for the shelf/offer price.
function breakEvenPrice(product, base, target, net) {
  const key = product.discount === "multibuy" ? "offerPrice" : "price",
    minimum =
      product.discount === "fixed"
        ? decimal(product.discountValue, "Discount")
        : zero;
  const p = { ...product, rebate: "0" },
    low = { ...p, [key]: minimum.number().toFixed(6) },
    rate = calculate(product, base).rate;
  const a = calculate(low, base)[net ? "net" : "cash"],
    slope = one
      .add(percent(product.dutyPercent, "Duty"))
      .mul(one.add(percent(product.taxPercent, "Tax")))
      .mul(one.add(percent(product.feePercent, "Fee")))
      .mul(rate)
      .mul(
        product.discount === "percent"
          ? one.sub(percent(product.discountValue, "Discount"))
          : one,
      ),
    rebate = net ? decimal(product.rebate, "Rebate").mul(rate) : zero;
  if (!slope.n) return null;
  const price = target.sub(a).add(rebate).div(slope).add(minimum);
  // Keep the suggested price valid for the entered rebate and deposit.
  if (!net && target.cmp(decimal(product.deposit, "Deposit")
    .add(decimal(product.rebate, "Rebate")).mul(rate)) < 0) return null;
  return price.cmp(minimum) < 0 ? null : price.number();
}

export function optimizeMix(products, base, targetValue) {
  if (products.length < 2 || products.length > 12)
    throw new Error("Optimize between 2 and 12 alternatives.");
  const values = products.map((p) => calculate(p, base));
  if (values.some((v) => v.family !== values[0].family))
    throw new Error("Mixed packs must use matching measurement families.");
  const target = positive(decimal(targetValue, "Target"), "Target");
  let scale = target.d;
  for (const v of values)
    scale = (scale / gcd(scale, v.quantity.d)) * v.quantity.d;
  let quantities = values.map((v) => v.quantity.n * (scale / v.quantity.d)),
    goal = target.n * (scale / target.d),
    step = quantities.reduce(gcd);
  goal = (goal + step - 1n) / step;
  quantities = quantities.map((v) => v / step);
  const relevant = quantities.map((q) => (q > goal ? goal : q)),
    limit = Number(goal + relevant.reduce((a, b) => (a > b ? a : b)) - 1n);
  if (limit > 30000)
    throw new Error(
      "The exact optimizer needs at most 30,000 quantity steps. Use larger quantity increments or a smaller target.",
    );
  const dp = Array(limit + 1).fill(null);
  dp[0] = { cost: zero, previous: -1, index: -1 };
  for (let amount = 0; amount <= limit; amount++) {
    if (!dp[amount]) continue;
    for (let i = 0; i < values.length; i++) {
      const next = Math.min(limit, amount + Number(relevant[i]));
      if (next <= amount) continue;
      const cost = dp[amount].cost.add(values[i].cash);
      if (!dp[next] || cost.cmp(dp[next].cost) < 0)
        dp[next] = { cost, previous: amount, index: i };
    }
  }
  let at = -1;
  for (let i = Number(goal); i <= limit; i++)
    if (dp[i] && (at < 0 || dp[i].cost.cmp(dp[at].cost) < 0)) at = i;
  if (at < 0) throw new Error("No feasible combination.");
  const cost = dp[at].cost,
    counts = values.map(() => 0);
  while (at > 0) {
    counts[dp[at].index]++;
    at = dp[at].previous;
  }
  const quantity = values.reduce(
    (sum, v, i) => sum.add(v.quantity.mul(new Fraction(BigInt(counts[i])))),
    zero,
  );
  return {
    counts,
    cost: cost.number(),
    quantity: quantity.number(),
    leftover: quantity.sub(target).number(),
  };
}

export function basketTotals(products, base, settings = {}) {
  const stores = new Map();
  for (const p of products) {
    const store = (p.store || "").trim() || "Unspecified store",
      key = (p.basketItem || p.name || "").trim();
    if (!key)
      throw new Error("Give every basket item a name or matching item key.");
    const quantity = integer(p.basketCount || "1", "Basket count", 1000),
      v = calculate({ ...p, shipping: "0" }, base),
      rows = stores.get(store) || [];
    rows.push({
      key,
      cash: v.cash.mul(quantity),
      goods: v.goods.mul(v.rate).mul(quantity),
    });
    stores.set(store, rows);
  }
  const required = [
    ...new Set([...stores.values()].flatMap((rows) => rows.map((r) => r.key))),
  ];
  return [...stores].map(([store, rows]) => {
    if (new Set(rows.map((r) => r.key)).size !== rows.length)
      throw new Error(
        "Each store must contain one offer for each basket item key.",
      );
    const config = settings[store] || {},
      subtotal = rows.reduce((s, r) => s.add(r.cash), zero),
      goods = rows.reduce((s, r) => s.add(r.goods), zero),
      shipping = decimal(config.shipping, "Store delivery"),
      minimum = decimal(config.minimum, "Minimum order"),
      free = decimal(config.freeShipping, "Free delivery threshold");
    return {
      store,
      missing: required.filter((key) => !rows.some((r) => r.key === key)),
      meetsMinimum: goods.cmp(minimum) >= 0,
      subtotal: subtotal.number(),
      delivery: free.n && goods.cmp(free) >= 0 ? 0 : shipping.number(),
      total: subtotal
        .add(free.n && goods.cmp(free) >= 0 ? zero : shipping)
        .number(),
    };
  });
}
