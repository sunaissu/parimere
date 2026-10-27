const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const z = require("@zxing/library");
const root = path.resolve(__dirname, ".."),
  port = 4192,
  url = "http://127.0.0.1:" + port;
const waitForApp = async (page) => {
  await page.locator("#startup").waitFor({ state: "hidden" });
  await page.locator("#app-shell").waitFor({ state: "visible" });
  assert.equal(await page.locator("#app-shell").evaluate((element) => element.inert), false);
};
const openTools = async (page) => {
  await waitForApp(page);
  if (!(await page.locator(".workspace").evaluate((element) => element.open)))
    await page.locator(".workspace > summary").click();
};
(async () => {
  const server = spawn(process.execPath, ["serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), PARIMERE_SYNC: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server did not start")),
        10000,
      );
      server.stdout.on("data", (data) => {
        if (String(data).includes("Parimere:")) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Server exited before startup"));
      });
    });
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    const context = await browser.newContext({
      locale: 'en-PH',
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(url);
    await waitForApp(page);
    await page
      .locator("#winner-heading")
      .getByText("Big bottle wins.")
      .waitFor();
    for (const product of await page.locator(".product").all()) {
      assert.ok(await product.locator('input[id$="-price"]').isVisible());
      assert.ok(await product.locator('input[id$="-amount"]').isVisible());
      assert.ok(await product.locator('select[id$="-unit"]').isVisible());
      assert.equal(
        await product.locator('input[id$="-name"]').isVisible(),
        false,
      );
      assert.equal(
        await product
          .getByRole("button", { name: "Duplicate", exact: true })
          .isVisible(),
        false,
      );
    }
    assert.equal(
      await page
        .getByRole("button", { name: "Save / open", exact: true })
        .isVisible(),
      false,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Plan purchase", exact: true })
        .isVisible(),
      false,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Milk bottles", exact: true })
        .isVisible(),
      false,
    );
    await fs.mkdir(path.join(root, "qa"), { recursive: true });
    for (const [width, height] of [[1440, 1000], [1366, 768], [1000, 768]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => document.querySelector("#ranking").open);
      const layout = await page.evaluate(() => ({
        form: document.querySelector("#compare-form").getBoundingClientRect().toJSON(),
        results: document.querySelector(".results-panel").getBoundingClientRect().toJSON(),
        verdict: document.querySelector("#verdict").getBoundingClientRect().toJSON(),
        viewportHeight: innerHeight,
        overflows: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(layout.overflows, false, "Desktop layout should not overflow at " + width);
      assert.ok(layout.results.left >= layout.form.right, "Results should sit beside the form at " + width);
      assert.ok(Math.abs(layout.results.top - layout.form.top) <= 1, "Results should align with the top of the form at " + width);
      assert.ok(layout.verdict.top >= 0 && layout.verdict.bottom <= layout.viewportHeight, "The winner should be fully visible at " + width);
      assert.equal(await page.locator(".results-panel .workspace").count(), 0);
      await page.screenshot({
        path: path.join(root, "qa", "default-" + width + ".png"),
        fullPage: true,
      });
    }
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => !document.querySelector("#ranking").open);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.ok(
        await page.evaluate(() =>
          document.querySelector(".results-panel").getBoundingClientRect().top >=
          document.querySelector("#compare-form").getBoundingClientRect().bottom,
        ),
        "Mobile results should stack below the form.",
      );
      await page.screenshot({
        path: path.join(root, "qa", "default-" + width + ".png"),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => document.querySelector("#ranking").open);
    const packOptions = page.locator(".product").first().locator(".pack-options");
    await packOptions.locator(":scope > summary").click();
    await packOptions.locator(".extra-costs > summary").click();
    await page.evaluate(() => scrollTo({ top: 500, behavior: "instant" }));
    await page.waitForFunction(() =>
      scrollY > 0 &&
      Math.abs(document.querySelector(".results-panel").getBoundingClientRect().top - 24) <= 1,
    );
    const verdict = await page.locator("#verdict").boundingBox();
    assert.ok(
      verdict && verdict.y >= 0 && verdict.y + verdict.height <= 1000,
      "The winner should remain visible while editing expanded pack options: " +
        JSON.stringify(verdict),
    );
    await page.screenshot({
      path: path.join(root, "qa", "desktop-sticky-1440.png"),
    });
    await packOptions.locator(".extra-costs > summary").click();
    await packOptions.locator(":scope > summary").click();
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.locator("#ranking > summary").click();
    const firstPrice = page.locator(".product").first().locator('input[id$="-price"]');
    await firstPrice.fill("150");
    await page.locator(".product").first().locator(".unit-result > strong").getByText("PHP 20.00", { exact: false }).waitFor();
    assert.equal(await page.locator("#ranking").evaluate((element) => element.open), false);
    await firstPrice.fill("149");
    await page.locator(".product").first().locator(".unit-result > strong").getByText("PHP 19.87", { exact: false }).waitFor();
    await page.emulateMedia({ media: "print" });
    assert.deepEqual(await page.evaluate(() => ({
      layout: getComputedStyle(document.querySelector(".comparison-layout")).display,
      position: getComputedStyle(document.querySelector(".results-panel")).position,
      overflow: getComputedStyle(document.querySelector(".results-panel")).overflow,
    })), { layout: "block", position: "static", overflow: "visible" });
    for (const [disclosure, content] of [
      ["#ranking", "#ranking-list"],
      [".math", "#math-content"],
    ]) {
      assert.equal(
        await page.locator(disclosure).evaluate((element) => element.open),
        false,
      );
      assert.ok(
        await page
          .locator(content)
          .evaluate((element) =>
            element.checkVisibility({ contentVisibilityAuto: true }),
          ),
        "Printing should include " + content + " even when its disclosure is closed.",
      );
    }
    await page.emulateMedia({ media: "screen" });
    await page.locator("#ranking > summary").click();
    const pageCsp = (await context.request.get(url)).headers()[
      "content-security-policy"
    ];
    assert.ok(!pageCsp.includes("wasm-unsafe-eval"));
    assert.ok(
      (await context.request.get(url + "/vendor/worker.min.js"))
        .headers()
        ["content-security-policy"].includes("wasm-unsafe-eval"),
    );
    await openTools(page);
    await page
      .getByRole("button", { name: "Save / open", exact: true })
      .click();
    await page
      .getByLabel("Comparison name", { exact: true })
      .fill("Weekly shop");
    await page
      .getByRole("button", { name: "Save comparison", exact: true })
      .click();
    await page.reload();
    await waitForApp(page);
    assert.equal(
      await page.getByLabel("Comparison name", { exact: true }).inputValue(),
      "Weekly shop",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Save / open", exact: true })
        .isVisible(),
      false,
      "Advanced tools should remain collapsed when reopening a comparison.",
    );
    await page.getByRole("button", { name: "Clear comparison", exact: true }).click();
    await page
      .locator(".quick-tools")
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    assert.equal(
      await page.locator("#winner-heading").textContent(),
      "Big bottle wins.",
    );
    await page
      .locator(".product")
      .first()
      .locator(".pack-options > summary")
      .click();
    await page
      .locator(".product")
      .first()
      .getByRole("button", { name: "Duplicate", exact: true })
      .click();
    assert.equal(await page.locator(".product").count(), 3);
    await page
      .locator(".product")
      .last()
      .getByRole("button", { name: /Remove contender/ })
      .click();
    assert.equal(await page.locator(".product").count(), 2);
    await openTools(page);
    await page
      .getByRole("button", { name: "Plan purchase", exact: true })
      .click();
    await page
      .getByLabel("Target quantity in base unit", { exact: true })
      .fill("1800");
    await page
      .getByLabel("Checkout budget in result currency", { exact: true })
      .fill("400");
    await page.waitForTimeout(250);
    assert.match(
      await page.locator(".planning-report").textContent(),
      /Within budget/,
    );
    await openTools(page);
    await page
      .getByRole("button", { name: "Save / open", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Share file preview", exact: true })
      .click();
    const shared = JSON.parse(
      await page.locator("dialog[open] pre").textContent(),
    );
    assert.equal(shared.products.length, 2);
    assert.equal(shared.credential, undefined);
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV report", exact: true }).click();
    const file = await downloaded;
    const csv = await fs.readFile(await file.path(), "utf8");
    assert.match(csv, /rateDate/);
    assert.match(csv, /afterRebate/);
    assert.match(csv, /targetCheckout/);
    await page.getByText("Compare scenarios", { exact: true }).click();
    await page
      .getByRole("button", { name: "Capture original scenario", exact: true })
      .click();
    await page
      .locator(".product")
      .first()
      .locator('input[id$="-price"]')
      .fill("999");
    await page.waitForTimeout(250);
    assert.match(
      await page.locator(".scenario-grid").textContent(),
      /Original/,
    );
    await page
      .getByRole("button", { name: "Restore original", exact: true })
      .click();
    assert.equal(
      await page
        .locator(".product")
        .first()
        .locator('input[id$="-price"]')
        .inputValue(),
      "149",
    );
    const ocr = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 220;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 900, 220);
      ctx.fillStyle = "black";
      ctx.font = "bold 64px Arial";
      ctx.fillText("MILK 189.00 PHP", 35, 120);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const { capturePhoto } = await import("/capture.mjs");
      return (
        await capturePhoto(
          new File([blob], "label.png", { type: "image/png" }),
          "ocr",
        )
      ).text;
    });
    assert.match(ocr, /189\.00/);
    const matrix = new z.QRCodeWriter().encode(
        "5901234123457",
        z.BarcodeFormat.QR_CODE,
        320,
        320,
        null,
      ),
      bits = Array.from({ length: 320 }, (_, y) =>
        Array.from({ length: 320 }, (_, x) => matrix.get(x, y)),
      );
    const barcode = await page.evaluate(async (bits) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 320;
      const ctx = canvas.getContext("2d");
      for (let y = 0; y < 320; y++)
        for (let x = 0; x < 320; x++) {
          ctx.fillStyle = bits[y][x] ? "black" : "white";
          ctx.fillRect(x, y, 1, 1);
        }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const { capturePhoto } = await import("/capture.mjs");
      return capturePhoto(
        new File([blob], "code.png", { type: "image/png" }),
        "barcode",
      );
    }, bits);
    assert.equal(barcode, "5901234123457");
    await fs.mkdir(path.join(root, "qa"), { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() =>
        document.querySelectorAll("details").forEach((d) => (d.open = false)),
      );
      await page.evaluate(() => scrollTo(0, 0));
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: path.join(root, "qa", "review-" + width + ".png"),
        fullPage: true,
      });
    }
    // Real HTTP membership workflow: tokens and invitations never appear in test output.
    const call = async (method, p, body, credential, requestOrigin = url) => {
      const response = await fetch(url + p, {
        method,
        headers: {
          Origin: requestOrigin,
          "Content-Type": "application/json",
          ...(credential ? { Authorization: "Bearer " + credential } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        body: await response.json(),
        headers: response.headers,
      };
    };
    const created = await call("POST", "/api/households", {
      name: "Browser review",
      memberName: "First person",
    });
    assert.equal(created.status, 200);
    const owner = created.body,
      p = "/api/households/" + owner.id;
    try {
      const invitation = (
        await call("POST", p + "/invite", { confirmed: true }, owner.credential)
      ).body.invite.split(".")[1];
      const joined = (
        await call("POST", p + "/join", {
          invite: invitation,
          memberName: "Second person",
        })
      ).body;
      assert.notEqual(owner.credential, joined.credential);
      assert.equal(
        (
          await call(
            "PUT",
            p,
            { version: 0, confirmed: true, document: shared },
            joined.credential,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            "PUT",
            p,
            { version: 0, confirmed: true, document: shared },
            owner.credential,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await call(
            "PUT",
            p,
            { version: 1, confirmed: true, document: shared },
            owner.credential,
            "https://untrusted.invalid",
          )
        ).status,
        403,
      );
      const owned = await call("GET", p, undefined, owner.credential);
      assert.equal(owned.body.members.length, 2);
      assert.equal(owned.headers.get("cache-control"), "no-store, private");
      assert.equal(
        (await call("GET", p, undefined, "x".repeat(43))).status,
        401,
      );
      await call(
        "DELETE",
        p + "/members/" + joined.currentMember,
        { confirmed: true },
        owner.credential,
      );
      assert.equal(
        (await call("GET", p, undefined, joined.credential)).status,
        401,
      );
    } finally {
      assert.equal(
        (await call("DELETE", p, { confirmed: true }, owner.credential)).status,
        200,
      );
    }
    await openTools(page);
    await page.getByText("Optional household sharing", { exact: true }).click();
    await page
      .getByLabel("Your visible member name", { exact: true })
      .fill("UI owner");
    await page
      .getByLabel("Household name", { exact: true })
      .fill("UI review household");
    await page
      .getByRole("button", { name: "Create household", exact: true })
      .click();
    await page.getByText(/UI review household · Shared revision 0/).waitFor();
    const keyDownload = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "Download my private access key",
        exact: true,
      })
      .click();
    const keyFile = await keyDownload,
      key = JSON.parse(await fs.readFile(await keyFile.path(), "utf8"));
    let second;
    try {
      await page
        .getByRole("button", { name: "Disconnect this browser", exact: true })
        .click();
      await page
        .getByLabel("Reconnect with a private access key", { exact: true })
        .setInputFiles(await keyFile.path());
      await page.getByText(/UI review household · Shared revision 0/).waitFor();
      await page
        .getByRole("button", { name: "Create one-use invitation", exact: true })
        .click();
      const invitationCode = await page
        .getByLabel("Private invitation code", { exact: true })
        .inputValue();
      second = await browser.newContext();
      const guest = await second.newPage();
      guest.on("dialog", (d) => d.accept());
      await guest.goto(url);
      await openTools(guest);
      await guest
        .getByText("Optional household sharing", { exact: true })
        .click();
      await guest
        .getByLabel("Your visible member name", { exact: true })
        .fill("UI member");
      await guest
        .getByLabel("Invitation code", { exact: true })
        .fill(invitationCode);
      await guest
        .getByRole("button", { name: "Join by invitation", exact: true })
        .click();
      await guest.getByText(/UI member · You/).waitFor();
      await page
        .getByRole("button", { name: "Reload shared revision", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Review and share current comparison",
          exact: true,
        })
        .click();
      await page
        .locator("dialog[open]")
        .getByRole("button", { name: "Share reviewed copy", exact: true })
        .click();
      await page.getByText(/Shared revision 1/).waitFor();
      await guest
        .getByRole("button", {
          name: "Review and share current comparison",
          exact: true,
        })
        .click();
      await guest
        .locator("dialog[open]")
        .getByRole("button", { name: "Share reviewed copy", exact: true })
        .click();
      await guest
        .locator(".workspace-status")
        .getByText(/Another member changed/)
        .waitFor();
      await guest
        .locator("dialog[open]")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Revoke member", exact: true })
        .click();
      await guest
        .getByRole("button", { name: "Reload shared revision", exact: true })
        .click();
      await guest.getByText("Not connected.", { exact: true }).waitFor();
    } finally {
      await second?.close();
      await call(
        "DELETE",
        "/api/households/" + key.id,
        { confirmed: true },
        key.credential,
      );
    }
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await waitForApp(page);
    await context.setOffline(true);
    await page.reload();
    await waitForApp(page);
    assert.equal(
      await page.locator("#winner-heading").textContent(),
      "Big bottle wins.",
    );
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    const { documentData } = await import("../dist/storage.mjs");
    const zeroBasisDocument = documentData({
      schemaVersion: 1,
      name: "Saved zero comparison basis",
      currency: "PHP",
      products: [
        {
          name: "Little bottle",
          price: "149",
          amount: "750",
          unit: "ml",
          pack: "1",
          currency: "PHP",
        },
        {
          name: "Big bottle",
          price: "189",
          amount: "1",
          unit: "L",
          pack: "1",
          currency: "PHP",
        },
      ],
      options: { basis: "0" },
    });
    for (const savedRate of [false, true]) {
      const reviewedRateDocument = {
        ...zeroBasisDocument,
        products: [
          { ...zeroBasisDocument.products[0], unit: "item", amount: "1", price: "1", currency: "USD", exchangeRate: "60", store: " Market ",
            ...(savedRate ? { fx: { mode: "auto", pair: "USD/PHP", date: "2026-10-19" } } : {}) },
          { ...zeroBasisDocument.products[1], unit: "item", amount: "1", price: "70", store: "Market" },
        ],
      };
      const reviewContext = await browser.newContext({
        serviceWorkers: "block",
        storageState: { cookies: [], origins: [{ origin: url, localStorage: [
          { name: "parimere:current", value: JSON.stringify(reviewedRateDocument) },
          { name: "parimere:preferences", value: JSON.stringify({ locale: "de-DE" }) },
        ] }] },
      });
      try {
        const reviewPage = await reviewContext.newPage();
        let rateRequests = 0;
        await reviewPage.route("https://api.frankfurter.dev/**", (route) => { rateRequests++; return route.abort(); });
        await reviewPage.goto(url);
        await waitForApp(reviewPage);
        await reviewPage.locator("#winner-heading").getByText("Little bottle wins.", { exact: true }).waitFor();
        assert.equal(await reviewPage.locator('input[id$="-exchangeRate"]').first().inputValue(), "60");
        assert.match(await reviewPage.locator(".unit-result > strong").first().textContent(), /60,00/);
        assert.match(await reviewPage.locator("#math-content").textContent(), savedRate ? /Saved rate \(2026-10-19\)/ : /Your rate: 1 USD/);
        assert.equal(rateRequests, 0, "A reviewed saved or explicit manual rate must not be silently replaced.");
        await openTools(reviewPage);
        await reviewPage.getByText("Whole-store basket", { exact: true }).click();
        await reviewPage.getByRole("button", { name: "Edit store delivery settings", exact: true }).click();
        assert.equal(await reviewPage.getByLabel("Shared delivery", { exact: true }).count(), 1);
        await reviewPage.getByLabel("Shared delivery", { exact: true }).fill("5");
        await reviewPage.getByRole("button", { name: "Compare store totals", exact: true }).click();
        await reviewPage.getByText(/Market:.*135,00/).waitFor();
        await reviewPage.locator(".product").first().locator(".pack-options > summary").click();
        await reviewPage.locator(".product").first().getByRole("button", { name: "Record price", exact: true }).click();
        await reviewPage.getByText("Saved products, barcodes & price history", { exact: true }).click();
        await reviewPage.getByRole("button", { name: "Find barcode", exact: true }).click();
        await reviewPage.locator(".workspace-status").getByText("Enter a barcode before searching saved products.", { exact: true }).waitFor();
        assert.equal(await reviewPage.locator(".product").count(), 2);
      } finally {
        await reviewContext.close();
      }
    }
    const captureContext = await browser.newContext({ serviceWorkers: "block" });
    try {
      await captureContext.route("**/capture.mjs", (route) => route.fulfill({
        contentType: "text/javascript",
        body: 'export function capturePhoto(file, mode) { globalThis.requestedCaptureMode = mode; return new Promise(resolve => { globalThis.releaseCapture = () => resolve({ text: "MILK 12.50", preview: document.createElement("canvas") }); }); }',
      }));
      const capturePage = await captureContext.newPage();
      await capturePage.goto(url);
      await openTools(capturePage);
      await capturePage.getByText("Saved products, barcodes & price history", { exact: true }).click();
      await capturePage.getByLabel("Capture barcode or receipt photo", { exact: true }).setInputFiles({
        name: "receipt.png", mimeType: "image/png", buffer: Buffer.from("controlled capture fixture"),
      });
      await capturePage.waitForFunction(() => typeof releaseCapture === "function");
      const mode = capturePage.getByLabel("Photo capture purpose", { exact: true });
      assert.equal(await mode.isDisabled(), true);
      await mode.evaluate((select) => { select.value = "barcode"; });
      await capturePage.evaluate(() => releaseCapture());
      await capturePage.getByRole("heading", { name: "Review extracted text", exact: true }).waitFor();
      assert.equal(await capturePage.getByLabel("Reviewed price", { exact: true }).inputValue(), "12.50");
      assert.equal(await mode.isDisabled(), false);
      assert.equal(await capturePage.evaluate(() => requestedCaptureMode), "ocr");
    } finally {
      await captureContext.close();
    }
    const deletionContext = await browser.newContext();
    try {
      const deletionPage = await deletionContext.newPage();
      await deletionPage.goto(url);
      await waitForApp(deletionPage);
      await deletionPage.evaluate(async () => {
        await navigator.serviceWorker.ready;
        localStorage.setItem("parimere:catalog", "[]");
        localStorage.setItem("parimere:saved", "[]");
        localStorage.setItem("unrelated:data", "preserve me");
        sessionStorage.setItem("parimere:test-session", "erase me");
        sessionStorage.setItem("unrelated:session", "preserve me");
        await caches.open("parimere-test-delete");
        await caches.open("unrelated-delete-test");
      });
      const otherTab = await deletionContext.newPage();
      await otherTab.goto(url);
      await waitForApp(otherTab);
      await otherTab.evaluate(() => sessionStorage.setItem("parimere:test-session", "erase from second tab"));
      await openTools(deletionPage);
      await deletionPage.getByText("Data on this device", { exact: true }).click();
      deletionPage.once("dialog", (dialog) => dialog.dismiss());
      await deletionPage.getByRole("button", { name: "Delete all local data", exact: true }).click();
      assert.equal(await deletionPage.locator("#data-reset").count(), 0);
      assert.equal(await deletionPage.evaluate(() => localStorage.getItem("parimere:catalog")), "[]");
      deletionPage.once("dialog", (dialog) => dialog.accept());
      await deletionPage.getByRole("button", { name: "Delete all local data", exact: true }).click();
      await deletionPage.getByRole("heading", { name: "Local data deleted", exact: true }).waitFor();
      await otherTab.getByRole("heading", { name: "Local data deleted", exact: true }).waitFor();
      for (const tab of [deletionPage, otherTab]) {
        const remaining = await tab.evaluate(async () => {
          dispatchEvent(new Event("beforeunload"));
          return {
            local: Object.keys(localStorage).filter((key) => key.startsWith("parimere:")),
            session: Object.keys(sessionStorage).filter((key) => key.startsWith("parimere:")),
            caches: await caches.keys(),
            unrelated: localStorage.getItem("unrelated:data"),
          };
        });
        assert.deepEqual(remaining.local, []);
        assert.deepEqual(remaining.session, []);
        assert.equal(remaining.caches.some((key) => key.startsWith("parimere-")), false);
        assert.ok(remaining.caches.includes("unrelated-delete-test"));
        assert.equal(remaining.unrelated, "preserve me");
      }
      assert.equal(await deletionPage.evaluate(() => sessionStorage.getItem("unrelated:session")), "preserve me");
    } finally {
      await deletionContext.close();
    }
    const recoveredContext = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [
          {
            origin: url,
            localStorage: [
              {
                name: "parimere:current",
                value: JSON.stringify(zeroBasisDocument),
              },
            ],
          },
        ],
      },
    });
    try {
      const recoveredPage = await recoveredContext.newPage(),
        recoveryErrors = [];
      recoveredPage.on("pageerror", (error) => recoveryErrors.push(error.message));
      await recoveredPage.goto(url);
      const winner = recoveredPage.locator("#winner-heading"),
        firstProduct = recoveredPage.locator(".product").first(),
        price = firstProduct.locator('input[id$="-price"]'),
        size = firstProduct.locator('input[id$="-amount"]');
      await winner.getByText("Big bottle wins.", { exact: true }).waitFor();
      await price.fill("99");
      await winner.getByText("Little bottle wins.", { exact: true }).waitFor();
      await size.fill("400");
      await winner.getByText("Big bottle wins.", { exact: true }).waitFor();
      await recoveredPage.reload();
      await winner.getByText("Big bottle wins.", { exact: true }).waitFor();
      assert.equal(await price.inputValue(), "99");
      assert.equal(await size.inputValue(), "400");
      await price.fill("50");
      await winner.getByText("Little bottle wins.", { exact: true }).waitFor();
      assert.deepEqual(recoveryErrors, []);
    } finally {
      await recoveredContext.close();
    }
    const startupDocument = documentData({
      ...zeroBasisDocument,
      name: "Saved startup comparison",
      products: [
        { ...zeroBasisDocument.products[0], price: "50" },
        zeroBasisDocument.products[1],
      ],
    });
    const savedStartupComparison = JSON.stringify([
      { id: "startup-fixture", document: startupDocument, at: "2026-10-20" },
    ]);
    const startupContext = await browser.newContext({
      reducedMotion: "reduce",
      storageState: {
        cookies: [],
        origins: [
          {
            origin: url,
            localStorage: [
              { name: "parimere:current", value: JSON.stringify(startupDocument) },
              { name: "parimere:saved", value: savedStartupComparison },
            ],
          },
        ],
      },
    });
    let releaseApp;
    const appGate = new Promise((resolve) => { releaseApp = resolve; });
    try {
      const startupPage = await startupContext.newPage(),
        startupErrors = [];
      startupPage.on("pageerror", (error) => startupErrors.push(error.message));
      await startupPage.route("**/app.mjs", async (route) => {
        await appGate;
        await route.continue();
      });
      await startupPage.goto(url, { waitUntil: "commit" });
      await startupPage.locator("#startup").waitFor({ state: "visible" });
      assert.match(await startupPage.locator("#startup-status").textContent(), /Opening Parimere/);
      assert.equal(await startupPage.locator("#app-shell").isVisible(), false);
      assert.ok(await startupPage.locator("#app-shell").evaluate((element) => element.hidden && element.inert));
      assert.equal(await startupPage.locator("#startup-recovery").isVisible(), false);
      assert.doesNotMatch(await startupPage.locator("#startup").innerText(), /\d+(?:\.\d+)?%/);
      assert.ok(await startupPage.locator("#startup").evaluate((element) =>
        [element, ...element.querySelectorAll("*")]
          .filter((item) => !item.closest("#startup-recovery"))
          .every((item) => getComputedStyle(item).animationName.split(",").every((name) => name.trim() === "none")),
      ), "Reduced motion should disable decorative splash animations.");
      assert.equal(await startupPage.locator("#verdict").getAttribute("aria-busy"), "true");
      assert.match(await startupPage.locator("#winner-heading").textContent(), /Loading/);
      assert.doesNotMatch(
        await startupPage.locator("#verdict").textContent(),
        /\bwins\b|\d+(?:\.\d+)?%/i,
      );
      assert.equal(await startupPage.locator("#saving-value").textContent(), "");
      assert.equal(await startupPage.locator("#ranking").isVisible(), false);
      await startupPage.locator("#startup-recovery").waitFor({ state: "visible", timeout: 12000 });
      assert.equal(await startupPage.locator("#app-shell").isVisible(), false);
      assert.doesNotMatch(await startupPage.locator("#startup").innerText(), /\d+(?:\.\d+)?%/);
      await startupPage.evaluate(async () => {
        await caches.open("parimere-test-stale");
        const unrelated = await caches.open("unrelated-cache");
        await unrelated.put("/unrelated-marker", new Response("preserve me"));
      });
      releaseApp();
      await waitForApp(startupPage);
      await startupPage
        .locator("#winner-heading")
        .getByText("Little bottle wins.", { exact: true })
        .waitFor();
      assert.equal(await startupPage.locator("#verdict").getAttribute("aria-busy"), "false");
      await startupPage.evaluate(() => navigator.serviceWorker.ready);
      await startupPage.waitForFunction(() => navigator.serviceWorker.controller !== null);
      const preserved = await startupPage.evaluate(async () => ({
        caches: await caches.keys(),
        unrelated: await (await caches.open("unrelated-cache")).match("/unrelated-marker")
          .then((response) => response?.text()),
        current: JSON.parse(localStorage.getItem("parimere:current")),
        saved: localStorage.getItem("parimere:saved"),
      }));
      assert.equal(preserved.caches.includes("parimere-test-stale"), false);
      assert.equal(preserved.caches.filter((key) => key.startsWith("parimere-")).length, 1);
      assert.equal(preserved.unrelated, "preserve me");
      assert.equal(preserved.current.name, startupDocument.name);
      assert.equal(preserved.current.products[0].price, "50");
      assert.equal(preserved.current.products[0].amount, "750");
      assert.equal(preserved.current.options.basis, "0");
      assert.equal(preserved.saved, savedStartupComparison);
      assert.deepEqual(startupErrors, []);
    } finally {
      releaseApp();
      await startupContext.close();
    }
    const failureContext = await browser.newContext({
      serviceWorkers: "block",
      storageState: {
        cookies: [],
        origins: [{ origin: url, localStorage: [{ name: "parimere:current", value: JSON.stringify(startupDocument) }] }],
      },
    });
    try {
      const failurePage = await failureContext.newPage();
      await failurePage.route("**/app.mjs", (route) => route.abort());
      await failurePage.goto(url);
      await failurePage.locator("#startup.failed").waitFor({ state: "visible" });
      assert.equal(await failurePage.locator("#startup-status").textContent(), "Parimere could not open.");
      assert.equal(await failurePage.locator("#app-shell").isVisible(), false);
      assert.ok(await failurePage.locator("#app-shell").evaluate((element) => element.inert));
      assert.equal(await failurePage.evaluate(() => localStorage.getItem("parimere:current")), JSON.stringify(startupDocument));
      await failurePage.unroute("**/app.mjs");
      await failurePage.locator("#startup-recovery").click();
      await waitForApp(failurePage);
      await failurePage.locator("#winner-heading").getByText("Little bottle wins.", { exact: true }).waitFor();
    } finally {
      await failureContext.close();
    }
    const noScriptContext = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
    try {
      const noScriptPage = await noScriptContext.newPage();
      await noScriptPage.goto(url);
      await noScriptPage.locator("noscript").getByText(/JavaScript/i).waitFor({ state: "visible" });
      assert.equal(await noScriptPage.locator("#app-shell").isVisible(), false);
      assert.ok(await noScriptPage.locator("noscript").getByRole("link", { name: /reload/i }).isVisible());
    } finally {
      await noScriptContext.close();
    }
    const stalledContext = await browser.newContext({
      serviceWorkers: "block",
    });
    await stalledContext.route("**/vendor/worker.min.js", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: "// Deliberately stalled engine for cleanup regression.",
      }),
    );
    const stalledPage = await stalledContext.newPage();
    await stalledPage.goto(url);
    await waitForApp(stalledPage);
    await stalledPage.clock.install();
    await stalledPage.evaluate(async () => {
      const { capturePhoto } = await import("/capture.mjs");
      const c = document.createElement("canvas");
      c.width = c.height = 20;
      const blob = await new Promise((resolve) => c.toBlob(resolve));
      const Native = globalThis.Worker;
      globalThis.terminated = 0;
      globalThis.started = false;
      globalThis.Worker = class extends Native {
        constructor(...args) {
          super(...args);
          globalThis.started = true;
        }
        terminate() {
          globalThis.terminated++;
          super.terminate();
        }
      };
      globalThis.pendingOCR = capturePhoto(
        new File([blob], "stalled.png", { type: "image/png" }),
        "ocr",
      ).then(
        () => null,
        (error) => error.message,
      );
    });
    await stalledPage.waitForFunction(() => globalThis.started);
    await stalledPage.clock.fastForward(46000);
    const cleanup = await stalledPage.evaluate(async () => ({
      message: await globalThis.pendingOCR,
      terminated: globalThis.terminated,
    }));
    assert.match(cleanup.message, /45 seconds/);
    assert.equal(cleanup.terminated, 1);
    await stalledContext.close();
    console.log(
      "Chrome passed: focused initial comparison, saved comparison reload, regional currency formatting, reviewed manual/saved FX preservation, trimmed basket settings, blank barcode rejection, stable in-flight capture mode, two-tab local data deletion and cancellation, zero-basis recovery, slow/failing startup, reduced motion, no-JavaScript fallback, scoped offline-cache cleanup, undo, duplication, target/budget, reviewed export, CSV, scenarios, real local OCR/barcode, strict page CSP, responsive layouts, real household HTTP isolation/conflicts/revocation and offline reload.",
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
