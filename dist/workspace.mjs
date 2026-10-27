import {
  comparePlanned,
  calculate,
  basketTotals,
  MEASURES,
} from "./planning.mjs";
import {
  documentData,
  safeJSON,
  readLocal,
  writeLocal,
  eraseLocalData,
  localDataErased,
  csvCell,
  PRODUCT_FIELDS,
  storageWritable,
  storageIssues,
  protectLocalData,
  replaceLocalData,
} from "./storage.mjs";
import { createOptimizerClient } from "./optimizer-client.mjs";
import { capturePhoto } from "./capture.mjs";
import { householdPanel } from "./household.mjs";
import { isNative, saveFile, printReport, clearNativeFiles } from "./platform.mjs";

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
  const options = node("details", undefined, "pack-options");
  const summary = node("summary", "Pack options");
  summary.append(node("span", "", "pack-options-summary"));
  options.append(summary);
  options.append(
    card.querySelector("#a-name").closest(".field"),
    card.querySelector("#a-currency").closest(".field"),
    card.querySelector(".pack-row"),
  );
  const groups = [
    ["Offers", ["discount", "discountValue", "offerCount", "offerPrice"],
      "Choose an offer, or enter the final price above. BOGO includes two packs. Multibuy uses the total price for the entered pack count."],
    ["Usable quantity", ["wastePercent", "yieldFactor"],
      "Waste reduces the amount you use. Yield multiplies the prepared amount within the same unit family."],
    ["Product details", ["store", "date", "barcode", "notes", "quality", "targetPrice"]],
    ["Basket settings", ["basketItem", "basketCount"]],
  ];
  const containers = new Map();
  for (const [title, keys, hint] of groups) {
    const group = node("details", undefined, "advanced-fields");
    group.append(node("summary", title));
    if (hint) group.append(node("p", hint, "field-hint"));
    options.append(group);
    keys.forEach((key) => containers.set(key, group));
  }
  const extras = card.querySelector(".extra-costs");
  options.insertBefore(extras, options.querySelector(".advanced-fields"));
  ["taxPercent", "dutyPercent", "deposit", "rebate"].forEach((key) =>
    containers.set(key, extras),
  );
  const offerNames = {
    none: "No offer", percent: "Percentage discount", fixed: "Fixed discount",
    bogo: "Buy one, get one free", multibuy: "Multibuy total price",
  };
  for (const [key, label, type, choices] of EXTRA_FIELDS) {
    const wrapper = node("div", undefined, "field"),
      caption = node("label", label),
      input = node(type === "select" ? "select" : "input");
    input.id = "a-" + key;
    caption.htmlFor = input.id;
    if (type === "select")
      choices.forEach((value) => input.add(new Option(offerNames[value] || value, value)));
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
    containers.get(key).append(wrapper);
  }
  options.append(node("div", undefined, "card-tools"));
  card.insertBefore(options, card.querySelector(".unit-result"));
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
    basketRecord = readLocal("basket", {});
  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const legacyBasket = isRecord(basketRecord) && !Object.hasOwn(basketRecord, "currency") && Object.keys(basketRecord).length > 0;
  const basketValid = isRecord(basketRecord) && (Object.keys(basketRecord).length === 0 || (
    typeof basketRecord.currency === "string" && /^[A-Z]{3}$/.test(basketRecord.currency) &&
    isRecord(basketRecord.stores) && Object.values(basketRecord.stores).every((fees) =>
      isRecord(fees) && ["shipping", "minimum", "freeShipping"].every((key) => fees[key] === undefined ||
        (typeof fees[key] === "string" && (fees[key] === "" || (Number.isFinite(Number(fees[key])) && Number(fees[key]) >= 0))))
    )
  ));
  let basketProtected = storageIssues().some((issue) => issue.key === "basket");
  if (legacyBasket || !basketValid) {
    basketProtected = true;
    protectLocalData("basket", legacyBasket
      ? "Saved delivery settings have no recorded currency. The original values have been kept. Download recovery data before resetting saved delivery settings."
      : "Saved delivery settings could not be read. The original values have been kept. Download recovery data before resetting saved delivery settings.");
  }
  let basketSettings = basketProtected ? {} : basketRecord?.stores || {},
    basketCurrency = basketProtected ? "" : basketRecord?.currency || "",
    comparisonCurrency = api.currency();
  const savedCount = Array.isArray(saved) ? saved.length : -1;
  if (!Array.isArray(saved)) saved = [];
  saved = saved.slice(0, 40).filter((v) => {
    try {
      documentData(v.document);
      return typeof v.id === "string";
    } catch {
      return false;
    }
  });
  if (savedCount !== saved.length)
    protectLocalData("saved", "Some saved comparisons could not be read. The original collection has been kept and saving over it is blocked.");
  const catalogCount = Array.isArray(catalog) ? catalog.length : -1;
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
  if (catalogCount !== catalog.length)
    protectLocalData("catalog", "Some catalog entries could not be read. The original catalog has been kept and saving over it is blocked.");
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
  const storedCurrent = readLocal("current", null);
  if (storedCurrent !== null) {
    try { initial = documentData(storedCurrent); }
    catch { protectLocalData("current", "The open comparison could not be restored. Its saved data has been kept. Export recovery data before resetting it."); }
  }
  const storedScenario = readLocal("scenario", null);
  if (storedScenario !== null) {
    try { scenario = documentData(storedScenario); }
    catch { protectLocalData("scenario", "The original scenario could not be restored. Its saved data has been kept."); }
  }
  const host = node("section", undefined, "workspace"),
    status = node(
      "p",
      "",
      "workspace-status",
    );
  status.role = "status";
  status.hidden = true;
  const workspaceSummary = node("h2", "Your comparison tools");
  workspaceSummary.id = "comparison-tools-title";
  host.setAttribute("aria-labelledby", workspaceSummary.id);
  host.id = "comparison-tools";
  host.setAttribute("popover", "auto");
  host.setAttribute("role", "dialog");
  const activePlan = node("span", "", "active-plan");
  workspaceSummary.append(activePlan);
  host.append(workspaceSummary);
  const closeTools = button("Back to comparison", () => host.hidePopover());
  closeTools.className = "close-tools";
  host.append(closeTools);
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
    status.hidden = !text;
  };
  function showStorageIssues() {
    const issues = storageIssues();
    const notice = document.getElementById("storage-notice");
    if (!issues.length) {
      if (storageWritable()) notice.hidden = true;
      return;
    }
    notice.hidden = false;
    notice.querySelector("p").textContent = issues.map((issue) => issue.message).join(" ") +
      " Your stored data has been kept. Export the current comparison or download recovery data under Data on this device before reloading.";
  }
  const safely = (action) => () => {
    try {
      const result = action();
      if (result?.catch) result.catch((error) => { message(error.message); showStorageIssues(); });
    } catch (error) {
      message(error.message);
      showStorageIssues();
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
    if (localDataErased() || !storageWritable()) return;
    try {
      writeLocal("current", current());
    } catch (error) {
      message(error.message);
      showStorageIssues();
    }
  };
  const remember = () => {
    try {
      history.push(current());
      history = history.slice(-20);
      undo.disabled = false;
      quickUndo.hidden = false;
    } catch {}
  };
  window.addEventListener("beforeunload", persist);
  const load = (value) => {
    const data = documentData(value);
    changeCurrency(data.currency, false);
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
      quickUndo.hidden = !history.length;
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
    if (key === "basis") {
      input.placeholder = "Automatic";
      input.setAttribute("aria-describedby", "comparison-basis-hint");
    }
    optionInputs[key] = input;
    input.addEventListener("input", () => {
      options[key] = input.value;
      api.render();
    });
    row.append(input);
    if (key === "basis") {
      const hint = node("span", "Leave blank or use 0 for the automatic amount.", "field-hint");
      hint.id = "comparison-basis-hint";
      row.append(hint);
    }
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
  function changeCurrency(next, clearBudget = true) {
    const changed = next !== comparisonCurrency;
    comparisonCurrency = next;
    const cleared = [];
    if (changed && clearBudget && options.budget !== undefined && options.budget !== "") {
      delete options.budget;
      syncOptions();
      cleared.push("checkout budget");
    }
    if (basketCurrency !== next && Object.keys(basketSettings).length) {
      basketSettings = {};
      cleared.push("store delivery fees and thresholds");
      basketRows.replaceChildren();
      basketResult.replaceChildren();
    }
    if (basketCurrency !== next) {
      basketCurrency = next;
      if (storageWritable() && !basketProtected) {
        try { writeLocal("basket", { currency: next, stores: basketSettings }); }
        catch (error) { message(error.message); showStorageIssues(); }
      }
    }
    if (cleared.length) message("Result currency changed to " + next + ". Re-enter your " + cleared.join(" and ") + " in " + next + ".");
    return cleared.length ? " Re-enter your " + cleared.join(" and ") + " in " + next + "." : "";
  }
  const report = node("div", undefined, "planning-report");
  plan.append(report);
  const optimizer = node("div"),
    optimizerActions = node("div", undefined, "optimizer-actions"),
    optimizerClient = createOptimizerClient();
  optimizer.setAttribute("role", "status");
  let optimizerRun = 0;
  function cancelOptimization() {
    optimizerRun++;
    optimizerClient.cancel();
    optimizeButton.disabled = false;
    optimizeButton.textContent = "Find least-cost pack mix";
    cancelOptimizer.hidden = true;
    optimizer.removeAttribute("aria-busy");
  }
  const optimizeButton = button(
      "Find least-cost pack mix",
      safely(async () => {
        api.render();
        const products = api.products(), currency = api.currency(), run = ++optimizerRun;
        optimizeButton.disabled = true;
        optimizeButton.textContent = "Finding pack mix…";
        cancelOptimizer.hidden = false;
        optimizer.setAttribute("aria-busy", "true");
        optimizer.replaceChildren(node("p", "Finding the lowest checkout cost. You can keep editing or cancel."));
        try {
        const result = await optimizerClient.run(products, currency, options.target);
        if (run !== optimizerRun || localDataErased()) return;
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
                      (products[i].name || "Pack " + (i + 1))
                    : null,
                )
                .filter(Boolean)
                .join(", ") +
              ". Per-offer costs repeat. Use the basket panel for shared delivery.",
          ),
        );
        } catch (error) {
          if (run === optimizerRun && error.name !== "AbortError")
            optimizer.replaceChildren(node("p", error.message));
        } finally {
          if (run === optimizerRun) {
            optimizeButton.disabled = false;
            optimizeButton.textContent = "Find least-cost pack mix";
            cancelOptimizer.hidden = true;
            optimizer.removeAttribute("aria-busy");
          }
        }
      }),
    );
  const cancelOptimizer = button("Cancel pack search", () => {
    cancelOptimization();
    optimizer.replaceChildren(node("p", "Pack search cancelled."));
  });
  cancelOptimizer.hidden = true;
  optimizerActions.append(optimizeButton, cancelOptimizer);
  plan.append(optimizerActions, optimizer);
  window.addEventListener("parimere:erase-data", () => optimizerClient.dispose());
  window.addEventListener("pagehide", () => optimizerClient.dispose());
  const money = (n) => format(n, api.currency(), preferences.locale),
    number = (n) => format(n, null, preferences.locale);
  const dialog = node("dialog", undefined, "transfer-dialog"),
    dialogContent = node("div");
  dialog.append(
    button("Close", () => dialog.close()),
    dialogContent,
  );
  document.body.append(dialog);
  const showToolDialog = (overlay) => {
    const returnToTools = host.matches(":popover-open");
    const previousFocus = document.activeElement;
    overlay.addEventListener("close", () => {
      if (returnToTools && !localDataErased()) {
        host.showPopover();
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      }
    }, { once: true });
    overlay.showModal();
  };
  const showTransferDialog = () => showToolDialog(dialog);
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
        importing ? "Accept imported comparison" : isNative ? "Share this comparison" : "Download this comparison",
        safely(async () => {
          if (importing) {
            remember();
            load(data);
            dialog.close();
            message("Imported locally. Nothing was sent to a household.");
          } else
            await saveFile(
              JSON.stringify(data, null, 2),
              "parimere-comparison.json",
              "application/json",
            );
        }),
      ),
    );
    showTransferDialog();
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
      isNative ? "Share CSV report" : "CSV report",
      safely(async () => {
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
        await saveFile(
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
      safely(async () => {
        if (!lastResult)
          throw new Error("Complete the comparison before printing.");
        document.querySelector(".math").open = true;
        await printReport();
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
    button("Find barcode", safely(() => findBarcode(barcode.value))),
    catalogList,
  );
  function findBarcode(value) {
    const query = value.trim();
    if (!query) throw new Error("Enter a barcode before searching saved products.");
    const found = catalog.find((v) => v.product.barcode === query);
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
  if (!isNative) photo.setAttribute("capture", "environment");
  photo.setAttribute("aria-label", isNative ? "Choose barcode or receipt photo" : "Capture barcode or receipt photo");
  const photoMode = node("select");
  photoMode.add(new Option("Read price label / receipt", "ocr"));
  photoMode.add(new Option("Identify saved barcode", "barcode"));
  photoMode.setAttribute("aria-label", "Photo capture purpose");
  photo.addEventListener(
    "change",
    safely(async () => {
      const selected = photo.files[0], mode = photoMode.value;
      photo.value = "";
      if (!selected || busy) return;
      busy = true;
      photo.disabled = true;
      photoMode.disabled = true;
      message("Reading this photo on your device…");
      try {
        const result = await capturePhoto(selected, mode);
        if (localDataErased()) return;
        if (mode === "barcode") {
          barcode.value = result;
          findBarcode(result);
        } else showOCR(result);
      } finally {
        busy = false;
        photo.disabled = false;
        photoMode.disabled = false;
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
    showTransferDialog();
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
    button("Reset saved delivery settings", safely(() => {
      if (!storageWritable()) throw new Error("Use the tab that is saving your work to reset delivery settings.");
      if (!confirm("Reset saved delivery settings? This clears only store delivery fees and thresholds. Download recovery data under Data on this device first if you want to keep the original values.")) return;
      replaceLocalData("basket", { currency: api.currency(), stores: {} });
      basketSettings = {};
      basketCurrency = api.currency();
      basketProtected = false;
      drawBasket();
      basketResult.replaceChildren();
      showStorageIssues();
      message("Saved delivery settings reset. Enter fees and thresholds in " + api.currency() + ".");
    })),
    basketRows,
    button(
      "Compare store totals",
      safely(() => {
        if (basketProtected) throw new Error("Recover or reset saved delivery settings before comparing store totals.");
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
      ...new Set(api.products().map((p) => p.store?.trim() || "Unspecified store")),
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
        input.disabled = basketProtected;
        input.value = basketSettings[store]?.[key] || "";
        input.addEventListener(
          "change",
          safely(() => {
            basketSettings = {
              ...basketSettings,
              [store]: { ...basketSettings[store], [key]: input.value },
            };
            writeLocal("basket", { currency: api.currency(), stores: basketSettings });
            basketCurrency = api.currency();
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
  const dataSettings = node("details", undefined, "workspace-panel");
  window.addEventListener("parimere:data-erased", ({ detail: failures }) => {
    const screen = node("main", undefined, "shell data-reset"),
      restart = node("a", "Open Parimere again");
    screen.id = "data-reset";
    restart.href = "/";
    screen.append(
      node("h1", failures.length ? "Some local data could not be deleted" : "Local data deleted"),
      node("p", failures.length
        ? "Your browser blocked removal of " + failures.join(", ") + ". Remove this site's stored data in browser settings to finish."
        : "Saved comparisons, catalog history, preferences and local access have been removed. Downloaded exports and shared server copies are unchanged."),
      node("p", isNative ? "Open Parimere again to start a new comparison." : "Reconnect before reopening so Parimere can download its offline files again."),
      restart,
    );
    document.body.replaceChildren(screen);
    screen.tabIndex = -1;
    screen.focus();
  });
  dataSettings.append(
    node("summary", "Data on this device"),
    node("p", "Delete local comparisons, saved comparisons, catalog history, scenarios, preferences, exchange rates, household access on this device and offline files. Downloaded or shared copies stay with their recipients. To delete a shared household, use its owner controls before deleting your local access."),
    button("Download recovery data", safely(async () => {
      const data = {};
      for (const key of ["current", "saved", "catalog", "scenario", "preferences", "basket"])
        data[key] = localStorage.getItem("parimere:" + key);
      await saveFile(JSON.stringify({ format: "parimere-raw-recovery", version: 1, data }, null, 2),
        "parimere-recovery.json", "application/json");
      message("Recovery file exported. It contains raw saved data and may include product notes. Keep it private; it is not a comparison import file.");
    })),
    button("Delete all local data", safely(async () => {
      if (!storageWritable()) throw new Error("Use the tab that is saving your work to delete local data.");
      if (!confirm("Permanently delete all Parimere data stored on this device? This includes saved comparisons, catalog history and household access. This cannot be undone. Downloaded files and server copies are not deleted.")) return;
      await clearNativeFiles();
      await eraseLocalData();
    })),
  );
  host.append(
    transfers,
    plan,
    scenarioPanel,
    catalogPanel,
    basket,
    prefs,
    dataSettings,
    ...(!isNative ? [householdPanel({
      showDialog: showToolDialog,
      current,
      load,
      remember,
      message,
      preview: (value) => {
        sharedPreview = documentData(value);
        preview(sharedPreview, true);
      },
    })] : []),
  );
  const groups = [
    ["Save and organise", "Keep comparisons and products ready for your next shop.", [transfers, catalogPanel]],
    ["Plan your purchase", "Check quantities, budgets and the cost of a whole basket.", [plan, scenarioPanel, basket]],
    ["Preferences and sharing", "Manage your regional settings, local data and optional sharing.", [prefs, dataSettings, ...Array.from(host.children).filter(child => child.tagName === "DETAILS" && ![transfers, catalogPanel, plan, scenarioPanel, basket, prefs, dataSettings].includes(child))]],
  ];
  for (const [title, description, panels] of groups) {
    const group = node("section", undefined, "tool-group");
    group.append(node("h3", title), node("p", description, "tool-group-description"));
    const grid = node("div", undefined, "tool-grid");
    for (const panel of panels) {
      panel.classList.add("workspace-panel");
      grid.append(panel);
    }
    group.append(grid);
    host.append(group);
  }
  document.querySelector(".comparison-layout").after(host);
  host.before(status);
  const shortcuts = node("div", undefined, "workspace-toolbar tool-shortcuts");
  const openTools = (panel) => {
    host.showPopover();
    if (panel) {
      panel.open = true;
      panel.scrollIntoView({ block: "start" });
      panel.querySelector("summary").focus({ preventScroll: true });
    } else {
      host.scrollTop = 0;
      closeTools.focus({ preventScroll: true });
    }
  };
  shortcuts.append(
    button("Save / open", () => openTools(transfers)),
    button("Plan purchase", () => openTools(plan)),
    button("All tools", () => openTools()),
    button("Shopping mode", () => document.body.classList.toggle("shopping")),
  );
  for (const control of Array.from(shortcuts.children).slice(0, 3)) {
    control.setAttribute("aria-controls", host.id);
    control.setAttribute("aria-haspopup", "dialog");
    control.setAttribute("aria-expanded", "false");
  }
  host.addEventListener("toggle", () => {
    for (const control of Array.from(shortcuts.children).slice(0, 3))
      control.setAttribute("aria-expanded", String(host.matches(":popover-open")));
  });
  document.querySelector(".comparison-layout").before(shortcuts);
  const quick = node("div", undefined, "quick-tools");
  const quickUndo = button("Undo", () => undo.click());
  quickUndo.hidden = true;
  quick.append(quickUndo);
  document.querySelector(".actions").append(quick);
  refreshSaved();
  drawCatalog();
  showStorageIssues();
  if (legacyBasket) message("Old delivery settings have been preserved. Download recovery data, then use Reset saved delivery settings in the Whole-store basket panel.");
  if (!storageWritable()) {
    const mutating = new Set(["Save comparison", "Rename saved", "Delete saved", "Remove catalog entry", "Record price", "Capture original scenario", "Save current regional preferences", "Delete all local data", "Reset saved delivery settings"]);
    for (const control of host.querySelectorAll("button"))
      if (mutating.has(control.textContent)) control.disabled = true;
  }
  return {
    initial,
    preferences,
    options: () => options,
    locale: () => preferences.locale,
    remember,
    load,
    persist,
    message,
    currencyChanged: changeCurrency,
    invalidateOptimization() {
      cancelOptimization();
      optimizer.replaceChildren();
    },
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
      if (!storageWritable())
        [...tools.querySelectorAll("button")].find((control) => control.textContent === "Record price").disabled = true;
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
      cancelOptimization();
      lastResult = result;
      const active = [];
      if (options.target || options.budget || options.usage) active.push("purchase plan active");
      if (Number(options.basis) > 0) active.push("custom comparison amount");
      if (options.rank === "net") active.push("after refunds");
      activePlan.textContent = active.length ? " · " + active.join(", ") : "";
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
