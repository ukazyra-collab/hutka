// Hutka — tracks from OpenStreetMap, the pure part of tracks-import (no network, no database; tested on its own).
// Overpass elements of one area → karting venues: one per place (a venue's polygon, its track and its pin are one venue), with
// the details the map has (address, website, phone, indoor), the nearest town when the address has none, and — when the map has the
// raceway drawn — the middle of the asphalt as the layout's line: the venue's own loop (300 m – 3.5 km), never a motor circuit next door.

export type LL = { lat: number; lon: number };
export type El = {
  type: string; id: number; lat?: number; lon?: number; center?: LL;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>; nodes?: number[]; geometry?: LL[];
};
export type Line = { pts: [number, number][]; lengthM: number; ways: number[]; driven: boolean; dir: "cw" | "ccw"; widthM: number };
export type Venue = {
  id: string; osm: string; name: string; lat: number; lon: number; city: string; address: string; website: string; phone: string;
  indoor: boolean; line: Line | null; parts: number;
};

const RE = 6371008.8, rad = Math.PI / 180;
export function distM(a: LL, b: LL): number {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RE * Math.asin(Math.min(1, Math.sqrt(x)));
}
const tag = (t: Record<string, string> | undefined, ...ks: string[]) => { for (const k of ks) if (t && t[k]) return String(t[k]).trim(); return ""; };
const posOf = (e: El): LL | null => e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : (e.center ? e.center : null);

// a name in the words that tell venues apart: accents, case, "karting", "circuit", articles gone
const GENERIC = /\b(karting|kartbahn|kartcenter|kartcentre|kart|karts|go[- ]?karts?|gokart|circuit|circuito|track|raceway|speedway|piste|pista|indoor|outdoor|center|centre|centrum|club|racing|race|arena|park|the|de|du|des|la|le|les|el|del|di|il|and|und|et|y)\b/g;
export function nameKey(s: string): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " ").replace(GENERIC, " ").replace(/[^a-z0-9а-яё]+/gi, " ").trim();
}
const similar = (a: string, b: string) => { const x = nameKey(a), y = nameKey(b); if (!x || !y) return false; return x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y)); };

// a name that says karting in the map's languages: "kart"/"karts" as a word (Go Karts, E-Kart), karting, kartbahn, kartbaan, kart
// center, kartódromo, kartodrom, gokart, картинг, картодром, motokáry, mikroautorata — not Kartause, Kartoffel, kartano, Kartverket
export const KART_NAME = /(^|[^\p{L}])(go[- ]?)?karts?(?![\p{L}])|karting|kartbahn|kartbaan|kartsport|kart[- ]?(center|centre|centrum|club|klub|arena|hall|halle|park|ring|land|world|zone|racing|track|circuit|bane|bana)|kart[oó]drom|kartdrom|gokart|go-kart|картинг|картодром|motok[aá]r|mikroauto/iu;
export const kartName = (s: string) => KART_NAME.test(String(s || "")) && !/orient|kompass/i.test(String(s || ""));
// children's karts, pedal cars and traffic parks (Mini-Karts, Kinderkartbahn, Kids Karts, Kart pour enfants, Pédale-Kart, verkeerspark)
export const KIDS = /mini[- ]?auto|mini[- ]?kart|verkeerspark|kinder[- ]?(kart|auto|verkehr|bahn)|(^|[^\p{L}])kids?(?![\p{L}])|pour enfants|per bambini|para niños|p[ée]dal|trapauto|tretauto/iu;
// a name saying the place is gone: "Ex Kartdromo", "Kartodromo (Abbandonato)", "ehemalige Kartbahn", "former karting"
export const CLOSED = /(^|[^\p{L}])(ex|former|ehemalige?[rns]?|stillgelegte?[rns]?|abbandonat[oaie]|abandonn?ed|abandonn[ée]e?s?|disused|closed|chiuso|ferm[ée]e?|cerrad[oa]|desaparecid[oa]|zamknięty)(?![\p{L}])/iu;
// which elements are venues: something with karting among its sports, or named for karts (a raceway, a track or a hall with no sport
// given, a motor-sport venue), not a shop, an office or a closed place
function isVenue(e: El): boolean {
  const t = e.tags || {}, nm = tag(t, "name", "name:en");
  if (!/karting/i.test(t.sport || "") && !(t.highway === "raceway" && !t.sport && kartName(nm)) && !(/^(motor|motorsport)$/i.test(t.sport || "") && kartName(nm))) return false;
  if (t.shop || t.office || t.craft) return false;
  if (Object.keys(t).some(k => /^(disused|abandoned|demolished|razed|was|removed):/.test(k))) return false;
  if (/^(no|closed)$/i.test(t.opening_hours || "") || t["end_date"]) return false;
  if (KIDS.test(tag(t, "name")) || CLOSED.test(tag(t, "name"))) return false;
  return true;
}
// a venue's pieces ranked: the venue itself (sports centre), its track, a raceway drawn with a name, a pin
const rank = (e: El) => { const t = e.tags || {}; return t.leisure === "sports_centre" ? 4 : t.leisure === "track" ? 3 : t.highway === "raceway" ? 2 : t.building ? 2 : 1; };
const inBounds = (p: LL, b: El["bounds"], padM: number) => {
  if (!b) return false; const dLat = padM / 111320, dLon = padM / (111320 * Math.cos(p.lat * rad));
  return p.lat >= b.minlat - dLat && p.lat <= b.maxlat + dLat && p.lon >= b.minlon - dLon && p.lon <= b.maxlon + dLon;
};

type Cluster = { main: El; pos: LL; bounds: El["bounds"] | undefined; els: El[]; name: string };

// ---- raceways → loops (the app's own joining, app_trackfind.js loopsOf): closed ways as they are; open ways cut where they share a
// node and searched for cycles (14 pieces at most, each once); every loop with the ways it runs on and which way round each is used
type Loop = { pts: LL[]; lengthM: number; ways: El[]; fwd: boolean[] };
function lenOf(g: LL[]): number { let s = 0; for (let i = 1; i < g.length; i++) s += distM(g[i - 1], g[i]); return s; }
export function loopsOf(ways0: El[]): Loop[] {
  const ways = ways0.filter(w => w.type === "way" && Array.isArray(w.nodes) && Array.isArray(w.geometry) && w.nodes.length === w.geometry.length && w.nodes.length >= 2);
  const loops: Loop[] = [], seen = new Set<string>();
  const push = (g: LL[], ws: El[], fwd: boolean[], key: string) => { const L = lenOf(g); if (L < 300 || L > 3500 || seen.has(key)) return; seen.add(key); loops.push({ pts: g.map(p => ({ lat: p.lat, lon: p.lon })), lengthM: L, ways: ws, fwd }); };
  const use = new Map<number, number>(); for (const w of ways) w.nodes!.forEach(id => use.set(id, (use.get(id) || 0) + 1));
  type Piece = { id: number; a: number; b: number; g: LL[]; way: El };
  const pieces: Piece[] = [];
  for (const w of ways) {
    const n = w.nodes!, closed = n[0] === n[n.length - 1] && n.length >= 4;
    const cuts = [0]; for (let i = 1; i < n.length - 1; i++) if ((use.get(n[i]) || 0) > 1) cuts.push(i); cuts.push(n.length - 1);
    if (closed && cuts.length === 2) { push(w.geometry!, [w], [true], "w" + w.id); continue; }
    for (let k = 1; k < cuts.length; k++) { const a = cuts[k - 1], b = cuts[k]; if (b <= a) continue; pieces.push({ id: pieces.length, a: n[a], b: n[b], g: w.geometry!.slice(a, b + 1), way: w }); }
  }
  const at = new Map<number, Piece[]>(); for (const p of pieces) for (const v of [p.a, p.b]) { if (!at.has(v)) at.set(v, []); at.get(v)!.push(p); }
  let budget = 20000;
  for (const p0 of pieces) {
    const stack: { v: number; path: { p: Piece; fwd: boolean }[]; used: Set<number> }[] = [{ v: p0.b, path: [{ p: p0, fwd: true }], used: new Set([p0.id]) }];
    while (stack.length && budget-- > 0) {
      const s = stack.pop()!;
      if (s.v === p0.a && s.path.length > 1) {
        const ids = s.path.map(x => x.p.id); if (Math.min(...ids) !== p0.id) continue;
        const key = ids.slice().sort((x, y) => x - y).join(","), g: LL[] = [];
        for (const x of s.path) { const seg = x.fwd ? x.p.g : x.p.g.slice().reverse(); g.push(...(g.length ? seg.slice(1) : seg)); }
        push(g, s.path.map(x => x.p.way), s.path.map(x => x.fwd), "c" + key); continue;
      }
      if (s.path.length >= 14) continue;
      for (const q of at.get(s.v) || []) { if (s.used.has(q.id)) continue; const fwd = q.a === s.v; const u = new Set(s.used); u.add(q.id); stack.push({ v: fwd ? q.b : q.a, path: s.path.concat([{ p: q, fwd }]), used: u }); }
    }
  }
  return loops;
}
// which way round on the map (true: clockwise)
export function clockwise(pts: LL[]): boolean { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += (b.lon - a.lon) * (b.lat + a.lat); } return s > 0; }

// the venue's line among the loops near it: the loops of karting ways and the loops inside the venue first; a motor circuit's piece
// never (a way of another sport); then the longest. Driven direction from one-way tags when every one-way piece agrees, else clockwise
export function lineFor(c: { pos: LL; bounds?: El["bounds"] }, loops: Loop[]): Line | null {
  let best: { lp: Loop; score: number } | null = null;
  for (const lp of loops) {
    const sports = lp.ways.map(w => (w.tags && w.tags.sport) || "");
    if (sports.some(s => s && !/karting/i.test(s))) continue;   // a motor circuit, a cycling track, a dog track
    const kart = sports.filter(s => /karting/i.test(s)).length / sports.length;
    const inside = c.bounds ? lp.pts.filter(p => inBounds(p, c.bounds, 40)).length / lp.pts.length : 0;
    const mid = { lat: lp.pts.reduce((a, p) => a + p.lat, 0) / lp.pts.length, lon: lp.pts.reduce((a, p) => a + p.lon, 0) / lp.pts.length };
    const dMid = distM(c.pos, mid);
    if (!(inside > 0.5) && dMid > 450) continue;   // somebody else's raceway
    const score = (kart > 0.5 ? 2 : 0) + (inside > 0.8 ? 2 : inside > 0.5 ? 1 : 0) + (dMid < 250 ? 1 : 0) + lp.lengthM / 10000;
    if (!best || score > best.score) best = { lp, score };
  }
  if (!best) return null;
  const lp = best.lp;
  // the way round: one-way pieces used forwards (or "-1" backwards) say it is driven this way; all against: the other way
  let along = 0, against = 0;
  lp.ways.forEach((w, i) => { const o = (w.tags && w.tags.oneway) || ""; if (o === "yes" || o === "1") (lp.fwd[i] ? along++ : against++); else if (o === "-1") (lp.fwd[i] ? against++ : along++); });
  let pts = lp.pts.slice(); if (pts.length > 2 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lon === pts[pts.length - 1].lon) pts.pop();
  const driven = (along > 0) !== (against > 0);
  if (driven ? against > 0 : !clockwise(pts)) pts.reverse();   // driven: as the one-way pieces say; else clockwise
  const out: LL[] = []; for (const p of pts) { const q = out[out.length - 1]; if (!q || distM(q, p) > 0.3) out.push(p); }
  let thin = out; if (out.length > 600) { const k = Math.ceil(out.length / 600); thin = out.filter((_, i) => i % k === 0); }
  const widths = lp.ways.map(w => parseFloat((w.tags && w.tags.width) || "")).filter(x => isFinite(x) && x >= 4 && x <= 20).sort((a, b) => a - b);
  return { pts: thin.map(p => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]), lengthM: Math.round(lp.lengthM), ways: lp.ways.map(w => w.id), driven, dir: clockwise(thin) ? "cw" : "ccw", widthM: widths.length ? widths[Math.floor(widths.length / 2)] : 8 };
}

// ---- the area's elements → venues
export function venuesOf(elements: El[]): Venue[] {
  const venues = elements.filter(e => e.type !== "way" || !(e.tags && e.tags.highway === "raceway" && !e.tags.sport) ).filter(isVenue);
  const raceways = elements.filter(e => e.type === "way" && e.tags && e.tags.highway === "raceway" && Array.isArray(e.geometry));
  const places = elements.filter(e => e.type === "node" && e.tags && /^(city|town)$/.test(e.tags.place || "") && (e.tags.name || e.tags["name:en"]));
  // one venue per place: its pieces gathered (inside each other's outline, within 150 m, or within 600 m under the same name)
  const clusters: Cluster[] = [];
  for (const e of venues.slice().sort((a, b) => rank(b) - rank(a) || Object.keys(b.tags || {}).length - Object.keys(a.tags || {}).length)) {
    const p = posOf(e); if (!p) continue; const nm = tag(e.tags, "name:en", "name", "official_name");
    let home: Cluster | null = null;
    for (const c of clusters) { const d = distM(c.pos, p); if (d < 150 || inBounds(p, c.bounds, 30) || (e.bounds && inBounds(c.pos, e.bounds, 30)) || (nm && c.name && d < 600 && similar(nm, c.name))) { home = c; break; } }
    if (home) { home.els.push(e); if (!home.name && nm) home.name = nm; if (!home.bounds && e.bounds) home.bounds = e.bounds; continue; }
    clusters.push({ main: e, pos: p, bounds: e.bounds, els: [e], name: nm });
  }
  // raceways to the venue they belong to (a node inside its outline, or within 500 m of it)
  const near = new Map<Cluster, El[]>();
  for (const w of raceways) {
    let best: Cluster | null = null, bd = Infinity;
    for (const c of clusters) {
      let d = Infinity;
      for (let i = 0; i < w.geometry!.length; i += Math.max(1, Math.floor(w.geometry!.length / 12))) { const q = w.geometry![i]; if (inBounds(q, c.bounds, 20)) { d = 0; break; } d = Math.min(d, distM(c.pos, q)); }
      if (d < bd) { bd = d; best = c; }
    }
    if (best && bd <= 500) { if (!near.has(best)) near.set(best, []); near.get(best)!.push(w); }
  }
  const out: Venue[] = [];
  for (const c of clusters) {
    if (!c.name) continue;
    const all = c.els, t = (k: string[]) => { for (const e of all) { const v = tag(e.tags, ...k); if (v) return v; } return ""; };
    const site = t(["website", "contact:website", "url"]), web = site ? (/^https?:\/\//i.test(site) ? site : "https://" + site) : "";
    const street = [t(["addr:street"]), t(["addr:housenumber"])].filter(Boolean).join(" ");
    let city = t(["addr:city", "addr:town", "addr:village", "addr:municipality", "addr:suburb"]);
    if (!city && places.length) { let bp: El | null = null, bd = Infinity; for (const pl of places) { const d = distM(c.pos, { lat: pl.lat!, lon: pl.lon! }); if (d < bd) { bd = d; bp = pl; } } if (bp && bd < 30000) city = tag(bp.tags, "name:en", "name"); }
    const indoor = all.some(e => { const g = e.tags || {}; return g.indoor === "yes" || g.covered === "yes" || (g.building && g.building !== "no") || g.location === "indoor"; }) || /\bindoor|\bhalle\b|kart ?hall/i.test(c.name);
    const loops = loopsOf(near.get(c) || []);
    const line = indoor && !loops.length ? null : lineFor(c, loops);
    const m = c.main, osm = (m.type === "node" ? "n" : m.type === "way" ? "w" : "r") + m.id;
    out.push({ id: "osm-" + osm, osm, name: c.name.slice(0, 80), lat: Math.round(c.pos.lat * 1e5) / 1e5, lon: Math.round(c.pos.lon * 1e5) / 1e5, city: city.slice(0, 60), address: street.slice(0, 120), website: web.slice(0, 200), phone: t(["phone", "contact:phone"]).slice(0, 40), indoor, line, parts: all.length });
  }
  return out;
}
