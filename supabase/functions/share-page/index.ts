// Hutka — the link preview of a published session. A messenger (WhatsApp, Telegram, iMessage, Instagram) reads the Open Graph
// tags of the page it is given; hutka.ai is a single page with hash routes, so every link showed the same generic card.
// This function writes a tiny static page per published session into the GitHub Pages repo (s/<id>.html) with the session's
// own title, text and picture; the page sends people on to hutka.ai/#lab~<id>. Called by the owner (or an admin) when a session
// is published, edited or shared; `remove: true` (or an unpublished session) deletes the page.
// Deploy as `share-page` with "Verify JWT" OFF (the token is checked here). Secrets: GITHUB_TOKEN (a fine-grained token with
// Contents: read & write on the site repo), optional GITHUB_REPO (default ukazyra-collab/hutka), SITE_URL (default https://hutka.ai).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const fmtMs = (ms: number) => { if (!ms || !isFinite(ms)) return ""; const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(3); return m ? `${m}:${s.padStart(6, "0")}` : s; };
const FORMATS: Record<string, string> = { practice: "Practice", qualifying: "Qualifying", sprint: "Sprint", race: "Race", ironman: "Ironman", endurance: "Endurance", other: "Other" };
const fmtDate = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); if (!m) return String(d || ""); return `${+m[3]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1] || ""} ${m[1]}`; };
const b64 = (s: string) => { const bytes = new TextEncoder().encode(s); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const token = Deno.env.get("GITHUB_TOKEN") || "", repo = Deno.env.get("GITHUB_REPO") || "ukazyra-collab/hutka", site = (Deno.env.get("SITE_URL") || "https://hutka.ai").replace(/\/$/, "");
  if (!token) return json({ error: "not_configured", detail: "GITHUB_TOKEN is not set" }, 503);
  const url = Deno.env.get("SUPABASE_URL")!, anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const sb = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "sign_in" }, 401);
  let body: { id?: string; remove?: boolean; img?: string } = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const id = String(body.id || "");
  if (!/^[a-z0-9]{4,40}$/i.test(id)) return json({ error: "bad_id" }, 400);
  const { data: row } = await sb.from("sessions").select("id, owner, published, track_id, layout_id, meta").eq("id", id).maybeSingle();
  if (!row) return json({ error: "not_found" }, 404);
  if (row.owner !== user.id) { const { data: adm } = await sb.rpc("is_admin"); if (adm !== true) return json({ error: "not_yours" }, 403); }

  // the page in the repo
  const path = `s/${id}.html`;
  const gh = (p: string, init?: RequestInit) => fetch(`https://api.github.com/repos/${repo}/contents/${p}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "hutka-share", "Content-Type": "application/json", ...((init && init.headers) || {}) } });
  const cur = await gh(path); const sha: string | undefined = cur.ok ? (await cur.json()).sha : undefined;
  if (body.remove || !row.published) {
    if (sha) { const r = await gh(path, { method: "DELETE", body: JSON.stringify({ message: `share page ${id}: removed`, sha }) }); if (!r.ok && r.status !== 404) return json({ error: "github", detail: `${r.status} ${(await r.text()).slice(0, 200)}` }, 502); }
    return json({ removed: true });
  }

  // what the preview says
  const m = (row.meta || {}) as Record<string, any>;
  const [{ data: prof }, { data: trk }, { data: lay }] = await Promise.all([
    sb.from("profiles").select("racing_name, first_name, last_name").eq("id", row.owner).maybeSingle(),
    row.track_id ? sb.from("tracks").select("data").eq("id", row.track_id).maybeSingle() : Promise.resolve({ data: null as any }),
    row.track_id && row.layout_id && row.layout_id !== "custom" ? sb.from("layouts").select("data").eq("track_id", row.track_id).eq("id", row.layout_id).maybeSingle() : Promise.resolve({ data: null as any }),
  ]);
  const who = prof ? ([prof.first_name, prof.last_name].filter(Boolean).join(" ") || prof.racing_name || "") : "";
  const track = (trk && trk.data && trk.data.name) || m.trackName || "", layout = (lay && lay.data && lay.data.name) || "";
  const best = fmtMs(+m.bestMs), avg = fmtMs(+m.avgMs);
  const pos = +m.pos || 0, drivers = +m.drivers || 0, fmt = FORMATS[String(m.format || "")] || "";
  const result = pos ? `P${pos}${drivers ? " / " + drivers : ""}${fmt ? " · " + fmt : ""}` : fmt;
  const title = `${who ? who + " — " : ""}${best}${track ? " · " + track : ""}`.trim() || "Hutka session";
  const facts = [result, avg ? `avg ${avg}` : "", m.nLaps ? `${m.nLaps} laps` : "", m.kart || "", layout, fmtDate(m.date)].filter(Boolean).join(" · ");
  const desc = `${facts ? facts + ". " : ""}Every corner — brake, apex, throttle — on hutka.ai. Open to see the analysis and compare with your own laps.`;
  // the picture: the card the Lab drew (cards/<owner>/<id>.png in the public bucket), otherwise the site's own
  const okImg = (p: string) => new RegExp(`^cards/${row.owner}/${id}\\.png$`).test(p);
  const imgPath = body.img && okImg(body.img) ? body.img : (m.share && m.share.img && okImg(m.share.img) ? m.share.img : "");
  const stamp = Date.now().toString(36);
  const image = imgPath ? `${url}/storage/v1/object/public/${imgPath}?v=${stamp}` : `${site}/og.png?v=1`;
  const imgW = 1200, imgH = 630;
  const page = `${site}/s/${id}`, target = `${site}/#lab~${id}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Hutka</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(page)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Hutka"><meta property="og:url" content="${esc(page)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="${imgW}"><meta property="og:image:height" content="${imgH}"><meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">
<meta name="robots" content="noindex">
<link rel="icon" href="${site}/favicon.ico">
<style>body{margin:0;font:16px/1.5 Inter,system-ui,sans-serif;background:#f6f7fa;color:#1a2237;display:grid;place-items:center;min-height:100vh}main{max-width:560px;padding:24px;text-align:center}img{max-width:100%;border-radius:14px;box-shadow:0 10px 30px rgba(16,22,48,.15)}a.btn{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:12px;background:#1a2237;color:#fff;text-decoration:none;font-weight:600}p{color:#5f6b84}</style>
<script>location.replace(${JSON.stringify(target)});</script>
</head><body><main><img src="${esc(image)}" alt=""><h1>${esc(title)}</h1><p>${esc(desc)}</p><a class="btn" href="${esc(target)}">Open in Hutka</a></main></body></html>
`;
  let r = await gh(path, { method: "PUT", body: JSON.stringify({ message: `share page ${id}`, content: b64(html), ...(sha ? { sha } : {}) }) });
  if (r.status === 409 || r.status === 422) {   // written by someone else a moment ago: take its sha and try once more
    const again = await gh(path); const sha2 = again.ok ? (await again.json()).sha : undefined;
    r = await gh(path, { method: "PUT", body: JSON.stringify({ message: `share page ${id}`, content: b64(html), ...(sha2 ? { sha: sha2 } : {}) }) });
  }
  if (!r.ok) return json({ error: "github", detail: `${r.status} ${(await r.text()).slice(0, 200)}` }, 502);
  return json({ url: page, title, image: imgPath ? image : "" });
});
