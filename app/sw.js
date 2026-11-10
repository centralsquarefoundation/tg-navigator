// Offline support. Shell and lesson data: network first, cached copy when offline.
// Page images: cache first (they never change for a given content version).
const VERSION = '__VERSION__';
const SHELL = ['./', 'index.html', 'styles.css?v=__VERSION__', 'app.js?v=__VERSION__', 'manifest.webmanifest', 'icon.svg',
  'fonts/noto-sans-devanagari.woff2', 'fonts/noto-sans-latin.woff2', 'data/index.json', __DATA_FILES__, __BRAND_FILES__];
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
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL_CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (await caches.match('index.html'))));
});
