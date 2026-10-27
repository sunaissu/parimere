const CACHE = "parimere-v2.0.11",
  FILES = [
    "/",
    "/index.html",
    "/style.css",
    "/app.mjs",
    "/startup.mjs",
    "/platform.mjs",
    "/default-currency.mjs",
    "/privacy.html",
    "/creator-mark.svg",
    "/sunaissu-logo.svg",
    "/math.mjs",
    "/planning.mjs",
    "/optimizer-client.mjs",
    "/optimizer-worker.mjs",
    "/edit-session.mjs",
    "/storage.mjs",
    "/workspace.mjs",
    "/capture.mjs",
    "/household.mjs",
    "/manifest.webmanifest",
    "/icon.svg",
    "/icon-192.png",
    "/icon-512.png",
    "/THIRD_PARTY_NOTICES.txt",
  ];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("parimere-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !FILES.includes(url.pathname)
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then(
            (value) =>
              value ||
              new Response("Offline asset unavailable", { status: 503 }),
          ),
      ),
  );
});
