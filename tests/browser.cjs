const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const z = require("@zxing/library");
const root = path.resolve(__dirname, ".."),
  port = 4192,
  url = "http://127.0.0.1:" + port;
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
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(url);
    await page
      .locator("#winner-heading")
      .getByText("Big bottle wins.")
      .waitFor();
    const pageCsp = (await context.request.get(url)).headers()[
      "content-security-policy"
    ];
    assert.ok(!pageCsp.includes("wasm-unsafe-eval"));
    assert.ok(
      (await context.request.get(url + "/vendor/worker.min.js"))
        .headers()
        ["content-security-policy"].includes("wasm-unsafe-eval"),
    );
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
    assert.equal(
      await page.getByLabel("Comparison name", { exact: true }).inputValue(),
      "Weekly shop",
    );
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
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
      .getByRole("button", { name: "Duplicate", exact: true })
      .click();
    assert.equal(await page.locator(".product").count(), 3);
    await page
      .locator(".product")
      .last()
      .getByRole("button", { name: /Remove contender/ })
      .click();
    assert.equal(await page.locator(".product").count(), 2);
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
    await context.setOffline(true);
    await page.reload();
    assert.equal(
      await page.locator("#winner-heading").textContent(),
      "Big bottle wins.",
    );
    await context.setOffline(false);
    assert.deepEqual(errors, []);
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
      "Chrome passed: saved comparison reload, undo, duplication, target/budget, reviewed export, CSV, scenarios, real local OCR/barcode, strict page CSP, 320/390/1440 px layouts, real household HTTP isolation/conflicts/revocation and offline reload.",
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
