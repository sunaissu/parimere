import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openConfiguredStore } from "./households.mjs";
import { safeJSON } from "./dist/storage.mjs";
const files = [
  "index.html",
  "style.css",
  "app.mjs",
  "startup.mjs",
  "platform.mjs",
  "default-currency.mjs",
  "privacy.html",
  "robots.txt",
  "sitemap.xml",
  "guide.html",
  "product.txt",
  "creator-mark.svg",
  "math.mjs",
  "planning.mjs",
  "optimizer-client.mjs",
  "optimizer-worker.mjs",
  "edit-session.mjs",
  "workspace.mjs",
  "storage.mjs",
  "capture.mjs",
  "household.mjs",
  "sw.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "THIRD_PARTY_NOTICES.txt",
];
const allowed = new Map(files.map((name) => ["/" + name, name]));
allowed.set("/", "index.html");
for (const folder of ["vendor", "vendor/core", "vendor/lang"]) {
  try {
    for (const name of await readdir(
      new URL("./dist/" + folder + "/", import.meta.url),
    ))
      if (/^[a-zA-Z0-9@_.-]+\.(?:js|gz|txt|json)$/.test(name))
        allowed.set("/" + folder + "/" + name, folder + "/" + name);
  } catch {}
}
const types = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  png: "image/png",
  gz: "application/gzip",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
};
const csp =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.frankfurter.dev; worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";
export function createAppServer({
  port = 4189,
  configuredOrigin = "http://127.0.0.1:" + port,
  store = null,
  trustProxy = false,
} = {}) {
  const origin = new URL(configuredOrigin),
    limits = new Map();
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      "PARIMERE_ORIGIN must be an HTTP(S) origin without a path, credentials, query or fragment.",
    );
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) &&
    origin.protocol !== "https:"
  )
    throw new Error("A public deployment requires a configured HTTPS origin.");
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), microphone=(), geolocation=()",
    );
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Cache-Control", "no-store");
    const json = (data, status = 200) => {
      const text = JSON.stringify(data);
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(text),
        "Cache-Control": "no-store, private",
      });
      res.end(text);
    };
    try {
      const host = req.headers.host,
        local = new Set(["127.0.0.1:" + port, "localhost:" + port]);
      if (host !== origin.host && !local.has(host))
        return json({ error: "Unrecognized host." }, 403);
      const url = new URL(req.url, origin);
      if (url.pathname === "/api/service-info" && req.method === "GET")
        return json({
          name: "Parimere",
          version: "2.0.0",
          status: "ready",
          checkedAt: new Date().toISOString(),
          householdSync: !!store,
        });
      if (url.pathname.startsWith("/api/")) {
        if (!store)
          return json(
            {
              error:
                "Household sync is disabled on this server. Local comparisons and exports remain available.",
            },
            503,
          );
        const now = Date.now();
        for (const [key, value] of limits)
          if (value.until <= now) limits.delete(key);
        // Enable only behind a local proxy that overwrites this header.
        const ip = trustProxy
          ? req.headers["x-real-ip"]
          : req.socket.remoteAddress || "unknown";
        if (
          trustProxy &&
          (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress,
          ) ||
            typeof ip !== "string" ||
            !isIP(ip))
        )
          return json(
            { error: "The trusted local proxy must supply a valid X-Real-IP." },
            400,
          );
        const key = ip + (url.pathname === "/api/households" ? ":create" : ":api"),
          limit = url.pathname === "/api/households" ? 10 : 120,
          window = url.pathname === "/api/households" ? 3600000 : 60000;
        const count = limits.get(key) || { hits: 0, until: now + window };
        if (count.hits >= limit || limits.size > 10000)
          return json({ error: "Too many requests. Try again later." }, 429);
        count.hits++;
        limits.set(key, count);
        const requestOrigin = req.headers.origin;
        if (
          requestOrigin &&
          requestOrigin !== origin.origin &&
          !["http://127.0.0.1:" + port, "http://localhost:" + port].includes(
            requestOrigin,
          )
        )
          return json({ error: "Origin is not allowed." }, 403);
        let body = {};
        if (req.method !== "GET") {
          if (
            !requestOrigin ||
            req.headers["content-type"]?.split(";")[0] !== "application/json"
          )
            return json({ error: "Use same-origin JSON requests." }, 403);
          if (Number(req.headers["content-length"]) > 210000)
            return json({ error: "Request is too large." }, 413);
          const chunks = [];
          let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 210000) {
              json({ error: "Request is too large." }, 413);
              return;
            }
            chunks.push(chunk);
          }
          try {
            body = safeJSON(Buffer.concat(chunks).toString("utf8"), 210000);
          } catch {
            return json({ error: "Invalid or oversized JSON." }, 400);
          }
          if (!body || typeof body !== "object" || Array.isArray(body))
            return json({ error: "Use a JSON object." }, 400);
        }
        const credential = req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.slice(7)
          : null;
        return json(store.handle(req.method, url.pathname, body, credential));
      }
      if (!["GET", "HEAD"].includes(req.method))
        return json({ error: "Method not allowed." }, 405);
      const file = allowed.get(url.pathname);
      if (!file) return json({ error: "Not found." }, 404);
      if (file === "vendor/worker.min.js")
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'",
        );
      const data = await readFile(new URL("./dist/" + file, import.meta.url));
      res.writeHead(200, {
        "Content-Type":
          types[file.split(".").pop()] || "application/octet-stream",
        "Content-Length": data.length,
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      json(
        {
          error: error.status
            ? error.message
            : "The action could not be completed.",
        },
        error.status || 500,
      );
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const port = Number(process.env.PORT || 4189),
    store = openConfiguredStore(),
    server = createAppServer({
      port,
      configuredOrigin: process.env.PARIMERE_ORIGIN || "http://127.0.0.1:" + port,
      trustProxy: process.env.PARIMERE_TRUST_PROXY === "1",
      store,
    });
  server.listen(port, "127.0.0.1", () =>
    console.log("Parimere: http://127.0.0.1:" + server.address().port),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(() => {
        store?.close();
        process.exit(0);
      }),
    );
}
