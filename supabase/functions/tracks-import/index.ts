// Hutka — tracks from OpenStreetMap (read through QLever, qlever.ts): every named karting venue of an area (a country "FR", or a US state "US-CA") becomes a track
// page with a "Main" layout; where the map has the raceway drawn, the middle of the asphalt is the layout's line (kept in media:
// tracks/<id>/layouts/main/media/line, so the catalogue stays light), with its length. Idempotent: ids come from the OSM element
// (osm-w123); a venue Hutka has already (the same element, a track within 300 m, or within 1 km under the same name) is left alone; one
// Hutka knows by its town only (an SWS track the map did not have then: approx) under the same name within 30 km completes that track.
// Who may run it: the import queue (a cron job sends one area at a time with the token kept in the Vault: x-import-token), or an
// admin (his own session token). Body: { area: "FR", dry?: true } — dry: nothing written, the counts and a sample returned.
// Data © OpenStreetMap contributors (ODbL): the track pages say so.
// Deploy as `tracks-import` with "Verify JWT" OFF (checked here).
import { createClient } from "npm:@supabase/supabase-js@2";
import { venuesOf, placeVenues, type El, type Known } from "./lib.ts";
import { update, upgrade, putRows, namesOf, lineMeta, mediaRow } from "./update.ts";
import { QLEVER, qVenueTags, qVenueGeom, qRacewayGeom, qRacewayTags, qTowns, qFind, qIdTags, qIdGeom, sparql, venueEls, racewayEls, townEls } from "./qlever.ts";
import { overpass, overpassEls, qVenues, qRaceways, qTownsO } from "./overpass.ts";
import { geocodeAll, type Ask } from "./geocode.ts";

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
  let body: { area?: string; dry?: boolean; find?: string; ids?: string[]; mode?: string } = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const area = String(body.area || "").toUpperCase(), dry = !!body.dry;
  // by hand: which map databases answer from here ({probe:true}) — QLever's hosts and the Overpass servers, one tiny question each
  if ((body as { probe?: boolean }).probe) {
    const UA = { "User-Agent": "Hutka/1.0 (+https://hutka.ai; karting track catalogue)" }, out: Record<string, unknown> = {};
    const sq = "SELECT ?x WHERE { <https://www.openstreetmap.org/way/832870199> ?p ?x } LIMIT 1", oq = "[out:json][timeout:20];way(832870199);out tags;";
    const tries: [string, () => Promise<Response>][] = [
      ["qlever.cs.uni-freiburg.de", () => fetch("https://qlever.cs.uni-freiburg.de/api/osm-planet", { method: "POST", body: new URLSearchParams({ query: sq }), headers: { ...UA, Accept: "application/sparql-results+json" } })],
      ["qlever.dev", () => fetch("https://qlever.dev/api/osm-planet", { method: "POST", body: new URLSearchParams({ query: sq }), headers: { ...UA, Accept: "application/sparql-results+json" } })],
      ["overpass-api.de", () => fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["overpass.private.coffee", () => fetch("https://overpass.private.coffee/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["maps.mail.ru", () => fetch("https://maps.mail.ru/osm/tools/overpass/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["overpass.kumi.systems", () => fetch("https://overpass.kumi.systems/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["overpass.openstreetmap.fr", () => fetch("https://overpass.openstreetmap.fr/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["z.overpass-api.de", () => fetch("https://z.overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["lz4.overpass-api.de", () => fetch("https://lz4.overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["overpass.openstreetmap.ru", () => fetch("https://overpass.openstreetmap.ru/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["overpass.nchc.org.tw", () => fetch("https://overpass.nchc.org.tw/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["overpass.osm.jp", () => fetch("https://overpass.osm.jp/api/interpreter", { method: "POST", body: new URLSearchParams({ data: oq }), headers: UA })],
      ["api.openstreetmap.org", () => fetch("https://api.openstreetmap.org/api/0.6/way/832870199.json", { headers: UA })],
      ["photon.komoot.io", () => fetch("https://photon.komoot.io/api/?q=karting%20minsk&limit=2", { headers: UA })],
      ["download.geofabrik.de", () => fetch("https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf", { headers: { ...UA, Range: "bytes=0-99" } })],
      // the satellite imagery the app draws under the lines (Esri World Imagery): does a tile come, with the CORS header the app needs
      ["esri services", () => fetch("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/28451/42760", { headers: { ...UA, Origin: "https://hutka.ai", Referer: "https://hutka.ai/" } })],
      ["esri server", () => fetch("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/28451/42760", { headers: { ...UA, Origin: "https://hutka.ai", Referer: "https://hutka.ai/" } })],
    ];
    await Promise.all(tries.map(async ([k, f]) => { const t1 = Date.now(); try { const r = await Promise.race([f(), new Promise<Response>((_, rej) => setTimeout(() => rej(new Error("no answer in 25 s")), 25000))]); out[k] = { status: r.status, ms: Date.now() - t1, type: r.headers.get("content-type"), cors: r.headers.get("access-control-allow-origin"), body: /image|octet|pbf/.test(r.headers.get("content-type") || "") ? `(${(await r.arrayBuffer()).byteLength} bytes)` : (await r.text()).slice(0, 160) }; } catch (e) { out[k] = { error: String((e as Error).message || e).slice(0, 160), ms: Date.now() - t1 }; } }));
    return json(out);
  }
  // by hand: where named places are (Photon; geocode.ts) — nothing written, the answers returned
  if (Array.isArray((body as { geocode?: Ask[] }).geocode)) {
    const asks = ((body as { geocode: Ask[] }).geocode).filter(a => a && typeof a.k === "string" && typeof a.q === "string" && a.q.trim());
    return json(await geocodeAll(asks, Date.now() + 110000));
  }
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
  const left = (cap: number) => Math.max(5000, Math.min(cap, deadline - Date.now()));
  // the map through Overpass (VK's server): when QLever is down, or asked for ({src:"overpass"})
  const viaOverpass = async () => {
    const v = await overpass(qVenues(area), left(58000)); let rows = v;
    if (v.length) { rows = rows.concat(await overpass(qRaceways(area), left(58000))); if (deadline - Date.now() > 15000) { try { rows = rows.concat(await overpass(qTownsO(area), left(45000))); } catch { /* the venues keep the address they have */ } } }
    els = overpassEls(rows); mirror = "overpass";
  };
  if ((body as { src?: string }).src === "overpass") {
    try { await viaOverpass(); } catch (e) { const msg = String((e as Error).message || e); return done({ area, error: msg.slice(0, 300), ms: Date.now() - t0, down: true }, "pending"); }
  } else try {
    const vEls = venueEls(await sparql(qVenueTags(area), left(50000)), await sparql(qVenueGeom(area), left(50000))); els = vEls;
    if (vEls.length) {
      els = els.concat(racewayEls(await sparql(qRacewayGeom(area), left(50000)), await sparql(qRacewayTags(area), left(40000))));
      // the towns: for a venue with no town in its address, or one written in another script (the English name is looked up)
      const needTowns = vEls.some(e => e.tags && !/[A-Za-z]/.test(e.tags["addr:city"] || e.tags["addr:town"] || e.tags["addr:village"] || ""));
      if (needTowns && deadline - Date.now() > 20000) { try { els = els.concat(townEls(await sparql(qTowns(area), left(40000)))); } catch { /* no towns: the venues keep the address they have */ } }
    }
  } catch (e) {   // QLever down (5xx, no connection): Overpass instead; both down — the area waits in the queue (pending, "down")
    const msg = String((e as Error).message || e), down = /^qlever 5\d\d|error sending request|connection (refused|reset|closed)|dns error/i.test(msg);
    if (!down) return done({ area, error: msg.slice(0, 300), ms: Date.now() - t0 }, "error");
    try { await viaOverpass(); } catch (e2) { return done({ area, error: (msg.slice(0, 120) + " | " + String((e2 as Error).message || e2)).slice(0, 300), ms: Date.now() - t0, down: true }, "pending"); }
  }
  const venues = venuesOf(els);
  // what Hutka has: the same element, a track within 300 m, or within 1 km under the same name
  // (in pages: the API answers 1000 rows at most)
  const known: Known[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await db.from("tracks").select("id, name:data->>name, osm:data->>osm, lat:data->lat, lon:data->lon, len:data->lengthM, approx:data->approx").order("id").range(from, from + 999);
    if (error) return done({ area, error: "tracks: " + error.message, ms: Date.now() - t0 }, "error");
    for (const r of (data || []) as Record<string, unknown>[]) known.push({ id: String(r.id), osm: String(r.osm || ""), name: String(r.name || ""), lat: Number(r.lat), lon: Number(r.lon), len: Number(r.len) || 0, approx: r.approx === true });
    if (!data || data.length < 1000) break;
  }
  // which venues are new, which Hutka has, which complete a track it knows by its town only (lib.ts placeVenues)
  const { fresh, skipped, upgrades, maybe } = placeVenues(venues, known);
  const withLine = fresh.filter(v => v.line).length;
  const summary = { area, mirror, elements: els.length, venues: venues.length, fresh: fresh.length, withLine, indoor: fresh.filter(v => v.indoor).length, skipped: skipped.length, sample: fresh.slice(0, 12).map(v => ({ name: v.name, city: v.city, line: v.line ? v.line.lengthM : 0, indoor: v.indoor })), skippedSample: skipped.slice(0, 8), toUpgrade: upgrades.length, maybe: maybe.slice(0, 12), dry, ms: 0 };
  if (dry) {
    try { Object.assign(summary, await upgrade(db, upgrades, true)); } catch (e) { Object.assign(summary, { error: "upgrade: " + String((e as Error).message || e).slice(0, 280) }); }
    if (body.mode === "update") { try { Object.assign(summary, await update(db, venues, known, cc, true)); } catch (e) { Object.assign(summary, { error: "update: " + String((e as Error).message || e).slice(0, 280) }); } }
    summary.ms = Date.now() - t0; return done(Object.assign(summary, { names: fresh.map(v => `${v.name} · ${v.city}${v.line ? " · " + v.line.lengthM + " m" : ""}`) }));
  }
  // the pages: the track (light: the catalogue loads them all), its "Main" layout, the line in media
  const now = new Date().toISOString(), ts = Date.now();
  const tracks = fresh.map(v => ({ id: v.id, data: Object.assign({ name: v.name, city: v.city, country: cc, lat: v.lat, lon: v.lon, address: v.address, website: v.website, phone: v.phone, indoor: v.indoor, osm: v.osm, source: "osm", createdAt: ts, updatedAt: ts }, v.line ? { lengthM: v.line.lengthM } : {}, namesOf(v)), updated_at: now }));
  const layouts = fresh.map(v => ({ track_id: v.id, id: "main", data: Object.assign({ name: "Main", order: 0, cornerR: 110, widthM: v.line ? v.line.widthM : 8, createdAt: ts, updatedAt: ts }, v.line ? lineMeta(v) : {}), updated_at: now }));
  const media = fresh.filter(v => v.line).map(v => mediaRow(v, now));
  try { await putRows(db, "tracks", tracks); await putRows(db, "layouts", layouts); await putRows(db, "media", media); Object.assign(summary, await upgrade(db, upgrades, false)); }
  catch (e) { summary.ms = Date.now() - t0; return done(Object.assign(summary, { error: String((e as Error).message || e).slice(0, 300) }), "error"); }
  // "update": the tracks this import made before get what the rules give now — a line where they had none (the venue's track drawn
  // as a closed shape, raceways joined at their loose ends), the corners of the line they have, their other names (for the search).
  // Only the import's own pages (osm-…), only the "Main" layout, never one with a line, a drawing or sessions' geometry of its own.
  if (body.mode === "update") {
    try { Object.assign(summary, await update(db, venues, known, cc, dry)); }
    catch (e) { summary.ms = Date.now() - t0; return done(Object.assign(summary, { added: tracks.length, error: "update: " + String((e as Error).message || e).slice(0, 280) }), "error"); }
  }
  summary.ms = Date.now() - t0;
  return done(Object.assign(summary, { added: tracks.length }));
});

