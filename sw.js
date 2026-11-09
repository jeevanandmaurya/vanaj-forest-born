// Keeps the game on the phone, so a second visit downloads almost nothing and it still loads with no network. (A browser also keeps
// the compiled form of scripts it gets from here, which is what makes the physics engine's WebAssembly start faster the second time.)
//
// The game's own code and page: from the network when there is one, so a new version is never missed, revalidated cheaply with a 304; if
// the network is gone or slow, from here. Libraries, models, fonts and pictures hardly ever change and are large: from here, first.
const CACHE = 'vanaj-v2', SLOW_MS = 1500;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

const keep = async (req, res) => { if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(CACHE); await c.put(req, res.clone()); } return res; };

async function cacheFirst(req) {
  const hit = await caches.match(req);
  return hit || keep(req, await fetch(req));
}
async function networkFirst(req) {
  const net = fetch(req, { cache: 'no-cache' }).then((res) => keep(req, res));
  const hit = await caches.match(req, { ignoreSearch: true });
  if (!hit) return net;
  // (a slow connection gets what is here now, and the fresh copy for next time)
  return Promise.race([net.catch(() => hit), new Promise((r) => setTimeout(() => r(hit), SLOW_MS))]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) { if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(cacheFirst(req)); return; }
  if (url.pathname.startsWith('/.')) return;   // (local test tools)
  e.respondWith(/\/(lib|assets)\//.test(url.pathname) ? cacheFirst(req) : networkFirst(req));
});
