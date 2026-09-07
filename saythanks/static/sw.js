/* ==========================================================================
   SayThanks.io — Progressive Web App (PWA) Service Worker
   Offline-first caching, shell resilience, and background sync support.
   ========================================================================== */

const CACHE_VERSION = 'saythanks-v1';
const STATIC_ASSETS = [
  '/',
  '/thanks',
  '/static/manifest.json',
  '/static/css/normalize.css',
  '/static/css/skeleton.css',
  '/static/css/saythanks.css',
  '/static/css/carbonads.css',
  '/static/css/jquery.modal.min.css',
  '/static/js/offline-outbox.js',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/images/owly.svg',
  '/static/images/inbox.png',
  'https://ajax.googleapis.com/ajax/libs/jquery/3.6.1/jquery.min.js'
];

// 1. Install: Pre-cache core application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[PWA SW] Pre-cache partial warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate: Clean up older cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_VERSION) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch: Stale-while-revalidate for assets, Network-first for pages
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only intercept GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Strategy A: Static assets & fonts -> Cache-first with network fallback
  if (
    url.pathname.startsWith('/static/') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('ajax.googleapis.com')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => cachedResponse);
      })
    );
    return;
  }

  // Strategy B: Navigation & HTML Pages -> Network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        return caches.match('/');
      })
  );
});

// 4. Background Sync: Auto-drain offline outbox when network returns
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-saythanks-outbox') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_OUTBOX_SYNC' });
        });
      })
    );
  }
});
