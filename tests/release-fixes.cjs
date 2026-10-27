const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");

const root = path.resolve(__dirname, ".."), port = 4199;
const url = "http://127.0.0.1:" + port;
const output = path.join(root, "qa", "release-fixes");
const errors = [];

async function ready(page) {
  await expect(page.locator("#startup")).toBeHidden();
  await expect(page.locator("#app-shell")).toBeVisible();
}
async function openPanel(page, label) {
  const workspace = page.locator(".workspace");
  if (!(await workspace.evaluate((element) => element.open)))
    await workspace.locator(":scope > summary").click();
  const summary = page.locator("summary").filter({ hasText: new RegExp("^" + label + "$") });
  if (!(await summary.evaluate((element) => element.parentElement.open))) await summary.click();
}
async function openPage(context) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(url);
  await ready(page);
  return page;
}
async function contextFor(browser, data = {}) {
  const context = await browser.newContext({
    locale: 'en-PH',
    viewport: { width: 1440, height: 1000 }, serviceWorkers: "block",
    storageState: { cookies: [], origins: [{ origin: url, localStorage: Object.entries(data).map(([key, value]) => ({
      name: "parimere:" + key, value: typeof value === "string" ? value : JSON.stringify(value),
    })) }] },
  });
  await context.route("https://api.frankfurter.dev/**", async (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      base: parts.at(-2), quote: parts.at(-1), rate: 1,
      date: new Date().toISOString().slice(0, 10),
    }) });
  });
  return context;
}
const current = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("parimere:current")));

async function editorIsolation(browser) {
  const context = await contextFor(browser);
  try {
    const first = await openPage(context);
    assert.equal(await first.evaluate(() => typeof navigator.locks.request), "function");
    await openPanel(first, "Save, reopen and share comparisons");
    await first.getByLabel("Comparison name", { exact: true }).fill("Saved by first tab");
    await first.locator('.product input[id$="-price"]').first().fill("123");
    await first.getByRole("button", { name: "Save comparison", exact: true }).click();
    await expect.poll(async () => (await current(first)).products[0].price).toBe("123");

    const second = await openPage(context);
    await expect(second.locator("#storage-notice")).toContainText("Changes in this tab are temporary");
    await openPanel(second, "Save, reopen and share comparisons");
    await expect(second.getByRole("button", { name: "Save comparison", exact: true })).toBeDisabled();
    await second.locator('.product input[id$="-price"]').first().fill("999");
    await expect(second.locator('.product input[id$="-price"]').first()).toHaveValue("999");
    assert.equal((await current(second)).products[0].price, "123");
    await second.close();
    assert.equal((await current(first)).products[0].price, "123", "Closing a temporary tab must not restore stale values.");

    const successor = await openPage(context);
    await expect(successor.locator("#storage-notice")).toBeVisible();
    await first.close();
    await successor.reload();
    await ready(successor);
    await expect(successor.locator("#storage-notice")).toBeHidden();
    await openPanel(successor, "Save, reopen and share comparisons");
    await expect(successor.getByRole("button", { name: "Save comparison", exact: true })).toBeEnabled();
    await expect(successor.locator('.product input[id$="-price"]').first()).toHaveValue("123");
    await successor.getByLabel("Comparison name", { exact: true }).fill("Saved by successor");
    await successor.getByRole("button", { name: "Save comparison", exact: true }).click();
    assert.equal(await successor.evaluate(() => JSON.parse(localStorage.getItem("parimere:saved")).length), 2);
  } finally { await context.close(); }
  console.log("Passed: exclusive editing, temporary tabs, unload preservation and editor handover.");
}

async function recoveryAndLargeCollections(browser, storage) {
  const brokenSaved = '{"broken":', brokenCurrent = "invalid current JSON";
  const context = await contextFor(browser, { saved: brokenSaved, current: brokenCurrent });
  try {
    const page = await openPage(context);
    await expect(page.locator("#storage-notice")).toContainText("could not be read");
    await expect(page.locator("#storage-notice")).toContainText("download recovery data");
    await openPanel(page, "Save, reopen and share comparisons");
    await page.getByRole("button", { name: "Save comparison", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => ({ saved: localStorage.getItem("parimere:saved"), current: localStorage.getItem("parimere:current") })),
      { saved: brokenSaved, current: brokenCurrent });
    await openPanel(page, "Data on this device");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download recovery data", exact: true }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), "parimere-recovery.json");
    const recovery = JSON.parse(await fs.readFile(await download.path(), "utf8"));
    assert.equal(recovery.format, "parimere-raw-recovery");
    assert.equal(recovery.data.saved, brokenSaved);
    assert.equal(recovery.data.current, brokenCurrent);
    await page.reload();
    await ready(page);
    assert.equal(await page.evaluate(() => localStorage.getItem("parimere:saved")), brokenSaved);
  } finally { await context.close(); }

  const product = {
    ...Object.fromEntries(storage.PRODUCT_FIELDS.map((key) => [key, ""])),
    name: "Rice", price: "10", amount: "1", unit: "kg", pack: "1", currency: "PHP",
    fx: { mode: "manual", pair: "PHP/PHP", date: "" },
  };
  const document = storage.documentData({ schemaVersion: 1, name: "Large", currency: "PHP",
    products: Array.from({ length: 24 }, () => ({ ...product })), options: {} });
  const saved = Array.from({ length: 40 }, (_, i) => ({ id: String(i), at: "2026-10-22T00:00:00.000Z",
    document: { ...document, name: "Saved comparison " + (i + 1) } }));
  const largeContext = await contextFor(browser, { saved });
  try {
    const page = await openPage(largeContext);
    await openPanel(page, "Save, reopen and share comparisons");
    await expect(page.getByLabel("Saved comparisons", { exact: true }).locator("option")).toHaveCount(41);
    await page.getByLabel("Saved comparisons", { exact: true }).selectOption("39");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.locator(".product")).toHaveCount(24);
    await expect(page.getByLabel("Comparison name", { exact: true })).toHaveValue("Saved comparison 40");
    await expect(page.locator("#storage-notice")).toBeHidden();
    await page.reload();
    await ready(page);
    await expect(page.locator(".product")).toHaveCount(24);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("parimere:saved")).length), 40);
  } finally { await largeContext.close(); }
  console.log("Passed: corrupt data preservation, recovery download and forty full-sized saved comparisons.");
}

async function currencyBoundaries(browser) {
  const context = await contextFor(browser);
  try {
    const page = await openPage(context);
    await openPanel(page, "Plan the purchase");
    await page.getByLabel("Checkout budget in result currency", { exact: true }).fill("100");
    await openPanel(page, "Whole-store basket");
    await page.getByRole("button", { name: "Edit store delivery settings", exact: true }).click();
    await page.getByLabel("Shared delivery", { exact: true }).fill("25");
    await page.getByLabel("Shared delivery", { exact: true }).press("Tab");
    await page.locator("#currency").selectOption("USD");
    await expect(page.getByLabel("Checkout budget in result currency", { exact: true })).toHaveValue("");
    await expect(page.locator("#currency-notice")).toContainText("Re-enter your checkout budget and store delivery fees");
    await expect.poll(async () => (await current(page)).options.budget || "").toBe("");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("parimere:basket"))), { currency: "USD", stores: {} });
    await page.getByRole("button", { name: "Edit store delivery settings", exact: true }).click();
    await expect(page.getByLabel("Shared delivery", { exact: true })).toHaveValue("");
    await page.getByLabel("Shared delivery", { exact: true }).fill("7");
    await page.getByLabel("Shared delivery", { exact: true }).press("Tab");

    const imported = { schemaVersion: 1, name: "Imported euro budget", currency: "EUR", options: { budget: "45" },
      products: [
        { name: "A", price: "10", amount: "1", unit: "item", pack: "1", currency: "EUR" },
        { name: "B", price: "15", amount: "2", unit: "item", pack: "1", currency: "EUR" },
      ] };
    await openPanel(page, "Save, reopen and share comparisons");
    await page.getByLabel("Import comparison file", { exact: true }).setInputFiles({
      name: "euro.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)),
    });
    await page.getByRole("button", { name: "Accept imported comparison", exact: true }).click();
    await expect(page.locator("#currency")).toHaveValue("EUR");
    await expect(page.getByLabel("Checkout budget in result currency", { exact: true })).toHaveValue("45");
    assert.equal((await current(page)).options.budget, "45");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("parimere:basket"))), { currency: "EUR", stores: {} });
    await page.getByRole("button", { name: "Edit store delivery settings", exact: true }).click();
    await expect(page.getByLabel("Shared delivery", { exact: true })).toHaveValue("");
  } finally { await context.close(); }
  console.log("Passed: currency changes clear old budgets/fees; imports retain their own currency budget.");
}

async function malformedSchemas(browser) {
  const validProduct = { name: "Valid catalog product", price: "10", amount: "1", unit: "item", pack: "1", currency: "PHP" };
  const validDocument = { schemaVersion: 1, name: "Readable saved comparison", currency: "PHP", products: [validProduct, validProduct], options: {} };
  const original = {
    saved: JSON.stringify([{ id: "valid", document: validDocument }, { id: "broken", document: { schemaVersion: 99 } }]),
    catalog: JSON.stringify([{ id: "valid", key: "catalog", product: validProduct, history: [] }, { id: "broken", product: "invalid", history: [] }]),
    current: JSON.stringify({ invalid: true }),
    scenario: JSON.stringify({ schemaVersion: 1 }),
  };
  const context = await contextFor(browser, original);
  try {
    const page = await openPage(context);
    await expect(page.locator("#storage-notice")).toContainText("original collection has been kept");
    await expect(page.locator("#storage-notice")).toContainText("original catalog has been kept");
    await expect(page.locator("#storage-notice")).toContainText("open comparison could not be restored");
    await expect(page.locator("#storage-notice")).toContainText("original scenario could not be restored");
    await openPanel(page, "Save, reopen and share comparisons");
    await expect(page.getByLabel("Saved comparisons", { exact: true }).locator("option")).toHaveCount(2);
    await page.getByRole("button", { name: "Save comparison", exact: true }).click();
    await page.locator(".product").first().locator(".pack-options > summary").click();
    await page.locator(".product").first().getByRole("button", { name: "Record price", exact: true }).click();
    await openPanel(page, "Compare scenarios");
    await page.getByRole("button", { name: "Capture original scenario", exact: true }).click();
    const stored = await page.evaluate(() => Object.fromEntries(["saved", "catalog", "current", "scenario"].map((key) => [key, localStorage.getItem("parimere:" + key)])));
    assert.deepEqual(stored, original, "Valid JSON with invalid schemas must remain recoverable after attempted writes.");
  } finally { await context.close(); }
  console.log("Passed: partially readable saved/catalog records and invalid current/scenario schemas retain their originals.");
}

async function recoverDeliverySettings(browser) {
  const document = { schemaVersion: 1, name: "Keep comparison", currency: "PHP", options: {}, products: [
    { name: "A", price: "10", amount: "1", unit: "item", pack: "1", currency: "PHP" },
    { name: "B", price: "15", amount: "2", unit: "item", pack: "1", currency: "PHP" },
  ] };
  const records = [
    { "Unspecified store": { shipping: "25", minimum: "100", freeShipping: "200" } },
    { currency: "USD", stores: [] },
    { currency: "PHP", stores: { "Unspecified store": { shipping: 25 } } },
    null,
  ];
  for (const [index, record] of records.entries()) {
    const original = JSON.stringify(record);
    const context = await contextFor(browser, { current: document, basket: original });
    try {
      const page = await openPage(context);
      await expect(page.locator("#storage-notice")).toContainText("original values have been kept");
      assert.equal(await page.evaluate(() => localStorage.getItem("parimere:basket")), original);
      await page.locator("#currency").selectOption("USD");
      assert.equal(await page.evaluate(() => localStorage.getItem("parimere:basket")), original);
      await openPanel(page, "Whole-store basket");
      await page.getByRole("button", { name: "Edit store delivery settings", exact: true }).click();
      await expect(page.getByLabel("Shared delivery", { exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Compare store totals", exact: true }).click();
      await expect(page.locator(".workspace-status")).toContainText("Recover or reset saved delivery settings");
      await openPanel(page, "Data on this device");
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download recovery data", exact: true }).click();
      const download = await event;
      assert.equal(JSON.parse(await fs.readFile(await download.path(), "utf8")).data.basket, original);

      if (index === 0) {
        page.removeAllListeners("dialog");
        page.once("dialog", (dialog) => dialog.dismiss());
        await page.getByRole("button", { name: "Reset saved delivery settings", exact: true }).click();
        assert.equal(await page.evaluate(() => localStorage.getItem("parimere:basket")), original);
        page.on("dialog", (dialog) => dialog.accept());
      }
      await page.getByRole("button", { name: "Reset saved delivery settings", exact: true }).click();
      await expect(page.locator("#storage-notice")).toBeHidden();
      await expect(page.getByLabel("Shared delivery", { exact: true })).toBeEnabled();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("parimere:basket"))), { currency: "USD", stores: {} });
      assert.equal((await current(page)).products[0].price, "10");
      await page.getByLabel("Shared delivery", { exact: true }).fill("9");
      await page.getByLabel("Shared delivery", { exact: true }).press("Tab");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("parimere:basket")).stores["Unspecified store"].shipping), "9");
    } finally { await context.close(); }
  }
  console.log("Passed: legacy/malformed delivery values survive startup/currency changes and reset only after confirmation.");
}

async function optimizationAndLayouts(browser) {
  const context = await contextFor(browser);
  try {
    const page = await openPage(context);
    await openPanel(page, "Plan the purchase");
    await page.getByLabel("Target quantity in base unit", { exact: true }).fill("2500");
    await page.getByRole("button", { name: "Find least-cost pack mix", exact: true }).click();
    await expect(page.locator(".workspace-panel").filter({ has: page.locator("summary", { hasText: "Plan the purchase" }) })).toContainText("Exact lowest checkout cost:");
    assert.equal(await page.evaluate(() => {
      const input = document.querySelector('.product input[id$="-price"]');
      input.value = "110";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return document.querySelector(".optimizer-actions").nextElementSibling.textContent;
    }), "", "Editing clears an already displayed optimizer result synchronously.");

    await context.route("**/optimizer-worker.mjs", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      assert.ok(source.includes("self.onmessage = ({ data }) => {"));
      await route.fulfill({ response, body: source.replace("self.onmessage = ({ data }) => {",
        "self.onmessage = async ({ data }) => { await new Promise(resolve => setTimeout(resolve, 500));") });
    });
    await page.getByRole("button", { name: "Find least-cost pack mix", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cancel pack search", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel pack search", exact: true }).click();
    await expect(page.getByText("Pack search cancelled.", { exact: true })).toBeVisible();
    await page.waitForTimeout(650);
    await expect(page.getByText("Pack search cancelled.", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Exact lowest checkout cost:/)).toHaveCount(0);

    await page.getByRole("button", { name: "Find least-cost pack mix", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cancel pack search", exact: true })).toBeVisible();
    assert.deepEqual(await page.evaluate(() => {
      const input = document.querySelector('.product input[id$="-price"]');
      input.value = "111";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const actions = document.querySelector(".optimizer-actions"), result = actions.nextElementSibling;
      return { cancelHidden: actions.lastElementChild.hidden, searchEnabled: !actions.firstElementChild.disabled,
        busy: result.hasAttribute("aria-busy"), result: result.textContent };
    }), { cancelHidden: true, searchEnabled: true, busy: false, result: "" }, "Input invalidates the active worker before the render debounce.");
    await expect(page.getByRole("button", { name: "Cancel pack search", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Find least-cost pack mix", exact: true })).toBeEnabled();
    await page.waitForTimeout(650);
    await expect(page.getByText(/^Exact lowest checkout cost:/)).toHaveCount(0);

    await fs.mkdir(output, { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('.product input[id$="-price"]').first().fill(String(width));
      await expect(page.locator('.product input[id$="-price"]').first()).toHaveValue(String(width));
      await page.getByRole("button", { name: "Find least-cost pack mix", exact: true }).click();
      await page.getByRole("button", { name: "Cancel pack search", exact: true }).click();
      await expect(page.getByText("Pack search cancelled.", { exact: true })).toBeVisible();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, "release-" + width + ".png") });
    }
  } finally { await context.close(); }
  console.log("Passed: real worker result, cancellation, edit invalidation and 320/390/1440px interactions/layout.");
}

async function exchangeRates(browser) {
  const context = await contextFor(browser);
  try {
    let fail = false;
    let requests = 0;
    await context.route("https://api.frankfurter.dev/**", async route => {
      requests++;
      const parts = new URL(route.request().url()).pathname.split("/");
      if (fail) return route.fulfill({ status: 503, body: "Unavailable" });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        base: parts.at(-2), quote: parts.at(-1), rate: 58.25,
        date: new Date().toISOString().slice(0, 10),
      }) });
    });
    const page = await openPage(context);
    await expect(page.locator("#currency")).toHaveValue("PHP");
    assert.equal(requests, 0, "Collapsed rates must not request network data");
    await page.locator("#exchange-panel > summary").click();
    await expect(page.locator("#exchange-rates strong")).toHaveCount(4);
    await expect(page.locator("#exchange-rates")).toContainText("1 USD = 58.25 PHP");
    fail = true;
    await page.locator("#exchange-refresh").click();
    await expect(page.locator("#exchange-rates")).toContainText("unavailable. Refresh to retry.");
    fail = false;
    await page.locator("#exchange-refresh").click();
    await expect(page.locator("#exchange-rates strong")).toHaveCount(4);
    await page.locator("#currency").selectOption("EUR");
    await expect(page.locator("#exchange-rates")).toContainText("1 USD = 58.25 EUR");
    await expect(page.locator("#exchange-base")).toHaveText("in EUR");
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, "exchange-" + width + ".png") });
    }
  } finally { await context.close(); }
  console.log("Passed: regional exchange rates, lazy requests, failure/retry, currency changes and responsive layout.");
}

(async () => {
  const server = spawn(process.execPath, ["serve.mjs"], {
    cwd: root, env: { ...process.env, PORT: String(port), PARIMERE_ORIGIN: url, PARIMERE_SYNC: "0", PARIMERE_TRUST_PROXY: "0" },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Release test server did not start")), 10000);
      server.stdout.on("data", (data) => {
        if (String(data).includes("Parimere:")) { clearTimeout(timer); resolve(); }
      });
      server.once("error", (error) => { clearTimeout(timer); reject(error); });
      server.once("exit", () => { clearTimeout(timer); reject(new Error("Release test server exited before startup")); });
    });
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const storage = await import("../dist/storage.mjs");
    await editorIsolation(browser);
    await recoveryAndLargeCollections(browser, storage);
    await malformedSchemas(browser);
    await recoverDeliverySettings(browser);
    await currencyBoundaries(browser);
    await optimizationAndLayouts(browser);
    await exchangeRates(browser);
    assert.deepEqual(errors, [], "No unhandled browser errors are permitted.");
    console.log("Release-fix browser regressions passed. No household service or user browser data was used.");
  } finally {
    await browser?.close();
    if (server.exitCode === null) server.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
