// Hutka — OpenStreetMap through QLever (a SPARQL database of the whole planet, University of Freiburg): the public Overpass servers
// refuse or never answer requests from the functions' network. Five light questions an area — its karting venues' tags and
// outlines, its raceways' lines and tags, its towns — turned into the elements lib.ts reads.
import type { El } from "./lib.ts";

export const QLEVER = "https://qlever.cs.uni-freiburg.de/api/osm-planet";
const PRE = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:> PREFIX ogc: <http://www.opengis.net/rdf#> PREFIX geo: <http://www.opengis.net/ont/geosparql#> `;
// the area: the relation tagged with its ISO code (a country's or a US state's; the label node carrying the same code left out)
const areaOf = (area: string) => `?area osmkey:${/^US-[A-Z]{2}$/.test(area) ? "ISO3166-2" : "ISO3166-1"} "${area}" . FILTER(STRSTARTS(STR(?area), "https://www.openstreetmap.org/relation/")) ?area ogc:sfContains ?el . `;
const KEY = "https://www.openstreetmap.org/wiki/Key:";
// the tags a venue is read by (lib.ts): its name, contacts, address, what kind of place it is, whether it is closed — all its tags,
// one row a tag (a row per venue with thirty optional columns is what makes the database slow)
export const qVenueTags = (area: string) => PRE + `SELECT ?el ?key ?val WHERE { ${areaOf(area)}?el osmkey:sport "karting" . ?el ?key ?val . FILTER(STRSTARTS(STR(?key), "${KEY}")) }`;
export const qVenueGeom = (area: string) => PRE + `SELECT ?el ?wkt WHERE { ${areaOf(area)}?el osmkey:sport "karting" . ?el geo:hasGeometry/geo:asWKT ?wkt . }`;
export const qRacewayGeom = (area: string) => PRE + `SELECT ?el ?wkt WHERE { ${areaOf(area)}?el osmkey:highway "raceway" . ?el geo:hasGeometry/geo:asWKT ?wkt . }`;
export const qRacewayTags = (area: string) => PRE + `SELECT ?el ?key ?val WHERE { ${areaOf(area)}?el osmkey:highway "raceway" . ?el ?key ?val . FILTER(?key IN (osmkey:sport, osmkey:oneway, osmkey:width, osmkey:name)) }`;
export const qTowns = (area: string) => PRE + `SELECT ?el ?wkt ?name ?place WHERE { ${areaOf(area)}?el osmkey:place ?place . FILTER(?place = "city" || ?place = "town") ?el osmkey:name ?name . ?el geo:hasGeometry/geo:asWKT ?wkt . }`;

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

const tagsOf = (rows: Row[]) => { const by = new Map<string, Record<string, string>>(); for (const r of rows) { if (!r.el || !r.key || !r.val) continue; const k = r.key.value.slice(KEY.length); let t = by.get(r.el.value); if (!t) { t = {}; by.set(r.el.value, t); } if (!t[k]) t[k] = r.val.value; } return by; };
// venues: tags from one question, the outline (a point for a pin) from the other; a centre and a box for an outline
export function venueEls(tagRows: Row[], geomRows: Row[]): El[] {
  const tags = tagsOf(tagRows), out: El[] = [], seen = new Set<string>();
  for (const r of geomRows) {
    const iri = r.el ? r.el.value : "", k = idOf(iri); if (!k || seen.has(iri) || !r.wkt) continue; seen.add(iri);
    const pts = coords(r.wkt.value); if (!pts.length) continue;
    const t = Object.assign({ sport: "karting" }, tags.get(iri) || {});
    if (k.type === "node" || pts.length === 1) { out.push({ type: k.type, id: k.id, lat: pts[0].lat, lon: pts[0].lon, tags: t }); continue; }
    const ring = coords(r.wkt.value, true), c = { lat: ring.reduce((a, p) => a + p.lat, 0) / ring.length, lon: ring.reduce((a, p) => a + p.lon, 0) / ring.length };
    out.push({ type: k.type, id: k.id, center: c, bounds: { minlat: Math.min(...pts.map(p => p.lat)), minlon: Math.min(...pts.map(p => p.lon)), maxlat: Math.max(...pts.map(p => p.lat)), maxlon: Math.max(...pts.map(p => p.lon)) }, tags: t });
  }
  return out;
}
// raceways: their points, and the nodes they share told by the points themselves (a shared node is the same point in both)
export function racewayEls(geomRows: Row[], tagRows: Row[]): El[] {
  const tags = tagsOf(tagRows), ids = new Map<string, number>(), out: El[] = [], seen = new Set<string>(); let next = 1;
  const nid = (p: { lat: number; lon: number }) => { const k = p.lat.toFixed(7) + "," + p.lon.toFixed(7); let i = ids.get(k); if (!i) { i = next++; ids.set(k, i); } return i; };
  for (const r of geomRows) {
    const iri = r.el ? r.el.value : "", k = idOf(iri); if (!k || k.type !== "way" || seen.has(iri) || !r.wkt) continue; seen.add(iri);
    const g = coords(r.wkt.value, true); if (g.length < 2) continue;
    if (/^\s*POLYGON/i.test(r.wkt.value) && (g[0].lat !== g[g.length - 1].lat || g[0].lon !== g[g.length - 1].lon)) g.push(g[0]);
    out.push({ type: "way", id: k.id, tags: Object.assign({ highway: "raceway" }, tags.get(iri) || {}), geometry: g, nodes: g.map(nid) });
  }
  return out;
}
export function townEls(rows: Row[]): El[] {
  const out: El[] = [];
  for (const r of rows) { const k = r.el && idOf(r.el.value), c = coords(r.wkt ? r.wkt.value : "")[0]; if (!k || !c || !r.name) continue; out.push({ type: "node", id: k.id, lat: c.lat, lon: c.lon, tags: { place: (r.place && r.place.value) || "town", name: r.name.value } }); }
  return out;
}
