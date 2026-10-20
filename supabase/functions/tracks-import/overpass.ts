// Hutka — OpenStreetMap through Overpass, when QLever (qlever.ts) is down: one question an area — its karting venues (tags, centre,
// box), the outlines of the venues' tracks, the raceways within 600 m of them, the towns within 30 km — turned into the elements lib.ts
// reads. The public Overpass servers refuse the functions' network (406/403) except VK's (maps.mail.ru), which answers, slowly at times.
import { kartName, type El } from "./lib.ts";

export const OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const KN = "kart|картинг|картодром|motok[aá]r|mikroauto";
const areaSel = (area: string) => /^US-[A-Z]{2}$/.test(area) ? `area["ISO3166-2"="${area}"]` : `area["ISO3166-1"="${area}"]["admin_level"="2"]`;
// three light questions an area (VK's gateway gives up after about a minute): the venues with their outlines, the raceways, the towns
const head = (area: string, t: number) => `[out:json][timeout:${t}][maxsize:536870912];\n${areaSel(area)}->.a;\n`;
// the venues by their sport only (the tag index answers at once; the names-only branches of qlever.ts are left to QLever — on VK's busy
// server a scan of every named leisure place in a country does not finish in a minute)
export const qVenues = (area: string) => head(area, 50) + `nwr["sport"~"karting"](area.a)->.v;
.v out center bb;
way.v["leisure"="track"]; out ids geom;`;
export const qRaceways = (area: string) => head(area, 50) + `way["highway"="raceway"](area.a); out geom;`;
export const qTownsO = (area: string) => head(area, 40) + `node["place"~"^(city|town)$"]["name"](area.a); out;`;
// the old single question, kept for the tests
export const qArea = (area: string) => head(area, 110) + `( nwr["sport"~"karting",i](area.a);
  way["highway"="raceway"]["name"~"${KN}",i][!"sport"](area.a);
  nwr["leisure"~"^(track|sports_centre|sports_hall|amusement_arcade)$"]["name"~"${KN}",i][!"sport"](area.a);
  nwr["sport"~"^(motor|motorsport)$"]["name"~"${KN}",i](area.a); )->.v;
.v out center bb;
way.v["leisure"="track"]; out ids geom;
way(around.v:600)["highway"="raceway"]; out geom;
node(around.v:30000)["place"~"^(city|town)$"]["name"]; out;`;

type OEl = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number }; tags?: Record<string, string>; nodes?: number[]; geometry?: { lat: number; lon: number }[] };
export async function overpass(q: string, ms: number): Promise<OEl[]> {
  let last = "";
  const t0 = Date.now();
  for (const url of OVERPASS) for (let k = 0; k < 3; k++) {   // a gateway that refuses at once (504 in a second) is asked again; a slow one is not
    if (k && Date.now() - t0 > 12000) break;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), Math.max(3000, ms - (Date.now() - t0)));
    try {
      const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": "Hutka/1.0 (+https://hutka.ai; karting track catalogue)" }, signal: ctl.signal });
      if (r.ok) { const j = await r.json(); return (j && j.elements) || []; }
      last = `overpass ${r.status}: ${(await r.text()).slice(0, 120)}`;
    } catch (e) { last = String((e as Error).message || e); } finally { clearTimeout(timer); }
  }
  throw new Error(last || "overpass: no answer");
}
// the answer → venues, raceways, towns (the shapes qlever.ts makes): the venues are what has a centre or is a tagged node that is not a
// town; a way given with its points and no tags is a venue's outline; a way with its points and highway=raceway is a raceway
export function overpassEls(rows: OEl[]): El[] {
  const rings = new Map<number, { lat: number; lon: number }[]>();
  for (const r of rows) if (r.type === "way" && r.geometry && !r.tags) rings.set(r.id, r.geometry);
  const out: El[] = [], seen = new Set<string>();
  for (const r of rows) {
    const t = r.tags || {};
    if (r.type === "node" && /^(city|town)$/.test(t.place || "")) { out.push({ type: "node", id: r.id, lat: r.lat, lon: r.lon, tags: { place: t.place, name: t.name || "" } }); continue; }
    if (r.type === "way" && r.geometry && t.highway === "raceway") { if (r.nodes && r.nodes.length === r.geometry.length) out.push({ type: "way", id: r.id, tags: Object.assign({ highway: "raceway" }, t), geometry: r.geometry, nodes: r.nodes }); continue; }
    if (!r.tags || (!r.center && r.type !== "node")) continue;
    const key = r.type + r.id; if (seen.has(key)) continue; seen.add(key);
    const tags = t.sport ? Object.assign({}, t) : Object.assign({ sport: kartName(t.name || t["name:en"] || "") ? "karting" : "" }, t);
    if (r.type === "node") { out.push({ type: "node", id: r.id, lat: r.lat, lon: r.lon, tags }); continue; }
    const ring = rings.get(r.id), closed = !!ring && ring.length >= 10 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lon === ring[ring.length - 1].lon;
    out.push({ type: r.type, id: r.id, center: r.center, bounds: r.bounds, tags, ...(closed ? { ring } : {}) });
  }
  return out;
}
