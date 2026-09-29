/* =========================================================
   MoneyMate - sw.js
   Minimal service worker: caches the app shell (HTML/CSS/JS/
   JSON/icons) so the app still opens - and its charts still
   render - without an internet connection. All charts are
   drawn with the native Canvas API (see js/charts.js), so
   there is no CDN script the app depends on to show graphs.
   Google Fonts (used only for the display font) are still
   requested from the network as usual and simply fall back
   to the system font the first time the device is offline.
   ========================================================= */

const CACHE_NAME = 'moneymate-cache-v5';

const APP_SHELL = [
  './',
  'index.html',
  'history.html',
  'budget.html',
  'goals.html',
  'css/style.css',
  'css/dashboard.css',
  'css/responsive.css',
  'js/app.js',
  'js/transactions.js',
  'js/budget.js',
  'js/goals.js',
  'js/summary.js',
  'js/charts.js',
  'data/categories.json',
  'manifest.json',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for same-origin app-shell files, network-first (with cache fallback) for everything else.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return response;
          })
          .catch(() => cached);
      })
    );
  } else {
    // External CDN resources: try network, fall back to cache if previously fetched
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
