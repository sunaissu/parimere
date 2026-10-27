const assert = require("node:assert/strict");
const { once } = require("node:events");
const { chromium } = require("@playwright/test");

(async () => {
  const { createAppServer } = await import("../serve.mjs");
  const port = 4197, origin = "http://127.0.0.1:" + port;
  const server = createAppServer({ port });
  let browser;
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    const context = await browser.newContext();
    const page = await context.newPage(), workers = [], violations = [];
    page.on("worker", (worker) => workers.push(worker.url()));
    await page.exposeFunction("reportPolicyViolation", (directive) => violations.push(directive));
    await page.addInitScript(() => addEventListener("securitypolicyviolation", (event) =>
      window.reportPolicyViolation(event.violatedDirective)));
    await page.goto(origin + "/privacy.html");
    await page.evaluate(async () => {
      const { createOptimizerClient } = await import("./optimizer-client.mjs");
      window.createOptimizerClient = createOptimizerClient;
      window.product = (price, amount, extra = {}) => ({
        price: String(price), amount: String(amount), unit: "item", pack: "1", currency: "PHP", ...extra,
      });
      window.simple = [product(7, 6), product(5, 4)];
      window.heavy = Array.from({ length: 12 }, (_, i) => product("123.456789", i + 1, {
        currency: "USD", exchangeRate: "58.1234567891", discount: "percent",
        discountValue: "12.345678", shipping: "12.345678", taxPercent: "12.345678",
        dutyPercent: "12.345678", feePercent: "12.345678", fixedFee: "12.345678",
        deposit: "12.345678", rebate: "12.345678",
      }));
      window.optimizer = createOptimizerClient();
    });
    const exact = await page.evaluate(() => optimizer.run(simple, "PHP", "10"));
    assert.deepEqual(exact, { counts: [1, 1], cost: 12, quantity: 10, leftover: 0 });
    assert.ok(workers.some((url) => url === origin + "/optimizer-worker.mjs"));

    const invalid = await page.evaluate(() => optimizer.run(simple, "PHP", "0").catch((error) => error.message));
    assert.match(invalid, /greater than zero/);
    assert.deepEqual(await page.evaluate(() => optimizer.run(simple, "PHP", "10")), exact);

    const responsive = await page.evaluate(async () => {
      let ticks = 0, maxGap = 0, last = performance.now();
      const started = last;
      const timer = setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
        ticks++;
      }, 20);
      try {
        const result = await optimizer.run(heavy, "PHP", "29989");
        return { result, ticks, maxGap, elapsed: performance.now() - started };
      } finally { clearInterval(timer); }
    });
    assert.equal(responsive.result.quantity, 29989);
    assert.ok(responsive.elapsed < 500 || responsive.ticks >= 2, "Main-thread heartbeat must continue during optimization");
    assert.ok(responsive.maxGap < 1000, "Optimization must not freeze the main thread");

    const cancelled = await page.evaluate(async () => {
      const started = performance.now();
      const result = optimizer.run(heavy, "PHP", "29989").catch((error) => error.name);
      setTimeout(() => optimizer.cancel(), 50);
      return { name: await result, elapsed: performance.now() - started };
    });
    assert.equal(cancelled.name, "AbortError");
    assert.ok(cancelled.elapsed < 1000, "Cancellation must not wait for the algorithm to finish");

    const replaced = await page.evaluate(async () => {
      const old = optimizer.run(heavy, "PHP", "29989").catch((error) => error.name);
      const current = optimizer.run(simple, "PHP", "10");
      return { old: await old, current: await current };
    });
    assert.equal(replaced.old, "AbortError");
    assert.deepEqual(replaced.current, exact);

    const timeout = await page.evaluate(async () => {
      const client = createOptimizerClient({ timeoutMs: 150 });
      try { return await client.run(heavy, "PHP", "29989").catch((error) => error.name); }
      finally { client.dispose(); }
    });
    assert.equal(timeout, "TimeoutError");

    const disposed = await page.evaluate(async () => {
      const pending = optimizer.run(heavy, "PHP", "29989").catch((error) => error.name);
      optimizer.dispose();
      return [await pending, await optimizer.run(simple, "PHP", "10").catch((error) => error.name)];
    });
    assert.deepEqual(disposed, ["AbortError", "AbortError"]);

    await page.evaluate(async () => {
      await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    const offline = await page.evaluate(async () => {
      const client = createOptimizerClient();
      try { return await client.run(simple, "PHP", "10"); }
      finally { client.dispose(); }
    });
    assert.deepEqual(offline, exact);
    assert.deepEqual(violations, []);
    console.log("Optimizer browser checks passed: real worker, exact results, validation, responsiveness, cancellation, supersession, timeout, disposal, offline assets and CSP.");
    console.log(JSON.stringify({ optimizationMs: Math.round(responsive.elapsed), heartbeatTicks: responsive.ticks, maxHeartbeatGapMs: Math.round(responsive.maxGap) }));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
