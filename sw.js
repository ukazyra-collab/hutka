// Hutka service worker: offline app shell + "share to Hutka" from the Alfano app (Web Share Target). Since v34.27 it runs inside the
// Android app too: the app opened at the track with no signal starts from this cache, reads the lap timer and keeps the sessions for later.
const V = 'hutka-shell-v103';
const SHELL = ['./', './index.html', './config.js', './geo.txt', './supabase.js', './manifest.webmanifest', './logo.png', './logo-dark.png', './icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil((async () => { const c = await caches.open(V); for (const u of SHELL) { try { await c.add(new Request(u, { cache: 'reload' })); } catch (err) {} } self.skipWaiting(); })()); });
self.addEventListener('activate', (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== V && k !== 'hutka-share') await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  // files shared from another app land here (POST from the OS share sheet); keep them for the page and open the lab
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try { const fd = await req.formData(); const files = fd.getAll('file'); const cache = await caches.open('hutka-share'); let i = 0; for (const f of files) { if (!f || !f.name) continue; await cache.put(new Request(url.origin + url.pathname + '/' + (i++) + '/' + encodeURIComponent(f.name)), new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } })); } } catch (err) {}
      return Response.redirect('./#lab~share', 303);
    })());
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const isShell = SHELL.some(u => url.pathname.endsWith(u.replace('./', '/')) || url.pathname.endsWith('/'));
  if (!isShell) return;
  // the page itself: network first so updates arrive at once; the rest: cache first, refreshed in the background
  const pageLike = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/config.js');
  // one copy per file: a query (?code=…, ?v=…) is not another page, and the start page is one copy whether asked as / or /index.html
  const root = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  const key = root ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
  const c0 = caches.open(V), net = fetch(req, pageLike ? { cache: 'no-cache' } : undefined);
  // only a good answer is kept: a 404 or a server error page never replaces the copy that works
  e.waitUntil(net.then(async (r) => { if (!r || !r.ok || r.type === 'opaque') return; const copy = r.clone(); const c = await c0; await c.put(key, copy); }).catch(() => {}));
  e.respondWith((async () => {
    const c = await c0;
    const hit = (await c.match(key)) || (root ? await c.match('./index.html') : null) || (await c.match(req, { ignoreSearch: true }));
    if (pageLike && hit) {
      // a slow connection at the track: the copy on this device after 3.5 s (the network still refreshes it for the next start)
      const quick = await Promise.race([net.then(r => r, () => null), new Promise(r => setTimeout(() => r(null), 3500))]);
      return quick && quick.ok ? quick : hit;
    }
    if (hit) return hit;
    try { return await net; } catch (err) { return (pageLike && (await c.match('./index.html'))) || Response.error(); }
  })());
});
