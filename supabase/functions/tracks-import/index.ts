// Hutka — tracks from OpenStreetMap: every named karting venue of an area (a country "FR", or a US state "US-CA") becomes a track
// page with a "Main" layout; where the map has the raceway drawn, the middle of the asphalt is the layout's line (kept in media:
// tracks/<id>/layouts/main/media/line, so the catalogue stays light), with its length. Idempotent: ids come from the OSM element
// (osm-w123); a venue Hutka has already (the same element, a track within 300 m, or within 1 km under the same name) is left alone.
// Who may run it: the import queue (a cron job sends one area at a time with the token kept in the Vault: x-import-token), or an
// admin (his own session token). Body: { area: "FR", dry?: true } — dry: nothing written, the counts and a sample returned.
// Data © OpenStreetMap contributors (ODbL): the track pages say so.
// Deploy as `tracks-import` with "Verify JWT" OFF (checked here).
import { createClient } from "npm:@supabase/supabase-js@2";
import { venuesOf, distM, nameKey, type El, type Venue } from "./lib.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-import-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const MIRRORS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

// three light questions (an "around" over the venues' outlines is slow on the public servers): the area's karting
// venues; the raceways in small boxes around them; the towns (for a venue whose address has none). The whole run stays inside the
// function's time (a server that hangs is left for the next one, and the area for the queue's next try)
const areaOf = (area: string) => /^US-[A-Z]{2}$/.test(area) ? `area["ISO3166-2"="${area}"]->.a;` : `area["ISO3166-1"="${area}"]["admin_level"="2"]->.a;`;
const qVenues = (area: string) => `[out:json][timeout:90];${areaOf(area)}nwr["sport"="karting"](area.a);out tags center bb;`;   // the exact value: the tag index answers it
const qTowns = (area: string) => `[out:json][timeout:90];${areaOf(area)}node["place"~"^(city|town)$"](area.a);out body;`;
function qRaceways(venues: El[]): string | null {
  const boxes: number[][] = [];   // [south, west, north, east], 800 m round each venue, overlapping ones merged
  for (const e of venues) {
    const p = e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : e.center; if (!p) continue;
    const dLat = 800 / 111320, dLon = 800 / (111320 * Math.cos(p.lat * Math.PI / 180));
    let b = [p.lat - dLat, p.lon - dLon, p.lat + dLat, p.lon + dLon];
    if (e.bounds) b = [Math.min(b[0], e.bounds.minlat), Math.min(b[1], e.bounds.minlon), Math.max(b[2], e.bounds.maxlat), Math.max(b[3], e.bounds.maxlon)];
    const hit = boxes.find(x => !(b[2] < x[0] || b[0] > x[2] || b[3] < x[1] || b[1] > x[3]));
    if (hit) { hit[0] = Math.min(hit[0], b[0]); hit[1] = Math.min(hit[1], b[1]); hit[2] = Math.max(hit[2], b[2]); hit[3] = Math.max(hit[3], b[3]); } else boxes.push(b);
  }
  if (!boxes.length) return null;
  return `[out:json][timeout:90];(${boxes.map(b => `way["highway"="raceway"](${b.map(x => x.toFixed(5)).join(",")});`).join("")});out tags geom;`;
}
let deadline = 0;   // when the run has to stop asking (set per request)
async function overpass(q: string, ms = 55000): Promise<{ elements: El[]; mirror: string }> {
  let last = "";
  for (const m of MIRRORS) {
    const left = deadline - Date.now(); if (left < 8000) { last = last || "out of time"; break; }
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), Math.min(ms, left));
    try {
      const r = await fetch(m, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Hutka track import (https://hutka.ai)" }, signal: ctl.signal });
      if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.elements)) { if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) { last = `${m}: ${j.remark}`.slice(0, 200); continue; } return { elements: j.elements, mirror: m }; } }
      last = `${m}: ${r.status}`;
    } catch (e) { last = `${m}: ${(e as Error).message || e}`; } finally { clearTimeout(timer); }
  }
  throw new Error("overpass: " + last);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  if (!serviceKey) return json({ error: "not_configured", detail: "service key" }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  // who: the queue's token (checked in the database, never stored here), or an admin
  let allowed = false; const tok = req.headers.get("x-import-token") || "";
  if (tok) { const { data } = await db.rpc("hutka_import_token_ok", { t: tok }); allowed = data === true; }
  if (!allowed && req.headers.get("Authorization")) {
    const sb = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await sb.auth.getUser(); if (user) { const { data: adm } = await sb.rpc("is_admin"); allowed = adm === true; }
  }
  if (!allowed) return json({ error: "forbidden" }, 403);
  let body: { area?: string; dry?: boolean } = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const area = String(body.area || "").toUpperCase(), dry = !!body.dry;
  if (area === "PING") {   // which map servers answer from here, and how fast (a run from the queue: area "PING")
    const out: Record<string, unknown> = {};
    for (const m of MIRRORS) { const t1 = Date.now(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000); try { const r = await fetch(m, { method: "POST", body: "data=" + encodeURIComponent("[out:json][timeout:10];node(1);out;"), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Hutka track import (https://hutka.ai)" }, signal: ctl.signal }); out[m] = { status: r.status, ms: Date.now() - t1, body: (await r.text()).slice(0, 120) }; } catch (e) { out[m] = { error: String((e as Error).message || e), ms: Date.now() - t1 }; } finally { clearTimeout(timer); } }
    await db.from("import_queue").update({ status: "done", result: out, finished_at: new Date().toISOString() }).eq("area", area); return json(out);
  }
  if (!/^([A-Z]{2}|US-[A-Z]{2})$/.test(area)) return json({ error: "bad_area" }, 400);
  const t0 = Date.now(), cc = area.slice(0, 2); deadline = t0 + 125000;   // the writes need the rest of the function's 150 s
  const done = async (result: Record<string, unknown>, status = "done") => { await db.from("import_queue").update({ status, result, finished_at: new Date().toISOString() }).eq("area", area); return json(result, status === "done" ? 200 : 502); };
  await db.from("import_queue").update({ status: "running", started_at: new Date().toISOString() }).eq("area", area);
  let els: El[] = [], mirror = "";
  try {
    const v = await overpass(qVenues(area)); mirror = v.mirror.replace(/^https:\/\/|\/api.*$/g, ""); els = v.elements;
    const qr = qRaceways(v.elements); if (qr) els = els.concat((await overpass(qr)).elements);
    const needTowns = v.elements.some(e => e.tags && e.tags.name && !(e.tags["addr:city"] || e.tags["addr:town"] || e.tags["addr:village"]));
    if (needTowns && Date.now() - t0 < 80000) { try { els = els.concat((await overpass(qTowns(area), 45000)).elements); } catch { /* no towns: the venues keep the address they have */ } }
  } catch (e) { return done({ area, error: String((e as Error).message || e).slice(0, 300), ms: Date.now() - t0 }, "error"); }
  const venues = venuesOf(els);
  // what Hutka has: the same element, a track within 300 m, or within 1 km under the same name
  // (in pages: the API answers 1000 rows at most)
  const known: { id: string; osm: string; name: string; lat: number; lon: number }[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await db.from("tracks").select("id, name:data->>name, osm:data->>osm, lat:data->lat, lon:data->lon").order("id").range(from, from + 999);
    if (error) return done({ area, error: "tracks: " + error.message, ms: Date.now() - t0 }, "error");
    for (const r of (data || []) as Record<string, unknown>[]) known.push({ id: String(r.id), osm: String(r.osm || ""), name: String(r.name || ""), lat: Number(r.lat), lon: Number(r.lon) });
    if (!data || data.length < 1000) break;
  }
  const fresh: Venue[] = [], skipped: string[] = [];
  for (const v of venues) {
    const dup = known.find(k => k.id === v.id || (k.osm && k.osm === v.osm) || (isFinite(k.lat) && isFinite(k.lon) && (distM(k, v) < 300 || (distM(k, v) < 1000 && nameKey(k.name) && nameKey(k.name) === nameKey(v.name)))));
    if (dup) { skipped.push(`${v.name} → ${dup.id}`); continue; }
    if (fresh.some(f => distM(f, v) < 120)) { skipped.push(`${v.name} (same place)`); continue; }
    fresh.push(v);
  }
  const withLine = fresh.filter(v => v.line).length;
  const summary = { area, mirror, elements: els.length, venues: venues.length, fresh: fresh.length, withLine, indoor: fresh.filter(v => v.indoor).length, skipped: skipped.length, sample: fresh.slice(0, 12).map(v => ({ name: v.name, city: v.city, line: v.line ? v.line.lengthM : 0, indoor: v.indoor })), skippedSample: skipped.slice(0, 8), dry, ms: 0 };
  if (dry) { summary.ms = Date.now() - t0; return done(summary); }
  // the pages: the track (light: the catalogue loads them all), its "Main" layout, the line in media
  const now = new Date().toISOString(), ts = Date.now();
  const tracks = fresh.map(v => ({ id: v.id, data: Object.assign({ name: v.name, city: v.city, country: cc, lat: v.lat, lon: v.lon, address: v.address, website: v.website, phone: v.phone, indoor: v.indoor, osm: v.osm, source: "osm", createdAt: ts, updatedAt: ts }, v.line ? { lengthM: v.line.lengthM } : {}), updated_at: now }));
  const layouts = fresh.map(v => ({ track_id: v.id, id: "main", data: Object.assign({ name: "Main", order: 0, cornerR: 110, widthM: v.line ? v.line.widthM : 8, createdAt: ts, updatedAt: ts }, v.line ? { lengthM: v.line.lengthM, line: { src: "osm", n: v.line.pts.length, lengthM: v.line.lengthM, driven: v.line.driven }, ...(v.line.driven ? { direction: v.line.dir } : {}) } : {}), updated_at: now }));
  const media = fresh.filter(v => v.line).map(v => ({ path: `tracks/${v.id}/layouts/main/media/line`, data: JSON.stringify({ v: 1, src: "osm", pts: v.line!.pts, ways: v.line!.ways, dir: v.line!.dir, driven: v.line!.driven }), updated_at: now }));
  const put = async (table: string, rows: Record<string, unknown>[]) => { for (let i = 0; i < rows.length; i += 200) { const { error } = await db.from(table).upsert(rows.slice(i, i + 200)); if (error) throw new Error(`${table}: ${error.message}`); } };
  try { await put("tracks", tracks); await put("layouts", layouts); await put("media", media); }
  catch (e) { summary.ms = Date.now() - t0; return done(Object.assign(summary, { error: String((e as Error).message || e).slice(0, 300) }), "error"); }
  summary.ms = Date.now() - t0;
  return done(Object.assign(summary, { added: tracks.length }));
});
