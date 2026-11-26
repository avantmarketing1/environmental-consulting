const CACHE_NAME = "ftf-consulting-v23";
const CDN_CACHE_NAME = "ftf-cdn-v1";

const PRECACHE_URLS = [
  "/consulting/",
  "/consulting/app/",
  "/consulting/styles/ftf.css",
  "/consulting/app/lismore-engine.js",
  "/consulting/app/diagrams.js",
  "/consulting/app/offline-store.js",
  "/consulting/app/pyodide-worker.js",
  "/consulting/app/app.js",
  "/consulting/data/lismore_rules.json",
  "/consulting/data/alstonville_climate.json",
];

// Protected Python engine files (cached best-effort when consultant is authenticated)
const PY_ENGINE_URLS = [
  "/consulting/py/enviro_comply/__init__.py",
  "/consulting/py/enviro_comply/data/alstonville_climate.json",
  "/consulting/py/enviro_comply/data/lismore_rules.json",
  "/consulting/py/enviro_comply/schemas/__init__.py",
  "/consulting/py/enviro_comply/schemas/ossm.py",
  "/consulting/py/enviro_comply/schemas/see.py",
  "/consulting/py/enviro_comply/engine/__init__.py",
  "/consulting/py/enviro_comply/engine/lismore_model.py",
  "/consulting/py/enviro_comply/engine/compliance_rules.py",
  "/consulting/py/enviro_comply/engine/see_rules.py",
  "/consulting/py/enviro_comply/cad/__init__.py",
  "/consulting/py/enviro_comply/cad/dxf_builder.py",
  "/consulting/py/enviro_comply/report/__init__.py",
  "/consulting/py/enviro_comply/report/docx_styles.py",
  "/consulting/py/enviro_comply/report/docx_builder.py",
  "/consulting/py/enviro_comply/report/see_docx_builder.py",
];

const IMMUTABLE_CDN_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "unpkg.com",
  "files.pythonhosted.org",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Best-effort precaching so unauthenticated public visitors never fail SW install on protected /app/ or /py/
      await Promise.allSettled(
        [...PRECACHE_URLS, ...PY_ENGINE_URLS].map(async (url) => {
          const resp = await fetch(url, { credentials: "same-origin" });
          if (resp && resp.ok && resp.type !== "opaqueredirect") {
            await cache.put(url, resp);
          }
        }),
      );
    }).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([CACHE_NAME, CDN_CACHE_NAME]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // Cache-first for immutable Pyodide WASM/wheels & Leaflet CDN assets so offline .docx/.dxf works in zero-signal paddocks
  if (IMMUTABLE_CDN_HOSTS.has(url.hostname)) {
    event.respondWith(
      caches.open(CDN_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const resp = await fetch(event.request);
        if (resp && (resp.ok || resp.type === "opaque")) {
          cache.put(event.request, resp.clone()).catch(() => {});
        }
        return resp;
      }),
    );
    return;
  }

  // Only intercept same-origin requests from here on
  if (url.origin !== self.location.origin) return;

  // Cache-first for immutable climate & rules JSON datasets
  if (url.pathname.startsWith("/consulting/data/")) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return resp;
        }),
      ),
    );
    return;
  }

  // Never cache mutable auth, file download, or explicit fresh spatial precheck endpoints
  if (
    url.pathname.startsWith("/consulting/api/auth/") ||
    url.pathname.startsWith("/consulting/api/files/") ||
    (url.pathname === "/consulting/api/spatial/precheck" && url.searchParams.get("fresh") === "1")
  ) {
    return;
  }

  // Network-first with offline cache fallback for app shell, JS, CSS, Python engine & read APIs
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp && resp.ok && resp.type !== "opaqueredirect") {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request)),
  );
});
