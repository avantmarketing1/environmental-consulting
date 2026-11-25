const CACHE_NAME = "ftf-consulting-v10";
const PRECACHE_URLS = [
  "/consulting/",
  "/consulting/app/",
  "/consulting/styles/ftf.css",
  "/consulting/app/lismore-engine.js",
  "/consulting/app/diagrams.js",
  "/consulting/app/pyodide-worker.js",
  "/consulting/app/app.js",
  "/consulting/data/lismore_rules.json",
  "/consulting/data/alstonville_climate.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // Cache-first ONLY for immutable static climate/rules JSON datasets
  if (url.pathname.startsWith("/consulting/data/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request)),
    );
    return;
  }

  // Network-first with offline cache fallback for APIs & app code (.html, .js, .css, .py)
  // so updates always activate immediately when online while still working 100% offline in the field.
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request)),
  );
});
