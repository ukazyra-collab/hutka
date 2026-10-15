// Hutka service worker: offline app shell + "share to Hutka" from the Alfano app (Web Share Target)
const V = 'hutka-shell-v71';
const SHELL = ['./', './index.html', './config.js', './geo.txt', './supabase.js', './manifest.webmanifest'];
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
  e.respondWith((async () => {
    const c = await caches.open(V);
    if (pageLike) { try { const r = await fetch(req, { cache: 'no-cache' }); c.put(req, r.clone()); return r; } catch (err) { return (await c.match(req)) || (await c.match('./index.html')) || Response.error(); } }
    const hit = await c.match(req); const net = fetch(req).then(r => { c.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
