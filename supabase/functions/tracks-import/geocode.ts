// Hutka — places by name (Photon, komoot's search over OpenStreetMap): for tracks known by name and town only (the SWS list), where they
// are on the map — the venue itself when the map has it, else the town. By hand only (an admin or the queue's token): nothing is written,
// the answers go back to the caller. Body: { geocode: [{ k, q, lat?, lon?, tag? }] } — k is the caller's key, q the text, lat/lon bias
// the search towards a place, tag narrows it ("place" = towns only). One question at a time, a pause between them (the public server
// asks to be used fairly); what is not asked before the deadline comes back under "left".
const UA = { "User-Agent": "Hutka/1.0 (+https://hutka.ai; karting track catalogue)" };
export type Hit = { name: string; lat: number; lon: number; cc: string; city: string; osm: string; key: string; value: string; type: string };
export type Ask = { k: string; q: string; lat?: number; lon?: number; tag?: string };
export async function photon(a: Ask): Promise<Hit[]> {
  const u = new URL("https://photon.komoot.io/api/");
  u.searchParams.set("q", a.q.slice(0, 200)); u.searchParams.set("limit", "6");
  if (typeof a.lat === "number" && typeof a.lon === "number" && isFinite(a.lat) && isFinite(a.lon)) { u.searchParams.set("lat", String(a.lat)); u.searchParams.set("lon", String(a.lon)); }
  if (a.tag && /^[a-z_]+(:[a-z_]+)?$/.test(a.tag)) u.searchParams.set("osm_tag", a.tag);
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`photon ${r.status}`);
  const j = await r.json() as { features?: { geometry: { coordinates: number[] }; properties: Record<string, string | number> }[] };
  return (j.features || []).map(f => {
    const p = f.properties, t = String(p.osm_type || "").toLowerCase();
    return { name: String(p.name || ""), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], cc: String(p.countrycode || ""), city: String(p.city || p.town || p.village || p.district || p.county || ""), osm: (t === "w" || t === "n" || t === "r" ? t : t.slice(0, 1)) + String(p.osm_id || ""), key: String(p.osm_key || ""), value: String(p.osm_value || ""), type: String(p.type || "") };
  });
}
export async function geocodeAll(asks: Ask[], until: number): Promise<{ out: Record<string, Hit[] | { error: string }>; left: string[] }> {
  const out: Record<string, Hit[] | { error: string }> = {}, left: string[] = [];
  for (const a of asks.slice(0, 400)) {
    if (Date.now() > until) { left.push(a.k); continue; }
    try { out[a.k] = await photon(a); } catch (e) { out[a.k] = { error: String((e as Error).message || e).slice(0, 120) }; }
    await new Promise(r => setTimeout(r, 350));
  }
  return { out, left };
}
