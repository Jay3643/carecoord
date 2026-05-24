/* PDF Editor Pro — service worker
   Offline app shell + cache-first for local assets. Bump CACHE on every release. */
const CACHE = 'pdf-editor-v1';

// Relative URLs so the SW works at any mount path (/pdf-editor/, localhost, file host).
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './lib/pdf.min.js',
  './lib/pdf-lib.min.js',
  './lib/pdf.worker.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is atomic; add individually so one 404 can't break install.
      .then((cache) => Promise.all(SHELL.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Navigation requests: serve cached shell when offline so the app still launches.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  const url = new URL(req.url);

  // Same-origin assets: cache-first, then populate cache on miss.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached))
    );
    return;
  }

  // Cross-origin (e.g. Google Fonts): stale-while-revalidate, fall through if offline.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
