// Offline support. Shell and lesson data: network first, cached copy when offline.
// Page images: cache first (they never change for a given content version).
const VERSION = '7ad41d48d6';
const SHELL = ['./', 'index.html', 'styles.css?v=7ad41d48d6', 'app.js?v=7ad41d48d6', 'manifest.webmanifest', 'icon.svg',
  'fonts/noto-sans-devanagari.woff2', 'fonts/noto-sans-latin.woff2', 'data/index.json', "brand/haryana-emblem.png", "brand/nipun-haryana.png", "brand/csf-logo.png"];
// Guide data (~1 MB each) is cached the first time that class/subject is opened, not up front:
// a teacher usually needs one or two guides, and mobile data is precious.
const NETWORK_WAIT_MS = 4000;   // on a weak connection, fall back to the saved copy after this
const SHELL_CACHE = `tg-shell-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('tg-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('.webp')) {
    e.respondWith(caches.open('tg-pages').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  e.respondWith((async () => {
    const net = fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(SHELL_CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    });
    const saved = () => caches.match(e.request, { ignoreSearch: true });
    const slow = new Promise((res) => setTimeout(res, NETWORK_WAIT_MS)).then(async () => (await saved()) || net);
    try {
      return await Promise.race([net, slow]);
    } catch {
      return (await saved()) || (await caches.match('index.html'));
    }
  })());
});
