// Hutka — places by name: for tracks known by name and town only (the SWS list), where they are on the map — the venue itself when the
// map has it, else the town. Two public searches over OpenStreetMap: Nominatim (the OSM Foundation's; narrowed to a country, at most one
// question a second as its rules ask) and Photon (komoot's; looser matching, a place to bias towards; it stops answering a caller that
// asks too fast, so it gets a longer pause and one more try). By hand only (an admin or the queue's token): nothing is written, the
// answers go back to the caller. Body: { geocode: [{ k, q, cc?, src?, lat?, lon?, tag? }] } — k is the caller's key, q the text, cc the
// country, src "nominatim" (the default) or "photon", lat/lon a place to bias towards (Photon), tag a kind of thing (Photon: "place" =
// towns only). One question at a time; what is not asked before the deadline comes back under "left".
const UA = { "User-Agent": "Hutka/1.0 (+https://hutka.ai; karting track catalogue)" };
export type Hit = { name: string; lat: number; lon: number; cc: string; city: string; osm: string; key: string; value: string; type: string };
export type Ask = { k: string; q: string; cc?: string; src?: string; lat?: number; lon?: number; tag?: string };
const osmRef = (t: string, id: unknown) => { const c = String(t || "").toLowerCase().slice(0, 1); return /^[nwr]$/.test(c) && id ? c + String(id) : ""; };
export async function photon(a: Ask): Promise<Hit[]> {
  const u = new URL("https://photon.komoot.io/api/");
  u.searchParams.set("q", a.q.slice(0, 200)); u.searchParams.set("limit", "6");
  if (typeof a.lat === "number" && typeof a.lon === "number" && isFinite(a.lat) && isFinite(a.lon)) { u.searchParams.set("lat", String(a.lat)); u.searchParams.set("lon", String(a.lon)); }
  if (a.tag && /^[a-z_]+(:[a-z_]+)?$/.test(a.tag)) u.searchParams.set("osm_tag", a.tag);
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`photon ${r.status}`);
  const j = await r.json() as { features?: { geometry: { coordinates: number[] }; properties: Record<string, string | number> }[] };
  return (j.features || []).filter(f => !a.cc || String(f.properties.countrycode || "").toUpperCase() === a.cc.toUpperCase()).map(f => {
    const p = f.properties;
    return { name: String(p.name || ""), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], cc: String(p.countrycode || "").toUpperCase(), city: String(p.city || p.town || p.village || p.district || p.county || ""), osm: osmRef(String(p.osm_type || ""), p.osm_id), key: String(p.osm_key || ""), value: String(p.osm_value || ""), type: String(p.type || "") };
  });
}
type NomRow = { name?: string; display_name?: string; lat: string; lon: string; osm_type?: string; osm_id?: number; category?: string; type?: string; addresstype?: string; address?: Record<string, string> };
export async function nominatim(a: Ask): Promise<Hit[]> {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", a.q.slice(0, 200)); u.searchParams.set("format", "jsonv2"); u.searchParams.set("limit", "5"); u.searchParams.set("addressdetails", "1");
  if (a.cc && /^[A-Za-z]{2}$/.test(a.cc)) u.searchParams.set("countrycodes", a.cc.toLowerCase());
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`nominatim ${r.status}`);
  const j = await r.json() as NomRow[];
  return (Array.isArray(j) ? j : []).map(x => {
    const ad = x.address || {};
    return { name: String(x.name || (x.display_name || "").split(",")[0] || ""), lat: +x.lat, lon: +x.lon, cc: String(ad.country_code || "").toUpperCase(), city: String(ad.city || ad.town || ad.village || ad.municipality || ad.suburb || ad.county || ""), osm: osmRef(String(x.osm_type || ""), x.osm_id), key: String(x.category || ""), value: String(x.type || ""), type: String(x.addresstype || "") };
  });
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function geocodeAll(asks: Ask[], until: number): Promise<{ out: Record<string, Hit[] | { error: string }>; left: string[] }> {
  const out: Record<string, Hit[] | { error: string }> = {}, left: string[] = [];
  for (const a of asks.slice(0, 400)) {
    if (Date.now() > until) { left.push(a.k); continue; }
    const ph = a.src === "photon", ask = ph ? photon : nominatim;
    try { out[a.k] = await ask(a); }
    catch (e) {   // refused (too many questions): a longer pause, one more try
      await wait(ph ? 6000 : 3000);
      try { out[a.k] = await ask(a); } catch (e2) { out[a.k] = { error: String((e2 as Error).message || e2).slice(0, 120) }; }
    }
    await wait(ph ? 1700 : 1100);
  }
  return { out, left };
}
