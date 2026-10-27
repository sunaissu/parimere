// Exercises the generated Android JavaScript with a mocked Capacitor bridge.
// This verifies JS integration; an installed-device test is still required.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { once } = require("node:events");
const { chromium } = require("@playwright/test");
const zxing = require("@zxing/library");

const root = path.resolve(__dirname, ".."), assets = path.join(root, "mobile-dist");
const origin = "http://127.0.0.1:4194";
const types = { html: "text/html", mjs: "text/javascript", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", gz: "application/gzip", webmanifest: "application/manifest+json" };
const ready = async (page) => {
  await page.locator("#startup").waitFor({ state: "hidden" });
  await page.locator("#app-shell").waitFor({ state: "visible" });
};
const openDetails = (page) => page.evaluate(() => {
  const tools = document.querySelector('.workspace');
  if (tools && !tools.matches(':popover-open')) tools.showPopover();
  for (const item of document.querySelectorAll("details")) item.open = true;
});

(async () => {
  const config = JSON.parse(await fs.readFile(path.join(root, "capacitor.config.json"), "utf8"));
  assert.equal(config.webDir, "mobile-dist");
  assert.equal(config.server.cleartext, false);
  assert.equal(config.android.allowMixedContent, false);
  assert.equal(config.android.webContentsDebuggingEnabled, false);
  assert.equal(config.plugins.CapacitorHttp.enabled, false);
  const entries = await fs.readdir(assets);
  for (const excluded of ["sw.js", "serve.mjs", "households.mjs", "data", ".env", "node_modules"])
    assert.ok(!entries.includes(excluded), excluded + " must not ship as an Android web asset");
  for (const file of ["native.bundle.mjs", "vendor/tesseract.min.js", "vendor/worker.min.js", "vendor/zxing-browser.min.js", "vendor/lang/eng.traineddata.gz"])
    assert.ok((await fs.stat(path.join(assets, file))).size > 0, file + " must be bundled");
  const html = await fs.readFile(path.join(assets, "index.html"), "utf8");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /connect-src 'self';/);
  assert.doesNotMatch(html.match(/http-equiv="Content-Security-Policy"[^>]+/)[0], /frankfurter/);
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
      const file = path.resolve(assets, "." + (pathname === "/" ? "/index.html" : pathname));
      if (!file.startsWith(assets + path.sep)) throw new Error("Invalid path");
      const body = await fs.readFile(file);
      response.writeHead(200, { "Content-Type": types[file.split(".").pop()] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  let browser;
  try {
    server.listen(4194, "127.0.0.1");
    await once(server, "listening");
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-PH" });
    const externalRequests = [], assetRequests = [], errors = [];
    context.on("request", (request) => assetRequests.push(request.url()));
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        externalRequests.push(route.request().url());
        await route.abort();
      } else await route.continue();
    });
    await context.addInitScript(() => {
      const calls = [], listeners = {};
      window.__bridge = { calls, listeners, fetches: [], registrations: [], violations: [], failure: null };
      window.addEventListener("securitypolicyviolation", (event) => window.__bridge.violations.push({
        directive: event.violatedDirective, blocked: event.blockedURI,
      }));
      window.androidBridge = {};
      window.Capacitor = {
        isNativePlatform: () => true,
        PluginHeaders: [
          { name: "App", methods: [{ name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "callback" }, { name: "minimizeApp", rtype: "promise" }] },
          { name: "Filesystem", methods: ["readdir", "deleteFile", "writeFile", "rmdir"].map(name => ({ name, rtype: "promise" })) },
          { name: "Share", methods: [{ name: "share", rtype: "promise" }] },
          { name: "ParimerePrint", methods: [{ name: "print", rtype: "promise" }] },
        ],
        nativePromise: async (plugin, method, options) => {
          calls.push({ plugin, method, options });
          if (window.__bridge.failure === plugin + "." + method) throw new Error("Mock native failure");
          if (method === "readdir") return { files: [{ name: "old.json", mtime: Date.now() - 90000000 }, { name: "recent.json", mtime: Date.now() }] };
          if (method === "writeFile") return { uri: "content://parimere-test/" + options.path };
          return {};
        },
        nativeCallback: (plugin, method, options, callback) => {
          calls.push({ plugin, method, options });
          if (method === "addListener") listeners[options.eventName] = callback;
          return "mock-listener";
        },
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        window.__bridge.fetches.push(String(args[0]));
        return originalFetch(...args);
      };
      navigator.serviceWorker.register = async (...args) => {
        window.__bridge.registrations.push(args);
        throw new Error("Native app must not register a service worker");
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(origin);
    await ready(page);
    assert.equal(await page.locator("html").evaluate((element) => element.classList.contains("native-app")), true);
    assert.equal(await page.getByText("Optional household sharing", { exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__bridge.registrations), []);
    assert.deepEqual(await page.evaluate(() => window.__bridge.calls.filter(call => call.method === "deleteFile").map(call => call.options.path)), ["parimere-exports/old.json"]);
    assert.ok(await page.evaluate(() => !!window.__bridge.listeners.backButton));
    await openDetails(page);
    await page.locator('select[id$="-currency"]').first().selectOption("USD");
    const rate = page.locator('input[id$="-exchangeRate"]').first();
    assert.equal(await rate.getAttribute("readonly"), null);
    await rate.fill("60");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("parimere:current"))?.products[0]?.exchangeRate === "60");
    assert.equal(await page.locator(".rate-mode:visible").count(), 0);
    assert.equal(await page.locator(".retry-rate:visible").count(), 0);
    await page.reload();
    await ready(page);
    await openDetails(page);
    assert.equal(await rate.inputValue(), "60");
    const document = {
      schemaVersion: 1, name: "Imported Android FX", currency: "PHP", options: {},
      products: [
        { name: "Imported", price: "1", amount: "1", unit: "item", pack: "1", currency: "USD", exchangeRate: "58.1234", fx: { mode: "auto", pair: "USD/PHP", date: "2026-10-20" } },
        { name: "Local", price: "70", amount: "1", unit: "item", pack: "1", currency: "PHP" },
      ],
    };
    await page.getByLabel("Import comparison file", { exact: true }).setInputFiles({ name: "import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    await page.getByRole("button", { name: "Accept imported comparison", exact: true }).click();
    await openDetails(page);
    assert.equal(await rate.inputValue(), "58.1234");
    assert.equal(await rate.getAttribute("readonly"), null);
    await page.getByRole("button", { name: "Share file preview", exact: true }).click();
    await page.getByRole("button", { name: "Share this comparison", exact: true }).click();
    await page.waitForFunction(() => window.__bridge.calls.some(call => call.method === "share"));
    const exportCalls = await page.evaluate(() => window.__bridge.calls.filter(call => ["writeFile", "share"].includes(call.method)));
    assert.equal(exportCalls[0].plugin, "Filesystem");
    assert.equal(exportCalls[0].options.directory, "CACHE");
    assert.equal(exportCalls[0].options.encoding, "utf8");
    assert.match(exportCalls[0].options.path, /^parimere-exports\/[^/]+-parimere-comparison\.json$/);
    assert.equal(JSON.parse(exportCalls[0].options.data).products[0].exchangeRate, "58.1234");
    assert.equal(exportCalls[1].plugin, "Share");
    assert.deepEqual(exportCalls[1].options.files, ["content://parimere-test/" + exportCalls[0].options.path]);
    await page.evaluate(() => window.__bridge.listeners.backButton({ canGoBack: false }));
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.__bridge.calls.filter(call => call.method === "minimizeApp").length), 0);
    await page.getByRole("button", { name: "Share CSV report", exact: true }).click();
    await page.waitForFunction(() => window.__bridge.calls.filter(call => call.method === "writeFile").length === 2);
    assert.match(await page.evaluate(() => window.__bridge.calls.filter(call => call.method === "writeFile").at(-1).options.data), /"resultCurrency"/);
    await page.getByRole("button", { name: "Print report", exact: true }).click();
    await page.waitForFunction(() => window.__bridge.calls.some(call => call.plugin === "ParimerePrint" && call.method === "print"));
    await page.evaluate(async () => {
      const original = history.back;
      history.back = () => { window.__historyBack = true; };
      await window.__bridge.listeners.backButton({ canGoBack: true });
      history.back = original;
    });
    assert.equal(await page.evaluate(() => window.__historyBack), true);
    await page.evaluate(() => window.__bridge.listeners.backButton({ canGoBack: false }));
    assert.equal(await page.evaluate(() => window.__bridge.calls.filter(call => call.method === "minimizeApp").length), 1);
    assert.equal(await page.evaluate(async () => {
      try { await (await import("/platform.mjs")).saveFile("private", "../escape.json", "application/json"); }
      catch (error) { return error.message; }
    }), "Invalid export filename.");
    // Decode real image files with the bundled engines and generated mobile CSP.
    // All requests outside the packaged asset origin are blocked above.
    const ocr = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 220;
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "black";
      context.font = "bold 64px Arial";
      context.fillText("MILK 189.00 PHP", 35, 120);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const { capturePhoto } = await import("/capture.mjs");
      return (await capturePhoto(new File([blob], "label.png", { type: "image/png" }), "ocr")).text;
    });
    assert.match(ocr, /189\.00/);
    const matrix = new zxing.QRCodeWriter().encode("5901234123457", zxing.BarcodeFormat.QR_CODE, 320, 320, null);
    const bits = Array.from({ length: 320 }, (_, y) => Array.from({ length: 320 }, (_, x) => matrix.get(x, y)));
    const barcode = await page.evaluate(async (bits) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 320;
      const context = canvas.getContext("2d");
      for (let y = 0; y < 320; y++)
        for (let x = 0; x < 320; x++) {
          context.fillStyle = bits[y][x] ? "black" : "white";
          context.fillRect(x, y, 1, 1);
        }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const { capturePhoto } = await import("/capture.mjs");
      return capturePhoto(new File([blob], "barcode.png", { type: "image/png" }), "barcode");
    }, bits);
    assert.equal(barcode, "5901234123457");
    for (const path of ["/vendor/tesseract.min.js", "/vendor/worker.min.js", "/vendor/lang/eng.traineddata.gz", "/vendor/zxing-browser.min.js"])
      assert.ok(assetRequests.includes(origin + path), "Capture must load bundled " + path);
    assert.ok(assetRequests.some((url) => url.startsWith(origin + "/vendor/core/")), "OCR must load its bundled WASM core");
    assert.deepEqual(await page.evaluate(() => window.__bridge.violations), []);
    await page.getByRole("button", { name: "Delete all local data", exact: true }).click();
    await page.getByRole("heading", { name: "Local data deleted", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.__bridge.calls.some(call => call.plugin === "Filesystem" && call.method === "rmdir" && call.options.path === "parimere-exports" && call.options.recursive)));
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert.deepEqual(await page.evaluate(() => window.__bridge.fetches), []);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
    console.log("Android JS bridge checks passed: bundled assets/CSP, real OCR and barcode decoding with external access blocked, no remote FX/households/SW, manual/imported rates, exports, print, Back, cache cleanup and local erasure. Real Android installation/device behavior remains unverified.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
