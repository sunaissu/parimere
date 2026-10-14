import {
  comparePlanned,
  calculate,
  optimizeMix,
  basketTotals,
  MEASURES,
} from "./planning.mjs";
import {
  documentData,
  safeJSON,
  readLocal,
  writeLocal,
  csvCell,
  PRODUCT_FIELDS,
} from "./storage.mjs";
import { capturePhoto } from "./capture.mjs";
import { householdPanel } from "./household.mjs";

export const EXTRA_FIELDS = [
  [
    "discount",
    "Offer rule",
    "select",
    ["none", "percent", "fixed", "bogo", "multibuy"],
  ],
  ["discountValue", "Discount amount or percent"],
  ["offerCount", "Packs in multibuy"],
  ["offerPrice", "Total multibuy price"],
  ["taxPercent", "Tax (%)"],
  ["dutyPercent", "Duty (%)"],
  ["deposit", "Refundable deposit for this offer"],
  ["rebate", "Expected rebate for this offer"],
  ["wastePercent", "Waste (%)"],
  ["yieldFactor", "Prepared yield multiplier"],
  ["store", "Store", "text"],
  ["date", "Price recorded on", "date"],
  ["barcode", "Saved barcode", "text"],
  ["notes", "Product notes", "text"],
  ["quality", "Your quality criteria", "text"],
  ["basketItem", "Basket matching item key", "text"],
  ["basketCount", "Basket offers to buy"],
  ["targetPrice", "Price alert target per offer"],
];
export function node(tag, text, cls) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (cls) element.className = cls;
  return element;
}
const button = (text, action) => {
  const b = node("button", text);
  b.type = "button";
  b.addEventListener("click", action);
  return b;
};
export function extendTemplate(template) {
  const card = template.content.firstElementChild,
    units = card.querySelector("#a-unit");
  for (const [key, unit] of Object.entries(MEASURES))
    if (![...units.options].some((o) => o.value === key))
      units.add(new Option(key + " · " + unit.family, key));
  const details = node("details", undefined, "advanced-fields");
  details.append(node("summary", "Offers, usable quantity & product details"));
  details.append(
    node(
      "p",
      "Price is for one pack; BOGO buys one and receives two. Multibuy replaces the price with the entered total for that many packs. All extra costs, deposits and rebates apply once per offer. Yield multiplies quantity within the same measurement family.",
      "field-hint",
    ),
  );
  for (const [key, label, type, choices] of EXTRA_FIELDS) {
    const wrapper = node("div", undefined, "field"),
      caption = node("label", label),
      input = node(type === "select" ? "select" : "input");
    input.id = "a-" + key;
    caption.htmlFor = input.id;
    if (type === "select")
      choices.forEach((value) => input.add(new Option(value, value)));
    else {
      input.type = type || "number";
      input.maxLength = ["notes", "quality"].includes(key) ? 1000 : 200;
      if (input.type === "number") {
        input.min = "0";
        input.max = "1000000000";
        input.step = "any";
        input.inputMode = "decimal";
      }
    }
    wrapper.append(caption, input);
    details.append(wrapper);
  }
  card.insertBefore(details, card.querySelector(".unit-result"));
  card.append(node("div", undefined, "card-tools"));
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = node("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const format = (n, currency, locale) =>
  new Intl.NumberFormat(
    locale || undefined,
    currency
      ? { style: "currency", currency, maximumFractionDigits: 4 }
      : { maximumFractionDigits: 6 },
  ).format(n);

export function createWorkspace(api) {
  let currentName = "Untitled comparison",
    options = {},
    lastResult = null,
    initial = null,
    history = [],
    scenario = null,
    busy = false,
    sharedPreview = null;
  let saved = readLocal("saved", []),
    catalog = readLocal("catalog", []),
    preferences = readLocal("preferences", {}),
    basketSettings = readLocal("basket", {});
  if (!Array.isArray(saved)) saved = [];
  saved = saved.slice(0, 40).filter((v) => {
    try {
      documentData(v.document);
      return typeof v.id === "string";
    } catch {
      return false;
    }
  });
  if (!Array.isArray(catalog)) catalog = [];
  catalog = catalog.slice(0, 200).filter((v) => {
    try {
      if (
        !v ||
        typeof v.id !== "string" ||
        !Array.isArray(v.history) ||
        v.history.length > 100 ||
        v.history.some(
          (h) =>
            !h ||
            typeof h.date !== "string" ||
            h.date.length > 32 ||
            typeof h.price !== "number" ||
            !Number.isFinite(h.price) ||
            h.price < 0 ||
            !/^[A-Z]{3}$/.test(h.currency),
        )
      )
        return false;
      documentData({
        schemaVersion: 1,
        name: "catalog",
        currency: v.product.currency,
        products: [v.product, v.product],
      });
      return true;
    } catch {
      return false;
    }
  });
  if (!preferences || typeof preferences !== "object") preferences = {};
  if (
    !["en-PH", "en-US", "en-GB", "de-DE", "fr-FR", "ja-JP"].includes(
      preferences.locale,
    )
  )
    preferences.locale = "en-PH";
  if (
    !basketSettings ||
    typeof basketSettings !== "object" ||
    Array.isArray(basketSettings)
  )
    basketSettings = {};
  try {
    initial = documentData(readLocal("current", null));
  } catch {}
  try {
    scenario = documentData(readLocal("scenario", null));
  } catch {}
  const host = node("section", undefined, "workspace"),
    status = node(
      "p",
      "Comparisons stay on this device unless you explicitly export or share them.",
      "workspace-status",
    );
  status.role = "status";
  const toolbar = node("div", undefined, "workspace-toolbar"),
    nameInput = node("input");
  nameInput.id = "comparison-name";
  nameInput.maxLength = 100;
  nameInput.value = currentName;
  nameInput.setAttribute("aria-label", "Comparison name");
  const savedList = node("select");
  savedList.setAttribute("aria-label", "Saved comparisons");
  const message = (text) => {
    status.textContent = text;
  };
  const safely = (action) => () => {
    try {
      const result = action();
      if (result?.catch) result.catch((error) => message(error.message));
    } catch (error) {
      message(error.message);
    }
  };
  const current = () =>
    documentData({
      schemaVersion: 1,
      name: currentName,
      currency: api.currency(),
      products: api.products(),
      options,
    });
  const persist = () => {
    try {
      writeLocal("current", current());
    } catch (error) {
      message(error.message);
    }
  };
  const remember = () => {
    try {
      history.push(current());
      history = history.slice(-20);
      undo.disabled = false;
    } catch {}
  };
  window.addEventListener("beforeunload", persist);
  const load = (value) => {
    const data = documentData(value);
    currentName = data.name;
    nameInput.value = currentName;
    options = data.options;
    syncOptions();
    api.load(data);
    persist();
  };
  const refreshSaved = () => {
    savedList.replaceChildren(
      new Option("Choose a saved comparison", ""),
      ...saved.map((v) => new Option(v.document.name, v.id)),
    );
  };
  const undo = button(
    "Undo",
    safely(() => {
      const previous = history.pop();
      if (previous) load(previous);
      undo.disabled = !history.length;
    }),
  );
  undo.disabled = true;
  nameInput.addEventListener("input", () => {
    currentName = nameInput.value;
    persist();
  });
  toolbar.append(
    nameInput,
    button(
      "Save comparison",
      safely(() => {
        const document = current();
        const id = savedList.value || crypto.randomUUID(),
          existing = saved.find((v) => v.id === id);
        if (
          existing &&
          !confirm("Replace this saved comparison with the current values?")
        )
          return;
        const next = [
          { id, document, at: new Date().toISOString() },
          ...saved.filter((v) => v.id !== id),
        ];
        if (next.length > 40)
          throw new Error(
            "Keep at most 40 saved comparisons. Delete or export one first.",
          );
        writeLocal("saved", next);
        saved = next;
        refreshSaved();
        savedList.value = id;
        message("Comparison saved on this device.");
      }),
    ),
    savedList,
    button(
      "Open",
      safely(() => {
        const item = saved.find((v) => v.id === savedList.value);
        if (item) {
          remember();
          load(item.document);
        }
      }),
    ),
    button(
      "Duplicate saved",
      safely(() => {
        const item = saved.find((v) => v.id === savedList.value);
        if (item) {
          remember();
          load({
            ...item.document,
            name: item.document.name.slice(0, 90) + " copy",
          });
          savedList.value = "";
        }
      }),
    ),
    button(
      "Rename saved",
      safely(() => {
        const item = saved.find((v) => v.id === savedList.value);
        if (!item) return;
        const name = prompt("New comparison name", item.document.name)?.trim();
        if (!name) return;
        if (name.length > 100) throw new Error("Use at most 100 characters.");
        const next = saved.map((v) =>
          v === item ? { ...v, document: { ...v.document, name } } : v,
        );
        writeLocal("saved", next);
        saved = next;
        refreshSaved();
      }),
    ),
    button(
      "Delete saved",
      safely(() => {
        const id = savedList.value;
        if (
          id &&
          confirm(
            "Delete this saved comparison? The open comparison stays available.",
          )
        ) {
          const next = saved.filter((v) => v.id !== id);
          writeLocal("saved", next);
          saved = next;
          refreshSaved();
        }
      }),
    ),
    undo,
  );
  const tools = node("div", undefined, "workspace-toolbar"),
    plan = node("details", undefined, "workspace-panel");
  plan.open = false;
  plan.append(node("summary", "Plan the purchase"));
  const optionInputs = {};
  for (const [key, label] of [
    ["basis", "Compare per amount in base unit"],
    ["target", "Target quantity in base unit"],
    ["budget", "Checkout budget in result currency"],
    ["usage", "Usage per day in base unit"],
  ]) {
    const row = node("label", label),
      input = node("input");
    input.type = "number";
    input.min = "0";
    input.step = "any";
    input.inputMode = "decimal";
    input.setAttribute("aria-label", label);
    optionInputs[key] = input;
    input.addEventListener("input", () => {
      options[key] = input.value;
      api.render();
    });
    row.append(input);
    plan.append(row);
  }
  const rank = node("select");
  rank.add(new Option("Checkout cash", "cash"));
  rank.add(new Option("After refund and expected rebate", "net"));
  rank.setAttribute("aria-label", "Objective price ranking");
  rank.addEventListener("change", () => {
    options.rank = rank.value;
    api.render();
  });
  plan.append(
    node(
      "p",
      "Quantity uses g, mL, m, m², items, sheets or doses according to the product family. Use 1000 for per kg or per liter. Prepared yield and waste adjust the amount consumed. Expected refunds and rebates are assumptions, not guaranteed savings.",
    ),
    rank,
  );
  function syncOptions() {
    for (const [key, input] of Object.entries(optionInputs))
      input.value = options[key] || "";
    rank.value = options.rank || "cash";
  }
  const report = node("div", undefined, "planning-report");
  plan.append(report);
  const optimizer = node("div");
  plan.append(
    button(
      "Find least-cost pack mix",
      safely(() => {
        const result = optimizeMix(
          api.products(),
          api.currency(),
          options.target,
        );
        optimizer.replaceChildren(
          node(
            "p",
            "Exact lowest checkout cost: " +
              money(result.cost) +
              ". Usable quantity " +
              number(result.quantity) +
              "; leftover " +
              number(result.leftover) +
              ". " +
              result.counts
                .map((count, i) =>
                  count
                    ? count +
                      " × " +
                      (api.products()[i].name || "Pack " + (i + 1))
                    : null,
                )
                .filter(Boolean)
                .join(", ") +
              ". Per-offer costs repeat. Use the basket panel for shared delivery.",
          ),
        );
      }),
    ),
    optimizer,
  );
  const money = (n) => format(n, api.currency(), preferences.locale),
    number = (n) => format(n, null, preferences.locale);
  const dialog = node("dialog", undefined, "transfer-dialog"),
    dialogContent = node("div");
  dialog.append(
    button("Close", () => dialog.close()),
    dialogContent,
  );
  document.body.append(dialog);
  const preview = (value, importing = false) => {
    const data = documentData(value);
    dialogContent.replaceChildren(
      node(
        "h2",
        importing ? "Review imported comparison" : "Review what you will share",
      ),
      node(
        "p",
        "This includes product names, prices, store, date, barcode, notes, quality criteria, entered costs, exchange rates and planning inputs. Local catalog history and household credentials are excluded.",
      ),
    );
    const pre = node("pre", JSON.stringify(data, null, 2));
    dialogContent.append(
      pre,
      button(
        importing ? "Accept imported comparison" : "Download this comparison",
        safely(() => {
          if (importing) {
            remember();
            load(data);
            dialog.close();
            message("Imported locally. Nothing was sent to a household.");
          } else
            download(
              JSON.stringify(data, null, 2),
              "parimere-comparison.json",
              "application/json",
            );
        }),
      ),
    );
    dialog.showModal();
  };
  const file = node("input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.setAttribute("aria-label", "Import comparison file");
  file.addEventListener(
    "change",
    safely(async () => {
      const selected = file.files[0];
      file.value = "";
      if (!selected) return;
      if (selected.size > 250000)
        throw new Error("Comparison file is too large.");
      preview(safeJSON(await selected.text()), true);
    }),
  );
  tools.append(
    button(
      "Share file preview",
      safely(() => preview(current())),
    ),
    file,
    button(
      "CSV report",
      safely(() => {
        const doc = current(),
          result = comparePlanned(doc.products, doc.currency, options),
          columns = [
            "rank",
            ...PRODUCT_FIELDS,
            "rateMode",
            "rateDate",
            "resultCurrency",
            "cashPaid",
            "afterRebate",
            "usableQuantity",
            "basis",
            "unitPrice",
            "targetOffers",
            "targetCheckout",
            "leftovers",
            "days",
          ];
        const rows = doc.products.map((p, i) => [
          result.order.indexOf(i) + 1,
          ...PRODUCT_FIELDS.map((k) => p[k] || ""),
          p.fx?.mode || "same currency",
          p.fx?.date || "",
          doc.currency,
          result.prices[i],
          result.netPrices[i],
          result.totals[i],
          result.basisLabel,
          result.rates[i],
          result.plans[i].packs,
          result.plans[i].checkout,
          result.plans[i].leftover,
          result.plans[i].days ?? "",
        ]);
        download(
          [columns, ...rows]
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n"),
          "parimere-report.csv",
          "text/csv;charset=utf-8",
        );
      }),
    ),
    button(
      "Print report",
      safely(() => {
        if (!lastResult)
          throw new Error("Complete the comparison before printing.");
        document.querySelector(".math").open = true;
        window.print();
      }),
    ),
    button("Shopping mode", () => {
      document.body.classList.toggle("shopping");
      message(
        "Shopping mode toggled. Use Next in numeric fields to move through entries.",
      );
    }),
  );
  const scenarioPanel = node("details", undefined, "workspace-panel");
  scenarioPanel.append(
    node("summary", "Compare scenarios"),
    node(
      "p",
      "Capture the current values, then edit a separate scenario in this workspace. The original stays available below and can be restored.",
    ),
  );
  const scenarioReport = node("div", undefined, "scenario-grid");
  scenarioPanel.append(
    button(
      "Capture original scenario",
      safely(() => {
        scenario = current();
        writeLocal("scenario", scenario);
        drawScenario();
      }),
    ),
    button(
      "Restore original",
      safely(() => {
        if (scenario) {
          remember();
          load(scenario);
        }
      }),
    ),
    scenarioReport,
  );
  function drawScenario() {
    scenarioReport.replaceChildren();
    if (!scenario) return;
    for (const [label, doc] of [
      ["Original", scenario],
      ["Current", current()],
    ]) {
      const col = node("article");
      col.append(node("h3", label));
      try {
        const result = comparePlanned(doc.products, doc.currency, doc.options);
        result.order.forEach((i) =>
          col.append(
            node(
              "p",
              (doc.products[i].name || "Pack " + (i + 1)) +
                ": " +
                format(result.rates[i], doc.currency, preferences.locale) +
                " / " +
                result.basisLabel,
            ),
          ),
        );
      } catch (error) {
        col.append(node("p", error.message));
      }
      scenarioReport.append(col);
    }
  }
  const catalogPanel = node("details", undefined, "workspace-panel"),
    catalogList = node("div"),
    barcode = node("input");
  barcode.setAttribute("aria-label", "Find saved barcode");
  barcode.maxLength = 200;
  catalogPanel.append(
    node("summary", "Saved products, barcodes & price history"),
    barcode,
    button("Find barcode", () => findBarcode(barcode.value)),
    catalogList,
  );
  function findBarcode(value) {
    const found = catalog.find((v) => v.product.barcode === value.trim());
    if (found) {
      remember();
      api.add(found.product);
      message("Saved barcode matched " + found.product.name + ".");
    } else
      message(
        "No product with that barcode is saved. No external catalog was queried.",
      );
  }
  const photo = node("input");
  photo.type = "file";
  photo.accept = "image/png,image/jpeg,image/webp";
  photo.setAttribute("capture", "environment");
  photo.setAttribute("aria-label", "Capture barcode or receipt photo");
  const photoMode = node("select");
  photoMode.add(new Option("Read price label / receipt", "ocr"));
  photoMode.add(new Option("Identify saved barcode", "barcode"));
  photoMode.setAttribute("aria-label", "Photo capture purpose");
  photo.addEventListener(
    "change",
    safely(async () => {
      const selected = photo.files[0];
      photo.value = "";
      if (!selected || busy) return;
      busy = true;
      photo.disabled = true;
      message("Reading this photo on your device…");
      try {
        const result = await capturePhoto(selected, photoMode.value);
        if (photoMode.value === "barcode") {
          barcode.value = result;
          findBarcode(result);
        } else showOCR(result);
      } finally {
        busy = false;
        photo.disabled = false;
      }
    }),
  );
  catalogPanel.append(
    photoMode,
    photo,
    node(
      "p",
      "Photos stay on this device. OCR reads English text; inspect the image and every extracted value before applying. Barcode scanning searches only your saved catalog.",
    ),
  );
  function showOCR(result) {
    dialogContent.replaceChildren(
      node("h2", "Review extracted text"),
      result.preview,
    );
    const area = node("textarea");
    area.value = result.text.slice(0, 12000);
    area.readOnly = true;
    area.setAttribute("aria-label", "Recognized text");
    dialogContent.append(area);
    const target = node("select");
    api
      .products()
      .forEach((p, i) =>
        target.add(new Option(p.name || "Pack " + (i + 1), String(i))),
      );
    target.setAttribute("aria-label", "Product to update");
    const input = node("input");
    input.type = "number";
    input.min = "0";
    input.step = "any";
    input.setAttribute("aria-label", "Reviewed price");
    const candidate = result.text.match(/(?:\d+[.,]\d{2})(?!\d)/);
    input.value = candidate ? candidate[0].replace(",", ".") : "";
    dialogContent.append(
      target,
      node("label", "Reviewed price for the whole pack"),
      input,
      button(
        "Apply reviewed price",
        safely(() => {
          calculate(
            { ...api.products()[Number(target.value)], price: input.value },
            api.currency(),
          );
          remember();
          api.update(Number(target.value), { price: input.value });
          dialog.close();
          message(
            "Reviewed price applied. Check size, pack count and currency separately.",
          );
        }),
      ),
    );
    dialog.showModal();
  }
  function drawCatalog() {
    catalogList.replaceChildren();
    catalog.forEach((entry) => {
      const row = node("article");
      row.append(
        node("h3", entry.product.name || "Unnamed product"),
        node(
          "p",
          (entry.product.store || "No store") +
            " · " +
            (entry.product.barcode || "No barcode"),
        ),
        button(
          "Add to comparison",
          safely(() => {
            remember();
            api.add(entry.product);
          }),
        ),
        button(
          "Remove catalog entry",
          safely(() => {
            if (
              confirm("Delete this catalog entry and its local price history?")
            ) {
              const next = catalog.filter((v) => v !== entry);
              writeLocal("catalog", next);
              catalog = next;
              drawCatalog();
            }
          }),
        ),
      );
      const entries = entry.history.slice(-50);
      if (entries.length) {
        const graph = node("div", undefined, "price-chart");
        graph.setAttribute("role", "img");
        graph.setAttribute(
          "aria-label",
          "Recorded offer prices. Exact dates and amounts follow.",
        );
        const max = Math.max(...entries.map((v) => Number(v.price)), 1);
        for (const point of entries) {
          const bar = node("span");
          bar.style.height =
            Math.max(2, (Number(point.price) / max) * 80) + "px";
          bar.title = point.date + ": " + point.price + " " + point.currency;
          graph.append(bar);
        }
        row.append(graph);
        const list = node("ol");
        for (const p of entries)
          list.append(node("li", p.date + " · " + p.price + " " + p.currency));
        const details = node("details");
        details.append(node("summary", "Recorded prices"), list);
        row.append(details);
      }
      catalogList.append(row);
    });
  }
  function saveCatalog(product) {
    calculate(product, api.currency());
    const key = product.barcode
      ? product.barcode + "|" + (product.store || "")
      : product.name + "|" + (product.store || "");
    if (!product.name?.trim())
      throw new Error("Name this product before saving it.");
    const existing = catalog.find((v) => v.key === key),
      price = calculate(product, api.currency()).breakdown.discountedGoods,
      date = product.date || new Date().toISOString().slice(0, 10),
      entry = {
        id: existing?.id || crypto.randomUUID(),
        key,
        product,
        history: [
          ...(existing?.history || []),
          { date, price, currency: product.currency || api.currency() },
        ].slice(-100),
      };
    const next = [entry, ...catalog.filter((v) => v !== existing)];
    if (next.length > 200) throw new Error("Keep at most 200 catalog entries.");
    writeLocal("catalog", next);
    catalog = next;
    drawCatalog();
    message(
      product.targetPrice !== "" &&
        product.targetPrice !== undefined &&
        price <= Number(product.targetPrice)
        ? "Target reached: " +
            product.name +
            " is at or below your entered offer price."
        : "Catalog price recorded.",
    );
  }
  const basket = node("details", undefined, "workspace-panel"),
    basketRows = node("div"),
    basketResult = node("div");
  basket.append(
    node("summary", "Whole-store basket"),
    node(
      "p",
      "Use the same basket item key for matching needs at different stores. One offer per item key per store. Per-product shipping is replaced by one shared delivery fee; other per-offer costs repeat. Store fees and thresholds use the result currency. Minimums use discounted goods before tax, fees and deposits.",
    ),
    button("Edit store delivery settings", () => drawBasket()),
    basketRows,
    button(
      "Compare store totals",
      safely(() => {
        const totals = basketTotals(
          api.products(),
          api.currency(),
          basketSettings,
        );
        basketResult.replaceChildren(
          ...totals
            .sort((a, b) => a.total - b.total)
            .map((v) =>
              node(
                "p",
                v.store +
                  ": " +
                  money(v.total) +
                  " (delivery " +
                  money(v.delivery) +
                  ") · " +
                  (v.missing.length
                    ? "Incomplete: " + v.missing.join(", ")
                    : v.meetsMinimum
                      ? "Meets minimum order"
                      : "Below minimum order"),
              ),
            ),
        );
      }),
    ),
    basketResult,
  );
  function drawBasket() {
    basketRows.replaceChildren();
    for (const store of [
      ...new Set(api.products().map((p) => p.store || "Unspecified store")),
    ]) {
      const row = node("fieldset");
      row.append(node("legend", store));
      for (const [key, label] of [
        ["shipping", "Shared delivery"],
        ["minimum", "Minimum order"],
        ["freeShipping", "Free delivery threshold (0 disables)"],
      ]) {
        const wrap = node("label", label),
          input = node("input");
        input.type = "number";
        input.min = "0";
        input.step = "any";
        input.value = basketSettings[store]?.[key] || "";
        input.addEventListener(
          "change",
          safely(() => {
            basketSettings = {
              ...basketSettings,
              [store]: { ...basketSettings[store], [key]: input.value },
            };
            writeLocal("basket", basketSettings);
            basketResult.replaceChildren();
          }),
        );
        wrap.append(input);
        row.append(wrap);
      }
      basketRows.append(row);
    }
  }
  const prefs = node("details", undefined, "workspace-panel");
  prefs.append(node("summary", "Regional preferences"));
  const locale = node("select");
  for (const v of ["en-PH", "en-US", "en-GB", "de-DE", "fr-FR", "ja-JP"])
    locale.add(new Option(v, v));
  locale.value = preferences.locale || "en-PH";
  locale.setAttribute("aria-label", "Number formatting locale");
  prefs.append(
    locale,
    button(
      "Save current regional preferences",
      safely(() => {
        preferences = {
          locale: locale.value,
          currency: api.currency(),
          basis: options.basis || "",
        };
        writeLocal("preferences", preferences);
        api.render();
        message(
          "Display currency, comparison basis and number formatting saved. Enter decimals with a dot.",
        );
      }),
    ),
    node(
      "p",
      "Number formatting changes display only. Enter decimal values with a dot. The result currency does not relabel original product prices.",
    ),
  );
  const transfers = node("details", undefined, "workspace-panel");
  transfers.append(
    node("summary", "Save, reopen and share comparisons"),
    toolbar,
    tools,
  );
  host.append(
    status,
    transfers,
    plan,
    scenarioPanel,
    catalogPanel,
    basket,
    prefs,
    householdPanel({
      current,
      load,
      remember,
      message,
      preview: (value) => {
        sharedPreview = documentData(value);
        preview(sharedPreview, true);
      },
    }),
  );
  document.querySelector(".math").after(host);
  const quick = node("div", undefined, "workspace-toolbar quick-tools");
  quick.append(
    button("Save / open", () => {
      transfers.open = true;
      transfers.scrollIntoView({ behavior: "smooth", block: "start" });
    }),
    button("Plan purchase", () => {
      plan.open = true;
      plan.scrollIntoView({ behavior: "smooth", block: "start" });
    }),
    button("Undo", () => undo.click()),
    button("Shopping mode", () => document.body.classList.toggle("shopping")),
  );
  document.querySelector("#compare-form").before(quick);
  refreshSaved();
  drawCatalog();
  return {
    initial,
    preferences,
    options: () => options,
    locale: () => preferences.locale,
    remember,
    load,
    persist,
    message,
    initialize() {
      if (initial) load(initial);
      else if (preferences.currency) {
        api.setCurrency(preferences.currency);
        options.basis = preferences.basis || "";
        syncOptions();
      }
    },
    card(card) {
      const tools = card.element.querySelector(".card-tools");
      tools.append(
        button(
          "Duplicate",
          safely(() => {
            remember();
            api.add(api.read(card));
          }),
        ),
        button(
          "Copy costs",
          safely(() => {
            const target = Number(
              prompt(
                "Copy these costs to product number (1–" +
                  api.products().length +
                  ")",
              ),
            );
            if (
              !Number.isInteger(target) ||
              target < 1 ||
              target > api.products().length
            )
              return;
            remember();
            const source = api.read(card),
              keys = [
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
              ];
            api.update(
              target - 1,
              Object.fromEntries([
                ...keys.map((k) => [k, source[k]]),
                ["fx", source.fx],
              ]),
            );
          }),
        ),
        button(
          "Record price",
          safely(() => saveCatalog(api.read(card))),
        ),
      );
      for (const input of Object.values(card.inputs))
        if (input.type === "number") {
          input.enterKeyHint = "next";
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const inputs = [
                ...document.querySelectorAll(
                  '#compare-form input[type="number"]',
                ),
              ].filter(
                (i) => !i.disabled && !i.readOnly && i.checkVisibility(),
              );
              inputs[(inputs.indexOf(input) + 1) % inputs.length]?.focus();
            }
          });
        }
    },
    result(result) {
      lastResult = result;
      optimizer.replaceChildren();
      basketResult.replaceChildren();
      report.replaceChildren();
      if (result) {
        report.append(
          node(
            "p",
            "Objective winner uses " +
              (options.rank === "net"
                ? "expected after-refund/rebate cost"
                : "checkout cash") +
              " per usable unit.",
          ),
        );
        result.order.forEach((i) => {
          const p = api.products()[i],
            v = result.plans[i],
            row = node("article");
          row.append(
            node("h3", p.name || "Pack " + (i + 1)),
            node(
              "p",
              v.packs +
                " offer(s), " +
                v.physicalPacks +
                " physical pack(s) · Checkout " +
                money(v.checkout) +
                " · After expected refunds/rebates " +
                money(v.afterRebate),
            ),
            node(
              "p",
              "Leftover " +
                number(v.leftover) +
                " " +
                result.baseUnit +
                (v.affordable === null
                  ? ""
                  : v.affordable
                    ? " · Within budget"
                    : " · Over budget") +
                (v.days === null
                  ? ""
                  : " · One offer lasts " + number(v.days) + " days"),
            ),
            node(
              "p",
              "Match winning unit price at a shelf/offer price of " +
                (v.breakEvenPrice === null
                  ? "no price-sensitive threshold"
                  : format(
                      v.breakEvenPrice,
                      p.currency || api.currency(),
                      preferences.locale,
                    )) +
                (v.fxThreshold === null
                  ? ""
                  : ". Winning FX boundary: 1 " +
                    p.currency +
                    " = " +
                    number(v.fxThreshold) +
                    " " +
                    api.currency()),
            ),
            node("p", [p.quality, p.notes].filter(Boolean).join(" · ")),
          );
          report.append(row);
        });
      } else
        report.append(node("p", "Complete valid product fields to see plans."));
      if (scenario) drawScenario();
      persist();
    },
  };
}
