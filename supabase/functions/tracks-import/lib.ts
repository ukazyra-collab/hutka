// Hutka — tracks from OpenStreetMap, the pure part of tracks-import (no network, no database; tested on its own).
// Overpass elements of one area → karting venues: one per place (a venue's polygon, its track and its pin are one venue), with
// the details the map has (address, website, phone, indoor), the nearest town when the address has none, and — when the map has the
// raceway drawn — the middle of the asphalt as the layout's line: the venue's own loop (300 m – 3.5 km), never a motor circuit next door.

export type LL = { lat: number; lon: number };
export type El = {
  type: string; id: number; lat?: number; lon?: number; center?: LL;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>; nodes?: number[]; geometry?: LL[];
  ring?: LL[];   // a venue piece drawn as a closed shape (its outer ring): a track drawn as its middle or its asphalt, or a whole site
};
// from: "raceway" (the raceways drawn), "joined" (raceways whose loose ends were 25 m apart or less), "outline" (the venue's track
// drawn as a closed shape: its middle, or the edge of its asphalt — a few metres off the middle)
export type Line = { pts: [number, number][]; lengthM: number; ways: number[]; driven: boolean; dir: "cw" | "ccw"; widthM: number; corners: number; from: "raceway" | "joined" | "outline" };
export type Venue = {
  id: string; osm: string; name: string; lat: number; lon: number; city: string; address: string; website: string; phone: string;
  indoor: boolean; line: Line | null; parts: number;
  nameRu: string;   // the Russian name when the map has one (shown in the app's Russian)
  aka: string[];    // every other name the map knows it by (local, official, alternative, old, short, the brand) — for the search
};
const NAMEKEYS = ["name", "name:en", "name:ru", "name:be", "name:uk", "name:de", "name:fr", "name:es", "name:it", "name:ar", "name:tr", "official_name", "alt_name", "loc_name", "short_name", "old_name", "brand"];

import { cornerCount } from "./corners.ts";

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
// one name however it is spaced or run together: "Pit Stop Karting" = "Pitstop Karting", "Go-Kart Town" = "GoKart Town"
export const nameSquash = (s: string) => nameKey(s).replace(/\s+/g, "");
export const sameName = (a: string, b: string) => { const x = nameSquash(a); return !!x && x === nameSquash(b); };
// one name inside the other ("Racing Dakart" / "Karting Racing Dakart Valencia"): as often another venue of the same town ("Karting
// Sevilla" / "Karting Marineda Sevilla"), so only a hint for a person to look at
export const nameInside = (a: string, b: string) => { const x = nameSquash(a), y = nameSquash(b); return !!x && !!y && x !== y && ((x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y))); };

// what Hutka has (the import reads it before a run)
export type Known = { id: string; osm: string; name: string; lat: number; lon: number; len: number; approx?: boolean };
// where each venue of a run goes:
//  · skipped: Hutka has it — the same element; a track within 300 m (an imported one) or 1.5 km (one made by hand: its pin may sit at
//    the gate or the car park); one within 1 km under the same name
//  · upgrades: a track Hutka knows by its town only (an SWS track the map did not have then: approx, its pin on the town's centre)
//    under the same name within 30 km — the venue becomes that track (its spot, element, details and line: update.ts upgrade); two
//    venues for one such track: the one with a line, then the nearer; the other is a track of its own (or the same place)
//  · fresh: a new track; "maybe" notes one with a town-only track nearby whose name is inside its own (or the same, taken by the
//    nearer venue) — for a person to look at, nothing done
export function placeVenues(venues: Venue[], known: Known[]) {
  // cheap enough for France (400 venues against 2 600 tracks) inside the function's CPU time: each name squashed once, a distance only
  // for tracks within a third of a degree of latitude, a name only for tracks near enough
  const ok = (k: Known) => isFinite(k.lat) && isFinite(k.lon);
  const keys = new Map<string, string>(), sq = (s: string) => { let x = keys.get(s); if (x === undefined) { x = nameSquash(s); keys.set(s, x); } return x; };
  const same = (a: string, b: string) => { const x = sq(a); return !!x && x === sq(b); };
  const inside = (a: string, b: string) => { const x = sq(a), y = sq(b); return !!x && !!y && x !== y && ((x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y))); };
  const near = (k: Known, v: Venue, m: number) => Math.abs(k.lat - v.lat) * 111000 < m && distM(k, v) < m;
  const byId = new Map(known.map(k => [k.id, k])), byOsm = new Map(known.filter(k => k.osm).map(k => [k.osm, k]));
  const placed = known.filter(k => !k.approx && ok(k)), approx = known.filter(k => k.approx && ok(k));
  const skipped: string[] = [], maybe: string[] = [], rest = new Set<Venue>(), claim = new Map<string, { v: Venue; k: Known; d: number }>();
  for (const v of venues) {
    const dup = byId.get(v.id) || (v.osm ? byOsm.get(v.osm) : undefined) || placed.find(k => near(k, v, k.id.startsWith("osm-") ? 300 : 1500) || (near(k, v, 1000) && same(k.name, v.name)));
    if (dup) { skipped.push(`${v.name} → ${dup.id}`); continue; }
    let best: Known | null = null, bd = 30000;
    for (const k of approx) { if (Math.abs(k.lat - v.lat) * 111000 >= bd) continue; const d = distM(k, v); if (d < bd && same(k.name, v.name)) { best = k; bd = d; } }
    if (!best) { rest.add(v); continue; }
    const c = claim.get(best.id);   // two venues for it: the one with a line, then the nearer
    if (c && ((c.v.line && !v.line) || (!!c.v.line === !!v.line && c.d <= bd))) { rest.add(v); continue; }
    if (c) rest.add(c.v);
    claim.set(best.id, { v, k: best, d: bd });
  }
  const upgrades = [...claim.values()], fresh: Venue[] = [];
  for (const v of venues) {
    if (!rest.has(v)) continue;
    if (upgrades.some(u => distM(u.v, v) < 120) || fresh.some(f => distM(f, v) < 120)) { skipped.push(`${v.name} (same place)`); continue; }
    const hint = approx.find(k => near(k, v, 30000) && (same(k.name, v.name) || inside(k.name, v.name)));
    if (hint) maybe.push(`${v.name} ~ ${hint.id} (${Math.round(distM(hint, v) / 100) / 10} km)`);
    fresh.push(v);
  }
  return { fresh, skipped, upgrades, maybe };
}

// a name that says karting in the map's languages: "kart"/"karts" as a word (Go Karts, E-Kart), karting, kartbahn, kartbaan, kart
// center, kartódromo, kartodrom, gokart, картинг, картодром, motokáry, mikroautorata — not Kartause, Kartoffel, kartano, Kartverket
export const KART_NAME = /(^|[^\p{L}])(go[- ]?)?karts?(?![\p{L}])|karting|kartbahn|kartbaan|kartsport|kart[- ]?(center|centre|centrum|club|klub|arena|hall|halle|park|ring|land|world|zone|racing|track|circuit|bane|bana)|kart[oó]drom|kartdrom|gokart|go-kart|картинг|картодром|motok[aá]r|mikroauto|كارت/iu;
export const kartName = (s: string) => KART_NAME.test(String(s || "")) && !/orient|kompass/i.test(String(s || ""));
// children's karts, pedal cars and traffic parks (Mini-Karts, Minicars, Kinder-Elektrokartbahn, Kids Karts, Karting Enfants, Pédale-Kart,
// per bambini, verkeerspark, автогородок)
export const KIDS = /mini[- ]?auto|mini[- ]?kart|(^|[^\p{L}])mini[- ]?cars?(?![\p{L}])|verkeerspark|verkehrsgarten|kinder[- ]?\p{L}*(kart|quad|auto|verkehr|bahn)|(^|[^\p{L}])(kids?|enfants?)(?![\p{L}])|per bambini|para niños|p[ée]dal|trapauto|tretauto|автогородок|детск/iu;
// a name saying the place is gone: "Ex Kartdromo", "Kartodromo (Abbandonato)", "ehemalige Kartbahn", "former karting"
export const CLOSED = /(^|[^\p{L}])(ex|former|ehemalige?[rns]?|stillgelegte?[rns]?|abbandonat[oaie]|abandonn?ed|abandonn[ée]e?s?|disused|closed|chiuso|ferm[ée]e?|cerrad[oa]|desaparecid[oa]|zamknięty)(?![\p{L}])/iu;
// not karting at all, whatever the map's tag says: soap-box derby hills, driving schools' practice grounds ("Учебный автодром")
export const NOT_KARTING = /soap ?box|seifenkist|caisses? [àa] savon|учебн\p{L}*\s+(автодром|площадк)|автошкол|driving school|fahrschul/iu;
// which elements are venues: something with karting among its sports, or named for karts (a raceway, a track or a hall with no sport
// given, a motor-sport venue), not a shop, an office or a closed place
function isVenue(e: El): boolean {
  const t = e.tags || {}, kn = kartName(tag(t, "name")) || kartName(tag(t, "name:en"));   // the name or its English form (the Gulf's)
  if (!/karting/i.test(t.sport || "") && !(t.highway === "raceway" && !t.sport && kn) && !(/^(motor|motorsport)$/i.test(t.sport || "") && kn)) return false;
  if (t.shop || t.office || t.craft) return false;
  if (Object.keys(t).some(k => /^(disused|abandoned|demolished|razed|was|removed):/.test(k))) return false;
  if (/^(no|closed)$/i.test(t.opening_hours || "") || t["end_date"]) return false;
  if (KIDS.test(tag(t, "name")) || CLOSED.test(tag(t, "name")) || NOT_KARTING.test(tag(t, "name"))) return false;
  return true;
}
// a children's ride, not a circuit: every piece of the venue drawn (a pin alone says nothing of its size), none a hall or a sports centre,
// all of it within 70 m (a karting circuit is 300 m round at the least: DriftCar 26 m, a mall's mini track 60 m)
export function tinyVenue(els: El[]): boolean {
  let a = 90, b = 180, c = -90, d = -180;
  for (const e of els) { const g = e.tags || {}; if (!e.bounds || (g.building && g.building !== "no") || g.leisure === "sports_centre" || g.indoor === "yes") return false; a = Math.min(a, e.bounds.minlat); b = Math.min(b, e.bounds.minlon); c = Math.max(c, e.bounds.maxlat); d = Math.max(d, e.bounds.maxlon); }
  return els.length > 0 && distM({ lat: a, lon: b }, { lat: c, lon: d }) < 70;
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
  // loose ends 25 m apart or less (a raceway drawn almost round, two pieces not joined on the map): joined by a straight
  { const ends: { v: number; p: LL; way: El }[] = [];
    for (const [v, ps] of at) if (ps.length === 1) { const q = ps[0], g = q.a === v ? q.g[0] : q.g[q.g.length - 1]; ends.push({ v, p: g, way: q.way }); }
    if (ends.length <= 40) for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i], b = ends[j], d = distM(a.p, b.p); if (d > 25 || d < 0.01) continue;
      const way: El = { type: "way", id: a.way.id, tags: Object.assign({}, a.way.tags || {}, { oneway: "", "hutka:joined": "1" }) };
      const piece = { id: pieces.length, a: a.v, b: b.v, g: [a.p, b.p], way }; pieces.push(piece); at.get(a.v)!.push(piece); at.get(b.v)!.push(piece);
    } }
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

// a closed shape that is a track, not a site: twisty (compactness 4πA/L² of a kart track's middle ≈ 0.07–0.2, a rectangle 0.74) or
// full of bays (area / convex hull ≈ 0.4–0.65 for a track, 1 for a box); at least 10 corners of the drawing
export function trackLike(ring: LL[]): boolean {
  if (!ring || ring.length < 10) return false;
  let la = 0; for (const p of ring) la += p.lat; la /= ring.length;
  const kx = 111320 * Math.cos(la * rad), P = ring.map(p => [p.lon * kx, p.lat * 110574]);
  const area = (Q: number[][]) => { let s = 0; for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
  let L = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const srt = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [], up: number[][] = []; for (const q of srt) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); } for (const q of srt.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const A = area(P), H = area(lo.slice(0, -1).concat(up.slice(0, -1))), q = 4 * Math.PI * A / (L * L), cvx = H > 0 ? A / H : 1;
  return q < 0.3 || (q < 0.45 && cvx < 0.8);
}
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
    const outline = lp.ways.some(w => w.tags && w.tags["hutka:outline"]), joined = lp.ways.some(w => w.tags && w.tags["hutka:joined"]);
    const score = (kart > 0.5 ? 2 : 0) + (inside > 0.8 ? 2 : inside > 0.5 ? 1 : 0) + (dMid < 250 ? 1 : 0) + lp.lengthM / 10000 - (outline ? 0.6 : 0) - (joined ? 0.3 : 0);
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
  const pts6 = thin.map(p => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6] as [number, number]);
  const from = lp.ways.some(w => w.tags && w.tags["hutka:outline"]) ? "outline" : lp.ways.some(w => w.tags && w.tags["hutka:joined"]) ? "joined" : "raceway";
  return { pts: pts6, lengthM: Math.round(lp.lengthM), ways: [...new Set(lp.ways.map(w => w.id))], driven, dir: clockwise(thin) ? "cw" : "ccw", widthM: widths.length ? widths[Math.floor(widths.length / 2)] : 8, corners: cornerCount(pts6), from };
}

// ---- the area's elements → venues
const LATIN = /[A-Za-z]/;
const latinName = (pl: El) => { const en = tag(pl.tags, "name:en"), nm = tag(pl.tags, "name"); return LATIN.test(en) ? en : (LATIN.test(nm) ? nm : ""); };
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
    // the town: the address's; none, or written in a script most readers cannot read (Greek, Cyrillic, Arabic …) — the English name
    // the map gives that town, else the nearest town within 30 km with a name in Latin letters, else the nearest town as the map writes it
    let city = t(["addr:city", "addr:town", "addr:village", "addr:municipality", "addr:suburb"]);
    if ((!city || !LATIN.test(city)) && places.length) {
      const near = places.map(pl => ({ pl, d: distM(c.pos, { lat: pl.lat!, lon: pl.lon! }) })).filter(x => x.d < 30000).sort((a, b) => a.d - b.d);
      const pick = (city ? near.find(x => tag(x.pl.tags, "name") === city && latinName(x.pl)) : undefined) || near.find(x => latinName(x.pl));
      if (pick) city = latinName(pick.pl); else if (!city && near.length) city = tag(near[0].pl.tags, "name:en", "name");
    }
    const indoor = all.some(e => { const g = e.tags || {}; return g.indoor === "yes" || g.covered === "yes" || (g.building && g.building !== "no") || g.location === "indoor"; }) || /\bindoor|\bhalle\b|kart ?hall/i.test(c.name);
    // the venue's own track drawn as a closed shape (leisure=track: its middle, or its asphalt) — when it looks like a track, not a site
    const outl: El[] = []; let oid = -1;
    for (const e of all) { const g = e.tags || {}; if (g.leisure !== "track" || g.highway === "raceway" || (g.building && g.building !== "no") || !e.ring || !trackLike(e.ring)) continue;
      const ring = e.ring.slice(); if (ring[0].lat !== ring[ring.length - 1].lat || ring[0].lon !== ring[ring.length - 1].lon) ring.push(ring[0]);
      const ids = ring.map(() => oid--); ids[ids.length - 1] = ids[0];
      outl.push({ type: "way", id: e.id, tags: Object.assign({ sport: "karting" }, g, { oneway: "", "hutka:outline": "1" }), nodes: ids, geometry: ring }); }
    const loops = loopsOf((near.get(c) || []).concat(outl));
    const line = indoor && !loops.length ? null : lineFor(c, loops);
    if (!line && tinyVenue(all)) continue;   // a children's ride
    const m = c.main, osm = (m.type === "node" ? "n" : m.type === "way" ? "w" : "r") + m.id;
    const aka = new Set<string>(); for (const e of all) for (const k of NAMEKEYS) { const v = tag(e.tags, k); if (v) for (const x of v.split(";")) { const y = x.trim().slice(0, 80); if (y && y !== c.name) aka.add(y); } }
    out.push({ id: "osm-" + osm, osm, name: c.name.slice(0, 80), lat: Math.round(c.pos.lat * 1e5) / 1e5, lon: Math.round(c.pos.lon * 1e5) / 1e5, city: city.slice(0, 60), address: street.slice(0, 120), website: web.slice(0, 200), phone: t(["phone", "contact:phone"]).slice(0, 40), indoor, line, parts: all.length, nameRu: t(["name:ru"]).slice(0, 80), aka: [...aka].slice(0, 8) });
  }
  return out;
}
