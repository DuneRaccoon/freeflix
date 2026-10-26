/*
 * The web app's service worker. Hand-written and served as a plain static file, so it never
 * passes through the Next build — `ServiceWorkerRegistrar` registers it in production only.
 *
 * WHAT IT DOES NOT TOUCH matters more than what it does. Everything under /api and /_backend
 * is auth-gated, per-profile, or a video stream served with Range requests; caching any of it
 * would hand one profile another's data or break seeking. Those requests are never
 * intercepted (no respondWith), so the browser handles them exactly as it would without a
 * worker. Pages are never cached either: the HTML depends on who is signed in.
 *
 * What it does cache:
 *   - /_next/static/*  cache-first. File names are content-hashed, so a hit is always right.
 *   - /icons, /avatars stale-while-revalidate.
 *   - navigations      network-first; offline, the precached /offline.html instead.
 *
 * Bump VERSION to discard every cache on the next activation.
 */
const VERSION = 'v1';
const SHELL_CACHE = `fre-shell-${VERSION}`;
const STATIC_CACHE = `fre-static-${VERSION}`;
const STATIC_LIMIT = 300;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/manifest.webmanifest'];

/**
 * Which strategy a request gets, or null to leave it alone entirely. Pure, so it is
 * exported for the test at the bottom of the file.
 */
function strategyFor(request, origin) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  if (request.headers.has('range')) return null;
  const path = url.pathname;
  if (path.startsWith('/api/') || path.startsWith('/_backend/')) return null;
  // The TV surface is its own app with its own budget; it gets no worker behaviour.
  if (path === '/bigscreen' || path.startsWith('/bigscreen/')) return null;
  if (request.mode === 'navigate') return 'network-first';
  if (path.startsWith('/_next/static/')) return 'cache-first';
  if (path.startsWith('/icons/') || path.startsWith('/avatars/')) return 'stale-while-revalidate';
  return null;
}

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // Cache keys come back in insertion order, so the oldest go first.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((k) => cache.delete(k)));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
    trim(STATIC_CACHE, STATIC_LIMIT);
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then((response) => {
    if (response.ok) cache.put(event.request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  return network;
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    throw err;
  }
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(SHELL_CACHE)
        .then((cache) => cache.addAll(PRECACHE))
        .then(() => self.skipWaiting()),
    );
  });

  self.addEventListener('activate', (event) => {
    const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
    event.waitUntil(
      caches.keys()
        .then((names) => Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))))
        .then(() => self.clients.claim()),
    );
  });

  self.addEventListener('fetch', (event) => {
    const strategy = strategyFor(event.request, self.location.origin);
    if (strategy === 'network-first') event.respondWith(networkFirst(event.request));
    else if (strategy === 'cache-first') event.respondWith(cacheFirst(event.request));
    else if (strategy === 'stale-while-revalidate') event.respondWith(staleWhileRevalidate(event));
  });
}

if (typeof module !== 'undefined') module.exports = { strategyFor };
