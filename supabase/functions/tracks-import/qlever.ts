// Hutka — OpenStreetMap through QLever (a SPARQL database of the whole planet, University of Freiburg): the public Overpass servers
// refuse or never answer requests from the functions' network. Three questions an area — its karting venues (with the tags the
// import reads and their outline), the raceways in it (their line), its towns — turned into the elements lib.ts reads.
import type { El } from "./lib.ts";

export const QLEVER = "https://qlever.cs.uni-freiburg.de/api/osm-planet";
const PRE = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:> PREFIX ogc: <http://www.opengis.net/rdf#> PREFIX geo: <http://www.opengis.net/ont/geosparql#> `;
const areaOf = (area: string) => /^US-[A-Z]{2}$/.test(area) ? `?area osmkey:ISO3166-2 "${area}" ; osmkey:admin_level "4" .` : `?area osmkey:ISO3166-1 "${area}" ; osmkey:admin_level "2" .`;
// the tags a venue is read by (lib.ts): its name, contacts, address, what kind of place it is, whether it is closed
const VTAGS = ["name", "name:en", "official_name", "website", "contact:website", "url", "phone", "contact:phone", "addr:city", "addr:town", "addr:village", "addr:municipality", "addr:suburb", "addr:street", "addr:housenumber", "leisure", "building", "indoor", "covered", "location", "shop", "office", "craft", "opening_hours", "end_date", "highway", "disused:sport", "abandoned:leisure"];
const v = (k: string) => "?t_" + k.replace(/[^a-z0-9]/gi, "_");
export const qVenues = (area: string) => PRE + `SELECT ?el ?cent ?wkt ${VTAGS.map(v).join(" ")} WHERE { ${areaOf(area)} ?area ogc:sfContains ?el . ?el osmkey:sport "karting" . ?el geo:hasCentroid/geo:asWKT ?cent . OPTIONAL { ?el geo:hasGeometry/geo:asWKT ?wkt } ${VTAGS.map(k => `OPTIONAL { ?el osmkey:${k} ${v(k)} }`).join(" ")} }`;
export const qRaceways = (area: string) => PRE + `SELECT ?el ?wkt ?t_sport ?t_oneway ?t_width ?t_name WHERE { ${areaOf(area)} ?area ogc:sfContains ?el . ?el osmkey:highway "raceway" . ?el geo:hasGeometry/geo:asWKT ?wkt . OPTIONAL { ?el osmkey:sport ?t_sport } OPTIONAL { ?el osmkey:oneway ?t_oneway } OPTIONAL { ?el osmkey:width ?t_width } OPTIONAL { ?el osmkey:name ?t_name } }`;
export const qTowns = (area: string) => PRE + `SELECT ?el ?cent ?t_name ?t_name_en ?t_place WHERE { ${areaOf(area)} ?area ogc:sfContains ?el . ?el osmkey:place ?t_place . FILTER(?t_place = "city" || ?t_place = "town") ?el osmkey:name ?t_name . OPTIONAL { ?el osmkey:name:en ?t_name_en } ?el geo:hasCentroid/geo:asWKT ?cent . }`;

type Row = Record<string, { value: string } | undefined>;
export async function sparql(q: string, ms: number): Promise<Row[]> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(QLEVER, { method: "POST", body: new URLSearchParams({ query: q }), headers: { "Accept": "application/sparql-results+json", "User-Agent": "Hutka/1.0 (+https://hutka.ai; karting track catalogue)" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`qlever ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json(); return (j && j.results && j.results.bindings) || [];
  } finally { clearTimeout(timer); }
}

// WKT → coordinates: a POINT, a LINESTRING, a POLYGON's outer ring (a closed raceway can come as one), every point of the rest
const NUM = /(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)/g;
export function coords(wkt: string, ring = false): { lat: number; lon: number }[] {
  let s = String(wkt || ""); if (ring && /^\s*POLYGON/i.test(s)) { const a = s.indexOf("(("), b = s.indexOf(")", a + 2); if (a >= 0 && b > a) s = s.slice(a + 2, b); }
  const out: { lat: number; lon: number }[] = []; let m: RegExpExecArray | null; NUM.lastIndex = 0;
  while ((m = NUM.exec(s))) out.push({ lon: +m[1], lat: +m[2] });
  return out;
}
const idOf = (iri: string) => { const m = /\/(node|way|relation)\/(\d+)$/.exec(iri || ""); return m ? { type: m[1], id: +m[2] } : null; };

export function venueEls(rows: Row[]): El[] {
  const by = new Map<string, El>();
  for (const r of rows) {
    const k = r.el && idOf(r.el.value); if (!k) continue; const key = k.type + k.id;
    let e = by.get(key);
    if (!e) {
      const c = coords(r.cent ? r.cent.value : "")[0]; if (!c) continue;
      e = { type: k.type, id: k.id, center: c, tags: { sport: "karting" } };
      if (k.type === "node") { e.lat = c.lat; e.lon = c.lon; }
      if (k.type !== "node" && r.wkt) { const pts = coords(r.wkt.value); if (pts.length >= 3) e.bounds = { minlat: Math.min(...pts.map(p => p.lat)), minlon: Math.min(...pts.map(p => p.lon)), maxlat: Math.max(...pts.map(p => p.lat)), maxlon: Math.max(...pts.map(p => p.lon)) }; }
      by.set(key, e);
    }
    for (const t of VTAGS) { const b = r[v(t).slice(1)]; if (b && b.value && !e.tags![t]) e.tags![t] = b.value; }
    if (e.tags!["disused:sport"] || e.tags!["abandoned:leisure"]) e.tags!["disused:x"] = "yes";
  }
  return [...by.values()];
}
// raceways: their points, and the nodes they share told by the points themselves (a shared node is the same point in both)
export function racewayEls(rows: Row[]): El[] {
  const ids = new Map<string, number>(), out: El[] = []; let next = 1;
  const nid = (p: { lat: number; lon: number }) => { const k = p.lat.toFixed(7) + "," + p.lon.toFixed(7); let i = ids.get(k); if (!i) { i = next++; ids.set(k, i); } return i; };
  const seen = new Set<string>();
  for (const r of rows) {
    const k = r.el && idOf(r.el.value); if (!k || k.type !== "way" || seen.has(String(k.id)) || !r.wkt) continue; seen.add(String(k.id));
    const g = coords(r.wkt.value, true); if (g.length < 2) continue;
    if (/^\s*POLYGON/i.test(r.wkt.value) && (g[0].lat !== g[g.length - 1].lat || g[0].lon !== g[g.length - 1].lon)) g.push(g[0]);
    const tags: Record<string, string> = { highway: "raceway" };
    for (const [t, c] of [["sport", "t_sport"], ["oneway", "t_oneway"], ["width", "t_width"], ["name", "t_name"]]) { const b = r[c]; if (b && b.value) tags[t] = b.value; }
    out.push({ type: "way", id: k.id, tags, geometry: g, nodes: g.map(nid) });
  }
  return out;
}
export function townEls(rows: Row[]): El[] {
  const out: El[] = [];
  for (const r of rows) { const k = r.el && idOf(r.el.value), c = coords(r.cent ? r.cent.value : "")[0]; if (!k || !c || !r.t_name) continue; out.push({ type: "node", id: k.id, lat: c.lat, lon: c.lon, tags: { place: (r.t_place && r.t_place.value) || "town", name: r.t_name.value, ...(r.t_name_en ? { "name:en": r.t_name_en.value } : {}) } }); }
  return out;
}
