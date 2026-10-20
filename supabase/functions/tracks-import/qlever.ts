// Hutka — OpenStreetMap through QLever (a SPARQL database of the whole planet, University of Freiburg): the public Overpass servers
// refuse or never answer requests from the functions' network. Five light questions an area — its karting venues' tags and
// outlines, its raceways' lines and tags, its towns — turned into the elements lib.ts reads.
import { kartName, type El } from "./lib.ts";

export const QLEVER = "https://qlever.cs.uni-freiburg.de/api/osm-planet";
const PRE = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:> PREFIX ogc: <http://www.opengis.net/rdf#> PREFIX geo: <http://www.opengis.net/ont/geosparql#> `;
// the area: the relation tagged with its ISO code (a country's or a US state's; the label node carrying the same code left out)
const areaOf = (area: string) => `?area osmkey:${/^US-[A-Z]{2}$/.test(area) ? "ISO3166-2" : "ISO3166-1"} "${area}" . FILTER(STRSTARTS(STR(?area), "https://www.openstreetmap.org/relation/")) ?area ogc:sfContains ?el . `;
const KEY = "https://www.openstreetmap.org/wiki/Key:";
// the tags a venue is read by (lib.ts): its name, contacts, address, what kind of place it is, whether it is closed — all its tags,
// one row a tag (a row per venue with thirty optional columns is what makes the database slow)
// the venues: sport=karting, karting among other sports ("karting;paintball"), and — named for karts (lib.ts kartName decides; here
// the rough cut) — a raceway or a track, sports centre, sports hall or amusement hall with no sport given, a motor-sport venue
const KN = (v: string) => `(CONTAINS(LCASE(${v}), "kart") || CONTAINS(LCASE(${v}), "картинг") || CONTAINS(LCASE(${v}), "картодром") || CONTAINS(LCASE(${v}), "motokár") || CONTAINS(LCASE(${v}), "mikroauto"))`;
const VENUE = `{ ?el osmkey:sport "karting" } UNION { ?el osmkey:sport ?sp . FILTER(?sp != "karting" && CONTAINS(LCASE(?sp), "karting")) } UNION { ?el osmkey:highway "raceway" . ?el osmkey:name ?nm . FILTER(${KN("?nm")}) MINUS { ?el osmkey:sport ?sp2 } } UNION { VALUES ?lv { "track" "sports_centre" "sports_hall" "amusement_arcade" } ?el osmkey:leisure ?lv . ?el osmkey:name ?nl . FILTER(${KN("?nl")}) MINUS { ?el osmkey:sport ?sp3 } } UNION { VALUES ?sm { "motor" "motorsport" } ?el osmkey:sport ?sm . ?el osmkey:name ?nn . FILTER(${KN("?nn")}) } `;
export const qVenueTags = (area: string) => PRE + `SELECT ?el ?key ?val WHERE { ${areaOf(area)}${VENUE}?el ?key ?val . FILTER(STRSTARTS(STR(?key), "${KEY}")) }`;
export const qVenueGeom = (area: string) => PRE + `SELECT ?el ?wkt WHERE { ${areaOf(area)}${VENUE}?el geo:hasGeometry/geo:asWKT ?wkt . }`;
export const qRacewayGeom = (area: string) => PRE + `SELECT ?el ?wkt WHERE { ${areaOf(area)}?el osmkey:highway "raceway" . ?el geo:hasGeometry/geo:asWKT ?wkt . }`;
export const qRacewayTags = (area: string) => PRE + `SELECT ?el ?key ?val WHERE { ${areaOf(area)}?el osmkey:highway "raceway" . ?el ?key ?val . FILTER(?key IN (osmkey:sport, osmkey:oneway, osmkey:width, osmkey:name)) }`;
export const qTowns = (area: string) => PRE + `SELECT ?el ?wkt ?name ?place WHERE { ${areaOf(area)}?el osmkey:place ?place . FILTER(?place = "city" || ?place = "town") ?el osmkey:name ?name . ?el geo:hasGeometry/geo:asWKT ?wkt . }`;

// looking things up by hand (index.ts "find"): every tag of the elements of an area whose name (any of its names) matches, or of the
// elements given by id ("way/832870199") with their geometry
const NAMEKEYS = ["name", "alt_name", "loc_name", "old_name", "short_name", "official_name", "name:ru", "name:be", "name:uk", "name:en", "name:ar", "brand"].map(k => `<${KEY}${k}>`).join(" ");
export const qFind = (area: string, re: string) => PRE + `SELECT ?el ?key ?val WHERE { ${areaOf(area)}VALUES ?nk { ${NAMEKEYS} } ?el ?nk ?nm . FILTER(REGEX(?nm, "${re}", "i")) ?el ?key ?val . FILTER(STRSTARTS(STR(?key), "${KEY}")) } LIMIT 3000`;
export const qIdTags = (ids: string[]) => PRE + `SELECT ?el ?key ?val WHERE { VALUES ?el { ${ids.map(i => `<https://www.openstreetmap.org/${i}>`).join(" ")} } ?el ?key ?val . FILTER(STRSTARTS(STR(?key), "${KEY}")) }`;
export const qIdGeom = (ids: string[]) => PRE + `SELECT ?el ?wkt WHERE { VALUES ?el { ${ids.map(i => `<https://www.openstreetmap.org/${i}>`).join(" ")} } ?el geo:hasGeometry/geo:asWKT ?wkt . }`;

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
    // no sport given: a karting venue when its name says so (the query's cut is rough: "Kartause" is not one)
    const own = tags.get(iri) || {}, t = own.sport ? Object.assign({}, own) : Object.assign({ sport: kartName(own.name || own["name:en"] || "") ? "karting" : "" }, own);
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
