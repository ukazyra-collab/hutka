// Hutka — the track import's writes: a venue's page as rows (namesOf, lineMeta, mediaRow), "update" — the import's own tracks (and the
// SWS tracks made from the map) get what the rules give now: a line where they had none, the corners of the line they have, their other
// names, the town they lack (index.ts, mode "update") — and "upgrade": a town-only SWS track completed by its venue.
import { distM, nameKey, type Venue } from "./lib.ts";
import { cornerCount } from "./corners.ts";
// ---- what goes into the database
export const namesOf = (v: Venue) => Object.assign({}, v.aka.length ? { aka: v.aka.join(" · ").slice(0, 400) } : {}, v.nameRu && v.nameRu !== v.name ? { names: { ru: v.nameRu } } : {});
export const lineMeta = (v: Venue) => ({ lengthM: v.line!.lengthM, line: Object.assign({ src: "osm", n: v.line!.pts.length, lengthM: v.line!.lengthM, driven: v.line!.driven, corners: v.line!.corners, from: v.line!.from }, v.line!.loose ? { loose: true } : {}), ...(v.line!.driven ? { direction: v.line!.dir } : {}) });
export const mediaRow = (v: Venue, now: string) => ({ path: `tracks/${v.id}/layouts/main/media/line`, data: JSON.stringify(Object.assign({ v: 1, src: "osm", pts: v.line!.pts, ways: v.line!.ways, dir: v.line!.dir, driven: v.line!.driven, from: v.line!.from }, v.line!.loose ? { loose: true } : {})), updated_at: now });
// a line in a few numbers (a dry run's look at it): metres east and north of its first point, 48 points at most
const small = (pts: [number, number][]) => { const k = Math.max(1, Math.ceil(pts.length / 48)), a = pts[0], cx = 111320 * Math.cos(a[0] * Math.PI / 180), out: number[] = []; for (let i = 0; i < pts.length; i += k) out.push(Math.round((pts[i][1] - a[1]) * cx), Math.round((pts[i][0] - a[0]) * 110574)); return out; };
// deno-lint-ignore no-explicit-any
type Db = any;
export async function putRows(db: Db, table: string, rows: Record<string, unknown>[]) { for (let i = 0; i < rows.length; i += 200) { const { error } = await db.from(table).upsert(rows.slice(i, i + 200)); if (error) throw new Error(`${table}: ${error.message}`); } }
async function rowsIn(db: Db, table: string, cols: string, key: string, vals: string[], extra?: (q: any) => any) {
  const out: Record<string, any>[] = [];
  for (let i = 0; i < vals.length; i += 100) { let q: any = db.from(table).select(cols).in(key, vals.slice(i, i + 100)); if (extra) q = extra(q); const { data, error } = await q; if (error) throw new Error(`${table}: ${error.message}`); out.push(...((data || []) as Record<string, any>[])); }
  return out;
}
// a track Hutka knew by its town only (an SWS track the map did not have then: approx, its pin on the town's centre), found on the map
// now under its name (lib.ts placeVenues): its pin goes onto the venue, it gets the venue's element (the page then credits the map) and
// the details it lacks (address, website, phone, indoor, town, other names); its "Main" layout the venue's line when it has no line,
// drawing or reference session of its own. Its id, name, SWS mark, sessions and anything a person wrote stay. A track placed by a person
// since (no longer approx) is left alone.
export async function upgrade(db: Db, ups: { v: Venue; k: { id: string } }[], dry: boolean) {
  if (!ups.length) return { upgraded: 0, upgradedLines: 0, upgradedSample: [] as string[] };
  const ids = ups.map(u => u.k.id);
  const trows = new Map((await rowsIn(db, "tracks", "id, data", "id", ids)).map(r => [r.id as string, r]));
  const lrows = new Map((await rowsIn(db, "layouts", "track_id, id, data", "track_id", ids, q => q.eq("id", "main"))).map(r => [r.track_id as string, r]));
  const now = new Date().toISOString(), ts = Date.now(), tOut: Record<string, any>[] = [], lOut: Record<string, any>[] = [], mOut: Record<string, any>[] = [], done: string[] = [];
  for (const { v, k } of ups) {
    const tr = trows.get(k.id); if (!tr || !tr.data || tr.data.approx !== true) continue;
    const td: Record<string, any> = Object.assign({}, tr.data); delete td.approx;
    Object.assign(td, { lat: v.lat, lon: v.lon, osm: v.osm });
    for (const f of ["address", "website", "phone"] as const) if (!td[f] && v[f]) td[f] = v[f];
    if (typeof td.indoor !== "boolean") td.indoor = v.indoor;
    if (!td.city && v.city) td.city = v.city;
    const nm = namesOf(v); if (nm.aka && !td.aka) td.aka = nm.aka; if (nm.names && !(td.names && td.names.ru)) td.names = Object.assign({}, td.names || {}, nm.names);
    const lo = lrows.get(k.id), ld: Record<string, any> = lo ? Object.assign({}, lo.data) : { name: "Main", order: 0, cornerR: 110, widthM: 8, createdAt: ts };
    let said = "";
    if (v.line && !ld.line && !ld.trace && !ld.refSession && !ld.refSess && !ld.photo && !ld.lengthM && !td.lengthM) {
      const vv = Object.assign({}, v, { id: k.id });
      Object.assign(ld, lineMeta(vv), { widthM: v.line.widthM, updatedAt: ts }); td.lengthM = v.line.lengthM;
      lOut.push({ track_id: k.id, id: "main", data: ld, updated_at: now }); mOut.push(mediaRow(vv, now)); said = ` · ${v.line.lengthM} m · ${v.line.corners} T`;
    }
    tOut.push({ id: k.id, data: Object.assign(td, { updatedAt: ts }), updated_at: now });
    done.push(`${td.name} → ${v.osm}${said}`);
  }
  if (!dry) { await putRows(db, "layouts", lOut); await putRows(db, "media", mOut); await putRows(db, "tracks", tOut); }
  return { upgraded: tOut.length, upgradedLines: lOut.length, upgradedSample: done.slice(0, 20) };
}
export async function update(db: Db, venues: Venue[], known: { id: string; osm: string; name: string; lat: number; lon: number; len: number }[], cc: string, dry: boolean) {
  // the import's own track for each venue: the same map element, or the same name within 1 km, or 150 m away; an SWS track made
  // from the map (sws-…: the SWS list's track found on it, or completed by the import) — by its element only
  const pairs: { v: Venue; k: typeof known[number] }[] = [];
  for (const v of venues) {
    const k = known.find(k => k.osm && k.osm === v.osm) || known.find(k => isFinite(k.lat) && isFinite(k.lon) && (distM(k, v) < 150 || (distM(k, v) < 1000 && nameKey(k.name) && nameKey(k.name) === nameKey(v.name))));
    if (k && (k.id.startsWith("osm-") || (k.id.startsWith("sws-") && k.osm === v.osm))) pairs.push({ v, k });
  }
  if (!pairs.length) return { matched: 0, linesAdded: 0, cornersAdded: 0, namesAdded: 0, citiesAdded: 0 };
  const ids = [...new Set(pairs.map(p => p.k.id))];
  const trows = new Map((await rowsIn(db, "tracks", "id, data", "id", ids)).map(r => [r.id as string, r]));
  const lrows = new Map((await rowsIn(db, "layouts", "track_id, id, data", "track_id", ids, q => q.eq("id", "main"))).map(r => [r.track_id as string, r]));
  const now = new Date().toISOString(), tOut: Record<string, any>[] = [], lOut: Record<string, any>[] = [], mOut: Record<string, any>[] = [], added: string[] = [], seen = new Set<string>();
  const shapes: { id: string; name: string; m: number[] }[] = [];   // a dry run: the looser look's lines, small (metres from the first point, 48 points at most)
  let namesAdded = 0, citiesAdded = 0;
  for (const { v, k } of pairs) {
    if (seen.has(k.id)) continue; seen.add(k.id);
    const tr = trows.get(k.id), lo = lrows.get(k.id); if (!tr || !lo || (tr.data && tr.data.source !== "osm" && !(tr.data.source === "sws" && tr.data.osm === v.osm))) continue;
    const td = Object.assign({}, tr.data), ld = Object.assign({}, lo.data); let tCh = false;
    const nm = namesOf(v); if (nm.aka && !td.aka) { td.aka = nm.aka; tCh = true; } if (nm.names && !(td.names && td.names.ru)) { td.names = Object.assign({}, td.names || {}, nm.names); tCh = true; } if (tCh) namesAdded++;
    if (!td.city && v.city) { td.city = v.city; tCh = true; citiesAdded++; }   // a town it was imported without (the towns' question went unanswered)
    if (v.line && !ld.line && !ld.trace && !ld.refSess && !ld.photo && !td.lengthM) {
      // the line it never had: the layout's line (clockwise unless one-way pieces say otherwise), its length on the track too
      const vv = Object.assign({}, v, { id: k.id });
      Object.assign(ld, lineMeta(vv), { widthM: v.line.widthM, updatedAt: Date.now() }); td.lengthM = v.line.lengthM; tCh = true;
      lOut.push({ track_id: k.id, id: "main", data: ld, updated_at: now }); mOut.push(mediaRow(vv, now)); added.push(`${td.name} · ${v.line.lengthM} m · ${v.line.corners} T · ${v.line.from}${v.line.loose ? " · loose" : ""}`);
      if (dry && v.line.loose && shapes.length < 60) shapes.push({ id: k.id, name: String(td.name || "").slice(0, 40), m: small(v.line.pts) });
    }
    if (tCh) tOut.push({ id: k.id, data: Object.assign(td, { updatedAt: Date.now() }), updated_at: now });
  }
  // the corners of the lines they have (made before corners were counted at import): from the line itself
  const need = [...lrows.values()].filter(r => r.data && r.data.line && r.data.line.src === "osm" && typeof r.data.line.corners !== "number" && !lOut.some(x => x.track_id === r.track_id));
  let cornersAdded = 0;
  if (need.length) {
    const med = new Map((await rowsIn(db, "media", "path, data", "path", need.map(r => `tracks/${r.track_id}/layouts/main/media/line`))).map(r => [r.path as string, r.data]));
    for (const r of need) {
      let j: any = null; try { const raw = med.get(`tracks/${r.track_id}/layouts/main/media/line`); j = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { j = null; }
      if (!j || !Array.isArray(j.pts)) continue;
      const n = cornerCount(j.pts, +r.data.cornerR || 110); if (!n) continue;
      lOut.push({ track_id: r.track_id, id: "main", data: Object.assign({}, r.data, { line: Object.assign({}, r.data.line, { corners: n }) }), updated_at: now }); cornersAdded++;
    }
  }
  if (!dry) { await putRows(db, "layouts", lOut); await putRows(db, "media", mOut); await putRows(db, "tracks", tOut); }
  return { matched: pairs.length, linesAdded: added.length, linesLoose: added.filter(x => x.endsWith(" · loose")).length, cornersAdded, namesAdded, citiesAdded, linesSample: added.slice(0, 40), cc, ...(dry ? { shapes } : {}) };
}
