// Hutka service worker: offline app shell + "share to Hutka" from the Alfano app (Web Share Target). Since v34.27 it runs inside the
// Android app too: the app opened at the track with no signal starts from this cache, reads the lap timer and keeps the sessions for later.
// v34.57 (speed): the page opens from the copy on the device at once (it used to wait for the network first, up to 3.5 s on a weak
// signal, and download the whole page again on every open); the network refreshes the copy in the background, and when that brings a
// new version the page is told ("shell-updated") — it reloads itself if the person has not started anything yet, else next time.
// A copy older than 12 hours goes the old way: the network first, the copy after 3.5 s.
const V = 'hutka-shell-v123';
const SHELL = ['./', './index.html', './config.js', './geo.txt', './supabase.js', './manifest.webmanifest', './logo.png', './logo-dark.png', './icon-192.png'];
const FRESH_MS = 12 * 3600 * 1000;
self.addEventListener('install', (e) => { e.waitUntil((async () => { const c = await caches.open(V); for (const u of SHELL) { try { const r = await fetch(new Request(u, { cache: 'reload' })); if (r && r.ok) await c.put(u === './' || u === './index.html' ? new URL('./', self.registration.scope).href : new URL(u, self.registration.scope).href, await stamped(r)); } catch (err) {} } self.skipWaiting(); })()); });
self.addEventListener('activate', (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== V && k !== 'hutka-share') await caches.delete(k); await self.clients.claim(); })()); });
// a copy with the time it was taken (the Cache API keeps no date of its own)
const stamped = async (r) => { const h = new Headers(r.headers); h.set('x-hutka-at', String(Date.now())); return new Response(await r.clone().arrayBuffer(), { status: r.status, statusText: r.statusText, headers: h }); };
const ageOf = (r) => { const at = +(r && r.headers.get('x-hutka-at')) || 0; return at ? Date.now() - at : Infinity; };
const sameBody = (a, b) => { const ea = a.headers.get('etag'), eb = b.headers.get('etag'); if (ea && eb) return ea === eb; const la = a.headers.get('content-length'), lb = b.headers.get('content-length'); return !!(la && lb && la === lb); };
const tell = async (msg) => { for (const c of await self.clients.matchAll({ type: 'window' })) { try { c.postMessage(msg); } catch (e) {} } };
// the page and its settings fetched afresh and kept; true when the copy changed
async function refreshShell(keys) {
  const c = await caches.open(V); let changed = false;
  for (const u of keys) {
    try { const r = await fetch(new Request(u, { cache: 'no-cache' })); if (!r || !r.ok || r.type === 'opaque') continue; const key = u === './' || u === './index.html' ? new URL('./', self.registration.scope).href : new URL(u, self.registration.scope).href; const old = await c.match(key); if (!old || !sameBody(old, r)) changed = true; await c.put(key, await stamped(r)); } catch (e) {}
  }
  return changed;
}
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'refresh-shell') e.waitUntil((async () => { const changed = await refreshShell(['./', './config.js']); const src = e.source; try { (src || { postMessage() {} }).postMessage({ type: 'shell-refreshed', changed }); } catch (err) {} })());
});
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
  const pageLike = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/config.js');
  // one copy per file: a query (?code=…, ?v=…) is not another page, and the start page is one copy whether asked as / or /index.html
  const root = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  const key = root ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
  e.respondWith((async () => {
    const c = await caches.open(V);
    const hit = (await c.match(key)) || (root ? await c.match('./index.html') : null) || (await c.match(req, { ignoreSearch: true }));
    const net = fetch(req, pageLike ? { cache: 'no-cache' } : undefined);
    // the copy on the device, young enough: at once; the network refreshes it behind the page, and says when it brought a new version
    if (hit && ageOf(hit) < FRESH_MS) {
      e.waitUntil(net.then(async (r) => { if (!r || !r.ok || r.type === 'opaque') return; const changed = !sameBody(hit, r); await c.put(key, await stamped(r)); if (pageLike && changed) await tell({ type: 'shell-updated' }); }).catch(() => {}));
      return hit;
    }
    // no copy, or an old one: the network first — only a good answer is kept; on a weak signal the old copy after 3.5 s
    const keep = net.then(async (r) => { if (!r || !r.ok || r.type === 'opaque') return r; await c.put(key, await stamped(r.clone())); return r; });
    e.waitUntil(keep.catch(() => {}));
    if (hit) { const quick = await Promise.race([keep.then(r => r, () => null), new Promise(r => setTimeout(() => r(null), 3500))]); return quick && quick.ok ? quick : hit; }
    try { const r = await keep; if (r && r.ok) return r; return (pageLike && (await c.match('./index.html'))) || r || Response.error(); } catch (err) { return (pageLike && (await c.match('./index.html'))) || Response.error(); }
  })());
});
