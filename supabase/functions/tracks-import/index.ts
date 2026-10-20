// Hutka — tracks from OpenStreetMap (read through QLever, qlever.ts): every named karting venue of an area (a country "FR", or a US state "US-CA") becomes a track
// page with a "Main" layout; where the map has the raceway drawn, the middle of the asphalt is the layout's line (kept in media:
// tracks/<id>/layouts/main/media/line, so the catalogue stays light), with its length. Idempotent: ids come from the OSM element
// (osm-w123); a venue Hutka has already (the same element, a track within 300 m, or within 1 km under the same name) is left alone.
// Who may run it: the import queue (a cron job sends one area at a time with the token kept in the Vault: x-import-token), or an
// admin (his own session token). Body: { area: "FR", dry?: true } — dry: nothing written, the counts and a sample returned.
// Data © OpenStreetMap contributors (ODbL): the track pages say so.
// Deploy as `tracks-import` with "Verify JWT" OFF (checked here).
import { createClient } from "npm:@supabase/supabase-js@2";
import { venuesOf, distM, nameKey, type El, type Venue } from "./lib.ts";
import { QLEVER, qVenueTags, qVenueGeom, qRacewayGeom, qRacewayTags, qTowns, qFind, qIdTags, qIdGeom, sparql, venueEls, racewayEls, townEls } from "./qlever.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-import-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
let deadline = 0;   // when the run has to stop asking (set per request): the writes need the rest of the function's 150 s

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
  let body: { area?: string; dry?: boolean; find?: string; ids?: string[] } = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const area = String(body.area || "").toUpperCase(), dry = !!body.dry;
  // by hand: what the map has under a name in an area ({area:"BY", find:"Стайк|Staik"}), or the given elements ({ids:["way/1"]})
  if (body.find || body.ids) {
    const byEl = (rows: Record<string, { value: string } | undefined>[]) => { const o: Record<string, Record<string, string>> = {}; for (const r of rows) { if (!r.el || !r.key || !r.val) continue; const k = r.el.value.replace("https://www.openstreetmap.org/", ""); (o[k] = o[k] || {})[r.key.value.replace(/^.*\/Key:/, "")] = r.val.value; } return o; };
    try {
      if (body.ids) { const ids = body.ids.filter(i => /^(node|way|relation)\/\d+$/.test(i)).slice(0, 50); const tags = byEl(await sparql(qIdTags(ids), 60000)), geom = await sparql(qIdGeom(ids), 60000); return json({ tags, geom: geom.map(r => ({ el: r.el && r.el.value.replace("https://www.openstreetmap.org/", ""), wkt: r.wkt && r.wkt.value.slice(0, 20000) })) }); }
      const re = String(body.find).replace(/[^\p{L}\p{N} |\-.]/gu, "").slice(0, 120);
      if (!/^([A-Z]{2}|US-[A-Z]{2})$/.test(area) || !re) return json({ error: "find needs an area and a name" }, 400);
      return json({ area, find: re, els: byEl(await sparql(qFind(area, re), 110000)) });
    } catch (e) { return json({ error: String((e as Error).message || e).slice(0, 300) }, 502); }
  }
  if (area === "PING") {   // how fast the map database answers the import's five questions from here (Belgium; a queue run: "PING")
    const out: Record<string, unknown> = {};
    for (const [k, q] of [["venueTags", qVenueTags("BE")], ["venueGeom", qVenueGeom("BE")], ["racewayGeom", qRacewayGeom("BE")], ["racewayTags", qRacewayTags("BE")], ["towns", qTowns("BE")]] as [string, string][]) { const t1 = Date.now(); try { const rows = await sparql(q, 30000); out[k] = { ms: Date.now() - t1, rows: rows.length, kb: Math.round(JSON.stringify(rows).length / 1024) }; } catch (e) { out[k] = { error: String((e as Error).message || e).slice(0, 160), ms: Date.now() - t1 }; } }
    await db.from("import_queue").update({ status: "done", result: out, finished_at: new Date().toISOString() }).eq("area", area); return json(out);
  }
  if (!/^([A-Z]{2}|US-[A-Z]{2})$/.test(area)) return json({ error: "bad_area" }, 400);
  const t0 = Date.now(), cc = area.slice(0, 2); deadline = t0 + 125000;   // the writes need the rest of the function's 150 s
  const done = async (result: Record<string, unknown>, status = "done") => { await db.from("import_queue").update({ status, result, finished_at: new Date().toISOString() }).eq("area", area); return json(result, status === "done" ? 200 : 502); };
  await db.from("import_queue").update({ status: "running", started_at: new Date().toISOString() }).eq("area", area);
  let els: El[] = [], mirror = "qlever";
  try {
    const left = (cap: number) => Math.max(5000, Math.min(cap, deadline - Date.now()));
    const vEls = venueEls(await sparql(qVenueTags(area), left(50000)), await sparql(qVenueGeom(area), left(50000))); els = vEls;
    if (vEls.length) {
      els = els.concat(racewayEls(await sparql(qRacewayGeom(area), left(50000)), await sparql(qRacewayTags(area), left(40000))));
      const needTowns = vEls.some(e => e.tags && !(e.tags["addr:city"] || e.tags["addr:town"] || e.tags["addr:village"]));
      if (needTowns && deadline - Date.now() > 20000) { try { els = els.concat(townEls(await sparql(qTowns(area), left(40000)))); } catch { /* no towns: the venues keep the address they have */ } }
    }
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
  if (dry) { summary.ms = Date.now() - t0; return done(Object.assign(summary, { names: fresh.map(v => `${v.name} · ${v.city}${v.line ? " · " + v.line.lengthM + " m" : ""}`) })); }
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
