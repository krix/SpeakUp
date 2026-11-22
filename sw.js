/**
 * Service Worker für SpeakUp.
 *
 * Strategie:
 *   - App-Shell (HTML, CSS, JS, Icons, Fonts): stale-while-revalidate
 *   - Navigation: network-first mit Offline-Fallback auf index.html
 *   - Vokabeldaten (data/*): stale-while-revalidate
 *   - Schreib-/Sprech-APIs: nicht abfangen
 *
 * Beim Aktualisieren wird der neue Worker erst nach einer Nutzer-Bestätigung
 * aktiv (SKIP_WAITING). So bleibt eine laufende Lernrunde ununterbrochen.
 */
const APP_VERSION = "1.7.7";
const SHELL_CACHE = `speakup-shell-v${APP_VERSION}`;
const DATA_CACHE = `speakup-data-v${APP_VERSION}`;

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/app.css",
  "./assets/fonts/nunito-latin.woff2",
  "./assets/fonts/nunito-latin-ext.woff2",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./js/app.js",
  "./js/core/answer.js",
  "./js/core/bus.js",
  "./js/core/config.js",
  "./js/core/csv.js",
  "./js/core/db.js",
  "./js/core/drive.js",
  "./js/core/handwriting.js",
  "./js/core/handwriting-cloud.js",
  "./js/core/hash.js",
  "./js/core/install.js",
  "./js/core/learner.js",
  "./js/core/library.js",
  "./js/core/photo-import.js",
  "./js/core/profiles.js",
  "./js/core/secrets.js",
  "./js/core/speech.js",
  "./js/core/speech-cloud.js",
  "./js/core/transfer.js",
  "./js/core/tts.js",
  "./js/core/westermann.js",
  "./js/ui/canvas.js",
  "./js/ui/confetti.js",
  "./js/ui/dom.js",
  "./js/ui/mascot.js",
  "./js/ui/medal.js",
  "./js/ui/wheel.js",
  "./js/ui/profile-switcher.js",
  "./js/ui/sfx.js",
  "./js/views/about.js",
  "./js/views/home.js",
  "./js/views/onboarding.js",
  "./js/views/parent.js",
  "./js/views/progress.js",
  "./js/views/session.js",
  "./data/index.json",
  "./data/tiere.csv",
  "./data/schule.csv",
  "./data/essen.csv",
  "./data/hobbys.csv",
  "./data/reisen.csv",
];

/** Entfernt den Query-String, damit ?v=… denselben Cache-Eintrag trifft. */
function normalizeUrl(url) {
  const parsed = new URL(url, self.registration.scope);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function cacheResponse(cacheName, url, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(cacheName);
  await cache.put(normalizeUrl(url), response.clone());
}

async function matchCache(cacheName, request) {
  const cache = await caches.open(cacheName);
  return (
    (await cache.match(request, { ignoreSearch: true })) ||
    (await cache.match(normalizeUrl(request.url), { ignoreSearch: true })) ||
    null
  );
}

async function staleWhileRevalidate(request, cacheName, fallbackCaches = []) {
  let cached = await matchCache(cacheName, request);
  if (!cached) {
    for (const fallback of fallbackCaches) {
      cached = await matchCache(fallback, request);
      if (cached) break;
    }
  }
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cacheResponse(cacheName, request.url, response);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Im Hintergrund aktualisieren; Fehler beim Offline-Sein ignorieren.
    network.catch(() => {});
    return cached;
  }
  const response = await network;
  if (response) return response;
  throw new Error(`Kein Cache-Eintrag für ${request.url}`);
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Die jeweils aktuelle HTML-Hülle für den Offline-Start merken.
      await cacheResponse(SHELL_CACHE, new URL("index.html", self.registration.scope), response);
    }
    return response;
  } catch {
    const cached =
      (await matchCache(SHELL_CACHE, new URL("index.html", self.registration.scope))) ||
      (await matchCache(SHELL_CACHE, new URL("./", self.registration.scope)));
    if (cached) return cached;
    return new Response(
      "<!doctype html><meta charset=\"utf-8\"><title>SpeakUp</title>" +
        "<p style=\"font-family:system-ui;padding:32px\">SpeakUp ist offline und die App-Hülle " +
        "wurde noch nicht gespeichert. Bitte einmal mit Internet öffnen.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function readIndex() {
  const indexUrl = new URL("data/index.json", self.registration.scope);
  const response = await fetch(indexUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { indexUrl, response, data: await response.clone().json() };
}

/** Prüft nur die Version – ohne den Cache zu verändern. */
async function checkDataVersion() {
  const { data } = await readIndex();
  return data?.version || null;
}

/** Lädt index.json und alle Themen-CSVs frisch in den Daten-Cache. */
async function refreshData() {
  const { indexUrl, response, data } = await readIndex();
  await cacheResponse(DATA_CACHE, indexUrl, response);

  const themes = Array.isArray(data?.themes) ? data.themes : [];
  await Promise.all(
    themes.map(async (theme) => {
      const file = String(theme?.file || "").trim();
      if (!/^[\w.-]+\.csv$/i.test(file) || file.includes("..")) return;
      const url = new URL(`data/${file}`, self.registration.scope);
      try {
        const csv = await fetch(url, { cache: "no-store" });
        if (csv.ok) await cacheResponse(DATA_CACHE, url, csv);
      } catch (error) {
        console.warn("[sw] CSV konnte nicht aktualisiert werden", file, error);
      }
    })
  );

  // Offene Tabs informieren, damit sie den Hinweis anzeigen können.
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: "SPEAKUP_DATA_UPDATED", version: data?.version || null });
  }

  return data?.version || null;
}

/* ---------- Lifecycle ---------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const response = await fetch(new Request(url, { cache: "reload" }));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await cache.put(url, response);
          } catch (error) {
            console.warn("[sw] Datei nicht vorgeladen:", url, error);
          }
        })
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = new Set([SHELL_CACHE, DATA_CACHE]);
      await Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data.type === "CHECK_DATA") {
    event.waitUntil(
      checkDataVersion()
        .then((version) => port?.postMessage({ ok: true, version }))
        .catch((error) => port?.postMessage({ ok: false, error: String(error?.message || error) }))
    );
    return;
  }

  if (data.type === "REFRESH_DATA") {
    event.waitUntil(
      refreshData()
        .then((version) => port?.postMessage({ ok: true, version }))
        .catch((error) => port?.postMessage({ ok: false, error: String(error?.message || error) }))
    );
  }
});

/* ---------- Fetch ---------- */

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Nur eigene Dateien behandeln. Sprach- und Handschrift-APIs laufen direkt.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  // Der Daten-Update-Check muss immer das Netz sehen.
  if (url.pathname.endsWith("/data/index.json") && url.searchParams.has("check")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.includes("/data/")) {
    event.respondWith(
      staleWhileRevalidate(request, DATA_CACHE, [SHELL_CACHE]).catch(() => fetch(request))
    );
    return;
  }

  event.respondWith(
    staleWhileRevalidate(request, SHELL_CACHE).catch(() => fetch(request))
  );
});
