/* *
 * Service Worker for Luma Store PWA.
 * Provides offline support and caching strategies for EDS pages.
 * */
/* eslint-disable no-restricted-globals */

const CACHE_NAME = 'luma-store-v1';

// App shell resources to pre-cache on install
const APP_SHELL = [
  '/',
  '/styles/styles.css',
  '/scripts/aem.js',
  '/scripts/scripts.js',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

// Enable navigation preload to avoid SW slowing down network requests
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
    })(),
  );
});

// Cache-first strategy: serve from cache, fall back to network
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// Network-first strategy: try network, fall back to cache
async function networkFirst(request, event) {
  try {
    const preloadResponse = await event.preloadResponse;
    if (preloadResponse) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, preloadResponse.clone());
      return preloadResponse;
    }

    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    return caches.match('/') || new Response(
      '<h1>You are offline</h1><p>Please check your internet connection.</p>',
      { headers: { 'Content-Type': 'text/html' } },
    );
  }
}

// Fetch: apply caching strategies based on request type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Static assets (JS, CSS, fonts): cache-first
  if (/\.(js|css|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Images: cache-first with network fallback
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages: network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, event));
  }
});
