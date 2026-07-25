/*
 * Trade Manager — production service worker.
 *
 * Strategy:
 *  - Navigation requests (the app document itself) and manifest.json:
 *    NETWORK-FIRST, falling back to cache when offline. This keeps the
 *    single-file app fresh whenever the device is online, while still
 *    allowing a fully offline launch.
 *  - Static assets (icons): CACHE-FIRST, since these never change
 *    without a version bump below.
 *
 * Updating: bump CACHE_VERSION whenever index.html/manifest.json/icons
 * change. The old cache is removed automatically on activate, and
 * skipWaiting()/clients.claim() below mean an already-open tab starts
 * being served by the new worker without requiring the user to close
 * every tab first — no reload is forced, so nothing interrupts active
 * use of the calculator (trades, session state, etc. all live in
 * localStorage, not in the service worker, so a worker update can
 * never affect in-progress app data).
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `trade-manager-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png'
];

const STATIC_ASSET_PATHS = [
  '/icons/'
];

function isStaticAsset(url){
  return STATIC_ASSET_PATHS.some(path => url.pathname.includes(path));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => { /* pre-cache best-effort — fetch handler still works without it */ })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET requests; let everything else pass through
  // untouched (e.g. any browser-internal or cross-origin request).
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const isManifest = url.pathname.endsWith('manifest.json');

  if (isNavigation || isManifest) {
    // NETWORK-FIRST: try fresh content, fall back to cache, then to the
    // cached app shell if this exact URL was never cached (e.g. deep link).
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  if (isStaticAsset(url)) {
    // CACHE-FIRST: static assets rarely change; serve instantly from
    // cache and only hit the network on a cache miss.
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  // Default: network-first with cache fallback, same as navigation, for
  // anything else same-origin that isn't explicitly categorized above.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Allows the page to ask the waiting worker to activate immediately
// (used by the optional "update available" UI hook in index.html).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
