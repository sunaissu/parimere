import { comparePlanned } from "./planning.mjs";
import { createWorkspace, extendTemplate, EXTRA_FIELDS } from "./workspace.mjs";
import { readLocal, writeLocal, localDataErased } from "./storage.mjs";
import { isNative } from "./platform.mjs";
import { browserCurrency } from "./default-currency.mjs";
const $ = (id) => document.getElementById(id);
const fields = [
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
];
const form = $("compare-form"),
  arena = $("arena"),
  template = $("product-template");
const desktopLayout = window.matchMedia("(min-width: 1000px)");
const showDesktopRanking = () => { $("ranking").open = desktopLayout.matches; };
showDesktopRanking();
desktopLayout.addEventListener("change", showDesktopRanking);
extendTemplate(template);
fields.push(...EXTRA_FIELDS.map((row) => row[0]));
const examples = {
  international: [
    {
      name: "Local bottle",
      price: "740",
      amount: "1",
      unit: "L",
      pack: "1",
      currency: "PHP",
    },
    {
      name: "Imported bottle",
      price: "10",
      amount: "1",
      unit: "L",
      pack: "1",
      currency: "USD",
      shipping: "2",
      feePercent: "3",
      fixedFee: ".5",
    },
  ],

  milk: [
    {
      name: "Little bottle",
      price: "149",
      amount: "750",
      unit: "ml",
      pack: "1",
    },
    { name: "Big bottle", price: "189", amount: "1", unit: "L", pack: "1" },
  ],
  rice: [
    { name: "Everyday bag", price: "68", amount: "1", unit: "kg", pack: "1" },
    { name: "Big rice bag", price: "315", amount: "5", unit: "kg", pack: "1" },
  ],
  snacks: [
    {
      name: "Six little bags",
      price: "90",
      amount: "25",
      unit: "g",
      pack: "6",
    },
    { name: "One big bag", price: "110", amount: "200", unit: "g", pack: "1" },
    { name: "Party pack", price: "150", amount: "300", unit: "g", pack: "1" },
  ],
};
const rateCache = new Map();
try {
  const cached = readLocal("rates", []);
  if (Array.isArray(cached))
    for (const [pair, value] of cached.slice(0, 100))
      if (
        typeof pair === "string" &&
        value &&
        Number.isFinite(value.fetchedAt) &&
        Number(value.rate) > 0 &&
        typeof value.date === "string"
      )
        rateCache.set(pair, value);
} catch {}
const rateRequests = new Map();
async function fetchRate(source, base, refresh = false) {
  if (isNative) throw new Error("Enter an exchange rate for this offline Android app.");
  const pair = source + "/" + base;
  const cached = rateCache.get(pair);
  if (
    !refresh && cached &&
    cached.fetchedAt <= Date.now() &&
    Date.now() - cached.fetchedAt < 3600000 &&
    Date.now() - Date.parse(cached.date + "T00:00:00Z") <= 7 * 86400000
  )
    return cached;
  if (rateRequests.has(pair)) return rateRequests.get(pair);
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(
        "https://api.frankfurter.dev/v2/rate/" + pair,
        {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        },
      );
      if (!response.ok) throw new Error("Rate unavailable");
      const data = await response.json();
      const date = Date.parse(data.date + "T00:00:00Z");
      if (
        data.base !== source ||
        data.quote !== base ||
        typeof data.rate !== "number" ||
        !Number.isFinite(data.rate) ||
        data.rate <= 0 ||
        data.rate > 1000000000 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
        !Number.isFinite(date) ||
        new Date(date).toISOString().slice(0, 10) !== data.date ||
        date > Date.now() + 86400000 ||
        Date.now() - date > 7 * 86400000
      ) {
        throw new Error("No recent rate available");
      }
      const rate = data.rate.toFixed(10).replace(/\.?0+$/, "");
      if (Number(rate) <= 0) throw new Error("Rate too small");
      const result = { rate, date: data.date, fetchedAt: Date.now() };
      rateCache.set(pair, result);
      try {
        writeLocal("rates", [...rateCache].slice(-100));
      } catch {}
      return result;
    } finally {
      clearTimeout(timeout);
    }
  })();
  rateRequests.set(pair, request);
  try {
    return await request;
  } finally {
    rateRequests.delete(pair);
  }
}
function resetRate(card) {
  card.fx = { pair: "", mode: isNative ? "manual" : "auto", status: "idle" };
  card.inputs.exchangeRate.value = "";
}
function updateRate(card, source, base) {
  const pair = source + "/" + base;
  if (card.fx.pair !== pair) {
    resetRate(card);
    card.fx.pair = pair;
  }
  const state = card.fx;
  const foreign = source !== base;
  if (foreign && state.mode === "auto" && state.status === "idle") {
    state.status = "loading";
    fetchRate(source, base)
      .then((data) => {
        if (card.fx !== state || !cards.includes(card)) return;
        state.status = "ready";
        state.date = data.date;
        card.inputs.exchangeRate.value = data.rate;
        render();
      })
      .catch(() => {
        if (card.fx !== state || !cards.includes(card)) return;
        state.status = "error";
        render();
      });
  }
  card.inputs.exchangeRate.readOnly = state.mode !== "manual";
  card.inputs.exchangeRate.placeholder =
    state.status === "loading" ? "Loading…" : "Enter rate";
  const status = card.element.querySelector(".rate-status");
  status.textContent =
    state.mode === "saved"
      ? "Saved rate · " +
        state.date +
        ". Not refreshed. Choose an automatic rate to update it."
      : state.mode === "manual"
        ? "Your rate. Enter the quote from your bank or payment provider."
        : state.status === "loading"
          ? "Fetching the latest daily rate…"
          : state.status === "ready"
            ? "Daily rate · " +
              state.date +
              " · Frankfurter. Your bank may charge a different rate."
            : "Couldn’t get a recent rate. Retry or use your own rate.";
  card.element.querySelector(".rate-mode").textContent =
    state.mode === "manual" ? "Use automatic rate" : "Use my own rate";
  card.element.querySelector(".rate-mode").hidden = isNative;
  card.element.querySelector(".retry-rate").hidden =
    isNative || state.mode === "manual" || state.status === "loading";
  card.element.querySelector(".retry-rate").textContent = "Refresh daily rate";
}

let nextId = 0,
  timer;
let cards = [];
const numeric = (n) =>
  new Intl.NumberFormat(workspace?.locale(), {
    maximumFractionDigits: 10,
  }).format(n);

const money = (value, currency = $("currency").value) => {
  const format = new Intl.NumberFormat(workspace?.locale(), {
    style: "currency",
    currency,
    currencyDisplay: "code",
  });
  const minorDigits = format.resolvedOptions().maximumFractionDigits;
  const tiny = value > 0 && value < 0.000001;
  return (
    (tiny ? "< " : "") +
    new Intl.NumberFormat(workspace?.locale(), {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: minorDigits,
      maximumFractionDigits:
        value > 0 && value < 0.01 ? Math.max(6, minorDigits) : minorDigits,
    }).format(tiny ? 0.000001 : value)
  );
};
const commonCurrencies = [
  "PHP",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "HKD",
  "SGD",
  "INR",
  "IDR",
  "KRW",
  "MYR",
  "THB",
  "VND",
  "AED",
  "SAR",
  "NZD",
];
const availableCurrencies =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("currency")
    : commonCurrencies;
const currencies = [...new Set([...commonCurrencies, ...availableCurrencies])];
function currencyOptions(select, selected) {
  select.replaceChildren(
    ...currencies.map((currency) => new Option(currency, currency)),
  );
  select.value = selected;
}
currencyOptions($("currency"), browserCurrency());
function letter(index) {
  let text = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    text = String.fromCharCode(65 + ((n - 1) % 26)) + text;
  return text;
}
function read(card) {
  return {
    ...Object.fromEntries(fields.map((key) => [key, card.inputs[key].value])),
    fx: { mode: card.fx.mode, pair: card.fx.pair, date: card.fx.date || "" },
  };
}
function name(index) {
  return cards[index].inputs.name.value.trim() || "Pack " + letter(index);
}
function createCard(values) {
  const element = template.content.firstElementChild.cloneNode(true);
  const id = "product-" + nextId++;
  const inputs = {};
  currencyOptions(
    element.querySelector("#a-currency"),
    values.currency || $("currency").value,
  );
  for (const key of fields) {
    const input = element.querySelector("#a-" + key);
    element.querySelector('label[for="a-' + key + '"]').htmlFor =
      id + "-" + key;
    input.id = id + "-" + key;
    input.value =
      values[key] ??
      (key === "currency"
        ? $("currency").value
        : key === "discount"
          ? "none"
          : ["yieldFactor", "offerCount", "basketCount"].includes(key)
            ? "1"
            : "");

    inputs[key] = input;
  }
  element.querySelector("#a-total").removeAttribute("id");
  element.querySelector("#a-rate").removeAttribute("id");
  const card = {
    element,
    inputs,
    total:
      element.querySelector("#a-total") ||
      element.querySelector(".unit-result>span:not(.converted-total)"),
    convertedTotal: element.querySelector(".converted-total"),

    rate: element.querySelector(".unit-result>strong"),
  };

  resetRate(card);
  if (
    (!values.fx || values.fx.pair === inputs.currency.value + "/" + $("currency").value) &&
    values.exchangeRate
  ) {
    card.fx = {
      pair: inputs.currency.value + "/" + $("currency").value,
      mode: isNative || !values.fx || values.fx.mode === "manual" ? "manual" : "saved",
      status: "ready",
      date: values.fx?.date || "",
    };
    inputs.exchangeRate.value = values.exchangeRate;
  }
  workspace.card(card);
  inputs.currency.addEventListener("change", () => resetRate(card));
  element.querySelector(".rate-mode").addEventListener("click", () => {
    if (card.fx.mode !== "manual") {
      card.fx = { pair: card.fx.pair, mode: "manual", status: "ready" };
    } else {
      resetRate(card);
    }
    render();
    if (card.fx.mode === "manual") inputs.exchangeRate.focus();
  });
  element.querySelector(".retry-rate").addEventListener("click", () => {
    resetRate(card);
    render();
  });
  element.querySelector(".remove-product").addEventListener("click", () => {
    if (cards.length <= 2) return;
    workspace.remember();
    const index = cards.indexOf(card);
    cards.splice(index, 1);
    element.remove();
    render();
    cards[Math.min(index, cards.length - 1)].inputs.price.focus();
  });
  cards.push(card);
  arena.append(element);
  return card;
}
function fill(values) {
  clearTimeout(timer);
  cards.forEach((card) => card.element.remove());
  cards = [];
  $("currency-notice").hidden = true;
  values.forEach(createCard);
  render();
}
function empty(unit = "ml") {
  return { name: "", price: "", amount: "", unit, pack: "1" };
}
function render() {
  if (localDataErased()) return;
  renderExchangePanel();
  clearTimeout(timer);
  $("verdict").setAttribute("aria-busy", "false");
  cards.forEach((card, i) => {
    card.element.querySelector(".letter").textContent = letter(i);
    card.element.querySelector(".contender-title").textContent = name(i);
    card.element.classList.toggle("product-a", i % 2 === 0);
    card.element.classList.toggle("product-b", i % 2 === 1);
    card.element.classList.remove("best-value");

    const base = $("currency").value;
    const source = card.inputs.currency.value;
    const foreign = source !== base;
    updateRate(card, source, base);
    card.element.querySelector(".currency-symbol").textContent = source;
    card.element.querySelector(".exchange").hidden = !foreign;
    card.inputs.exchangeRate.required = foreign;
    card.inputs.exchangeRate.disabled = !foreign;
    card.element.querySelector(".exchange-from").textContent =
      "1 " + source + " =";
    card.element.querySelector(".exchange-to").textContent = base;
    card.element.querySelector(
      'label[for="' + card.inputs.exchangeRate.id + '"]',
    ).textContent = "Exchange rate · " + source + " to " + base;
    card.element.querySelector(".extras-currency").textContent = source;
    for (const [key, label] of [
      ["shipping", "Shipping"],
      ["fixedFee", "Fixed fee / other costs"],
    ]) {
      card.element.querySelector(
        'label[for="' + card.inputs[key].id + '"]',
      ).textContent = label + " (" + source + ")";
    }
    const hasExtras = ["shipping", "feePercent", "fixedFee"].some(
      (key) => card.inputs[key].value.trim() !== "",
    );
    card.element.querySelector(".extras-summary").textContent = hasExtras
      ? "· included"
      : "";
    const adjustments = [];
    if (Number(card.inputs.pack.value) > 1)
      adjustments.push(card.inputs.pack.value + " in pack");
    if (foreign) adjustments.push(source);
    if (card.inputs.discount.value !== "none") adjustments.push("offer");
    if (hasExtras || ["taxPercent", "dutyPercent", "deposit", "rebate"].some(
      (key) => Number(card.inputs[key].value) > 0,
    )) adjustments.push("costs");
    if (Number(card.inputs.wastePercent.value) > 0 ||
      Number(card.inputs.yieldFactor.value || 1) !== 1)
      adjustments.push("adjusted quantity");
    card.element.querySelector(".pack-options-summary").textContent =
      adjustments.length ? " · " + adjustments.join(", ") : "";
    const discount = card.inputs.discount.value;
    card.inputs.discountValue.closest(".field").hidden =
      !["percent", "fixed"].includes(discount);
    for (const key of ["offerCount", "offerPrice"])
      card.inputs[key].closest(".field").hidden = discount !== "multibuy";
    card.element.querySelector('label[for="' + card.inputs.amount.id + '"]').textContent =
      Number(card.inputs.pack.value) > 1 ? "Size of each item" : "Size";

    const button = card.element.querySelector(".remove-product");
    button.disabled = cards.length <= 2;
    button.hidden = cards.length <= 2;
    button.setAttribute("aria-label", "Remove contender " + letter(i));
  });
  $("product-count").textContent = cards.length + " products";
  $("product-count").hidden = cards.length <= 2;
  try {
    const pending = cards.find(
      (card) =>
        card.inputs.currency.value !== $("currency").value &&
        card.fx.mode === "auto" &&
        card.fx.status !== "ready",
    );
    if (pending)
      throw new Error(
        pending.fx.status === "loading"
          ? "Fetching exchange rates… Your comparison will update automatically."
          : "An exchange rate is unavailable. Retry on that product or use your own rate.",
      );
    const result = comparePlanned(
      cards.map(read),
      $("currency").value,
      workspace.options(),
    );
    workspace.result(result);
    const tied = result.winners.length > 1;
    const percent =
      result.percent > 0 && result.percent < 0.01
        ? "<0.01"
        : result.percent.toFixed(2);
    $("verdict").classList.remove("waiting");
    cards.forEach((card, i) => {
      card.convertedTotal.textContent = "Total: " + money(result.prices[i]);
      card.convertedTotal.hidden = card.inputs.currency.value === $("currency").value &&
        result.prices[i] === Number(card.inputs.price.value);
      card.total.textContent =
        numeric(result.totals[i]) + " " + result.baseUnit + " total";
      card.rate.replaceChildren(
        document.createTextNode(money(result.rates[i]) + " "),
      );
      const small = document.createElement("small");
      small.textContent = "/ " + result.basisLabel;
      card.rate.append(small);
      card.element.classList.toggle("best-value", result.winners.includes(i));
    });
    $("result-label").textContent = (tied ? "SHARED BEST VALUE" : "BEST VALUE") +
      (workspace.options().rank === "net" ? " · AFTER REFUNDS" : "");
    $("winner-heading").textContent = tied
      ? result.winners.length === cards.length
        ? "It’s a tie. Pick your pack."
        : result.winners.length + " packs share the win."
      : name(result.winners[0]) + " wins.";
    $("result-detail").textContent = tied
      ? "Same lowest unit price: " + result.winners.map(name).join(", ") + "."
      : percent +
        "% cheaper per unit than " +
        name(result.order[1]) +
        ", the next best option.";
    $("saving-value").replaceChildren(
      document.createTextNode(tied ? "=" : percent),
    );
    if (!tied) {
      const span = document.createElement("span");
      span.textContent = "%";
      $("saving-value").append(span);
    }
    $("saving-label").textContent = tied ? "SAME BEST VALUE" : "VS. NEXT BEST";
    $("ranking").hidden = false;
    $("ranking-list").replaceChildren();
    result.order.forEach((i) => {
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = letter(i) + " · " + name(i);
      const price = document.createElement("strong");
      price.textContent = money(result.rates[i]) + " / " + result.basisLabel;
      row.append(label, price);
      if (result.winners.includes(i)) {
        row.className = "rank-winner";
        const badge = document.createElement("span");
        badge.className = "winner-badge";
        badge.textContent = "Best value";
        row.append(badge);
      }
      $("ranking-list").append(row);
    });
    $("math-content").replaceChildren();

    cards.forEach((card, i) => {
      const breakdown = result.breakdowns[i];
      const row = document.createElement("p");
      const conversion = document.createElement("p");
      const source = breakdown.currency;
      row.textContent =
        letter(i) +
        " · " +
        name(i) +
        ": (" +
        money(breakdown.originalPrice, source) +
        " + " +
        money(breakdown.shipping, source) +
        " shipping) × (1 + " +
        numeric(breakdown.feePercent) +
        " ÷ 100) + " +
        money(breakdown.fixedFee, source) +
        " fixed costs = " +
        money(breakdown.totalBeforeConversion, source) +
        ".";
      conversion.textContent =
        source === $("currency").value
          ? "Total " + money(result.prices[i]) + "."
          : (card.fx.mode === "manual"
              ? "Your rate: 1 "
              : (card.fx.mode === "saved" ? "Saved rate (" : "Daily rate (") + card.fx.date + "): 1 ") +
            source +
            " = " +
            numeric(breakdown.exchangeRate) +
            " " +
            $("currency").value +
            ". Converted total: " +
            money(result.prices[i]) +
            ".";
      row.textContent =
        name(i) +
        ": goods after offer " +
        money(breakdown.discountedGoods, source) +
        " + duty " +
        money(breakdown.duty, source) +
        " + shipping " +
        money(breakdown.shipping, source) +
        " + tax " +
        money(breakdown.tax, source) +
        " + payment fee " +
        money(breakdown.percentageFee, source) +
        " + fixed costs " +
        money(breakdown.fixedFee, source) +
        " + refundable deposit " +
        money(breakdown.deposit, source) +
        " = checkout " +
        money(breakdown.totalBeforeConversion, source) +
        ". Expected rebate " +
        money(breakdown.rebate, source) +
        ". Waste " +
        numeric(breakdown.wastePercent) +
        "%; prepared yield " +
        numeric(breakdown.yieldFactor) +
        "×. Rate: " +
        (card.fx.mode || "same currency") +
        " " +
        (card.fx.date || "") +
        ".";
      const unitPrice = document.createElement("p");
      unitPrice.textContent =
        money(
          workspace.options().rank === "net"
            ? result.netPrices[i]
            : result.prices[i],
        ) +
        " ÷ " +
        numeric(result.totals[i]) +
        " " +
        result.baseUnit +
        " × " +
        result.basis +
        " = " +
        money(result.rates[i]) +
        " / " +
        result.basisLabel +
        ".";
      $("math-content").append(row, conversion, unitPrice);
    });
    const orderNote = document.createElement("p");
    orderNote.textContent =
      "Calculation order: offer price → duty on goods → add shipping → tax on goods + duty + shipping → payment fee on taxed subtotal → fixed fee → deposit → FX. Expected net subtracts deposit and entered rebate before FX. Target quantities repeat the entire offer and its costs.";
    $("math-content").append(orderNote);
    const note = document.createElement("p");
    note.textContent = tied
      ? "The winning unit prices are exactly equal."
      : "Savings = (next-best unit price − winning unit price) ÷ next-best unit price × 100 = " +
        percent +
        "%.";
    $("math-content").append(note);
    const checkout = document.createElement("p");
    checkout.textContent =
      "At checkout: " +
      cards
        .map((_, i) => name(i) + " costs " + money(result.prices[i]))
        .join("; ") +
      ". Savings compare equal amounts, not different pack totals.";
    $("math-content").append(checkout);
  } catch (error) {
    workspace.result(null);
    $("verdict").classList.add("waiting");
    $("result-label").textContent = "CHECK YOUR ENTRIES";
    $("winner-heading").textContent = "Check the pack details.";
    $("result-detail").textContent = error.message;
    cards.forEach((card) => {
      card.rate.textContent = "—";
      card.convertedTotal.textContent = "";
      card.total.textContent = "Complete all products to compare";
    });
    $("ranking").hidden = true;
    $("ranking-list").replaceChildren();
    $("math-content").textContent =
      "Complete every product, or remove any extras, to see the calculation.";
  }
}
form.addEventListener("input", () => {
  workspace.invalidateOptimization();
  clearTimeout(timer);
  timer = setTimeout(render, 180);
});
form.addEventListener("change", render);
form.addEventListener("submit", (e) => {
  e.preventDefault();
  render();
});
$("currency").addEventListener("change", () => {
  const cleared = workspace.currencyChanged($("currency").value, true);
  cards.forEach(resetRate);
  const foreign = cards.some(
    (card) => card.inputs.currency.value !== $("currency").value,
  );
  $("currency-notice").hidden = !foreign;
  $("currency-notice").textContent =
    "Results are now in " +
    $("currency").value +
    ". Product prices and costs keep their original currencies. " +
    (isNative ? "Enter your exchange rates for foreign products." : "Exchange rates update automatically.") + cleared;
  if (cleared) $("currency-notice").hidden = false;
  render();
});
document.querySelectorAll("[data-example]").forEach((button) =>
  button.addEventListener("click", () => {
    const international = button.dataset.example === "international";
    if (international) {
      workspace.currencyChanged("PHP");
      $("currency").value = "PHP";
    }
    workspace.remember();
    fill(examples[button.dataset.example]);
    if (international) {
      $("currency-notice").hidden = false;
      $("currency-notice").textContent =
        isNative ? "Sample prices and fees. Enter your exchange rate to compare." :
          "Sample prices and fees, with the latest available daily exchange rate.";
    }
  }),
);
$("add-product").addEventListener("click", () => {
  if (cards.length >= 24) {
    workspace.message("Compare at most 24 products.");
    return;
  }
  workspace.remember();
  const card = createCard(empty(cards[0]?.inputs.unit.value || "ml"));
  render();
  card.inputs.price.focus();
});
$("reset").addEventListener("click", () => {
  workspace.remember();
  fill([empty(), empty()]);
  cards[0].inputs.price.focus();
});
let exchangeBase = "", exchangeRequest = 0;
const exchangePanel = $("exchange-panel");
exchangePanel.hidden = isNative;
async function renderExchangePanel(refresh = false) {
  if (isNative || localDataErased()) return;
  const base = $("currency").value;
  $("exchange-base").textContent = "in " + base;
  if (!exchangePanel.open || (!refresh && exchangeBase === base)) return;
  exchangeBase = base;
  const request = ++exchangeRequest;
  const container = $("exchange-rates");
  container.replaceChildren();
  container.setAttribute("aria-busy", "true");
  const sources = ["USD", "EUR", "GBP", "JPY", "PHP"].filter(code => code !== base).slice(0, 4);
  await Promise.all(sources.map(async source => {
    const row = document.createElement("div");
    row.className = "exchange-rate";
    row.textContent = "1 " + source + " · Loading…";
    container.append(row);
    try {
      const data = await fetchRate(source, base, refresh);
      if (request !== exchangeRequest || localDataErased()) return;
      const value = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 7 }).format(Number(data.rate));
      const amount = document.createElement("strong");
      amount.textContent = "1 " + source + " = " + value + " " + base;
      const date = document.createElement("small");
      date.textContent = "As of " + data.date;
      row.replaceChildren(amount, date);
    } catch {
      if (request !== exchangeRequest || localDataErased()) return;
      row.textContent = source + " → " + base + ": unavailable. Refresh to retry.";
    }
  }));
  if (request === exchangeRequest) container.setAttribute("aria-busy", "false");
}
exchangePanel.addEventListener("toggle", () => renderExchangePanel());
$("exchange-refresh").addEventListener("click", () => renderExchangePanel(true));
let workspace;
workspace = createWorkspace({
  currency: () => $("currency").value,
  setCurrency: (value) => {
    if (currencies.includes(value)) {
      workspace.currencyChanged(value);
      $("currency").value = value;
    }
  },
  products: () => cards.map(read),
  read,
  render,
  load: (doc) => {
    $("currency").value = currencies.includes(doc.currency)
      ? doc.currency
      : "USD";
    fill(doc.products);
  },
  add: (values) => {
    if (cards.length >= 24) throw new Error("Compare at most 24 products.");
    createCard(values);
    render();
  },
  update: (index, values) => {
    const list = cards.map(read);
    if (!list[index]) throw new Error("Product no longer exists.");
    list[index] = { ...list[index], ...values };
    fill(list);
  },
});
if (workspace.initial) workspace.initialize();
else {
  workspace.initialize();
  fill(examples.milk);
}
if (!isNative && "serviceWorker" in navigator)
  navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .catch(() =>
      workspace.message(
        "Offline installation is unavailable in this browser. Saving and exports still work.",
      ),
    );
