// Hutka — activity e-mails: "Pasha liked your session", "Greg commented: …". The site calls this on every open (signed in);
// the function claims the pending rows of notify_queue (notify.sql) that are older than two minutes, groups them per driver,
// sends one e-mail per driver through Resend (at most one per hour per driver; off when profiles.notify = false) and marks them sent.
// Deploy as `notify` with "Verify JWT" OFF (the token is checked here; a NOTIFY_SECRET header works too, for a cron).
// Secrets: RESEND_API_KEY (the same as for the reports); optional NOTIFY_FROM ("Hutka <no-reply@hutka.ai>"), SITE_URL, NOTIFY_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notify-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const fmtMs = (ms: number) => { if (!ms || !isFinite(ms)) return ""; const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(3); return m ? `${m}:${s.padStart(6, "0")}` : s; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "", resend = Deno.env.get("RESEND_API_KEY") || "";
  if (!serviceKey) return json({ error: "not_configured", detail: "service key" }, 503);
  if (!resend) return json({ error: "not_configured", detail: "RESEND_API_KEY" }, 503);
  // who may trigger a run: any signed-in driver (the site pings on open) or a cron with the secret
  const secret = Deno.env.get("NOTIFY_SECRET") || "";
  let allowed = !!secret && req.headers.get("x-notify-secret") === secret;
  if (!allowed) { const sb = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } }); const { data: { user } } = await sb.auth.getUser(); allowed = !!user; }
  if (!allowed) return json({ error: "sign_in" }, 401);
  const site = (Deno.env.get("SITE_URL") || "https://hutka.ai").replace(/\/$/, ""), from = Deno.env.get("NOTIFY_FROM") || "Hutka <no-reply@hutka.ai>";
  const db = createClient(url, serviceKey);

  // pending rows older than two minutes (a burst of likes becomes one line), grouped per driver
  const since = new Date(Date.now() - 2 * 60000).toISOString();
  const { data: rows, error } = await db.from("notify_queue").select("id, owner, actor, kind, session_id, comment_id, created_at").is("sent_at", null).lt("created_at", since).order("created_at", { ascending: true }).limit(500);
  if (error) return json({ error: "db", detail: error.message }, 500);
  if (!rows || !rows.length) return json({ sent: 0, pending: 0 });
  const byOwner = new Map<string, typeof rows>(); for (const r of rows) { if (!byOwner.has(r.owner)) byOwner.set(r.owner, []); byOwner.get(r.owner)!.push(r); }
  let sent = 0, skipped = 0;
  for (const [owner, list] of byOwner) {
    // once an hour per driver at most: the rest waits for the next run
    const { data: last } = await db.from("notify_queue").select("sent_at").eq("owner", owner).not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1);
    if (last && last.length && Date.now() - new Date(last[0].sent_at).getTime() < 3600000) { skipped += list.length; continue; }
    const { data: prof } = await db.from("profiles").select("notify, racing_name, first_name").eq("id", owner).maybeSingle();
    const ids = list.map((r) => r.id);
    if (prof && prof.notify === false) { await db.from("notify_queue").update({ sent_at: new Date().toISOString() }).in("id", ids); continue; }   // opted out: dropped, not re-tried
    const { data: u } = await db.auth.admin.getUserById(owner); const email = u && u.user ? u.user.email : "";
    if (!email) { await db.from("notify_queue").update({ sent_at: new Date().toISOString() }).in("id", ids); continue; }
    // claim first, send second — two runs at once cannot send the same rows twice
    const { data: claimed } = await db.from("notify_queue").update({ sent_at: new Date().toISOString() }).in("id", ids).is("sent_at", null).select("id");
    if (!claimed || !claimed.length) continue;
    // names, sessions, comment texts
    const actors = [...new Set(list.map((r) => r.actor).filter(Boolean))], sids = [...new Set(list.map((r) => r.session_id).filter(Boolean))], cids = list.map((r) => r.comment_id).filter(Boolean);
    const [{ data: people }, { data: sess }, { data: comments }] = await Promise.all([
      actors.length ? db.from("profiles").select("id, racing_name, first_name, last_name").in("id", actors) : Promise.resolve({ data: [] as any[] }),
      sids.length ? db.from("sessions").select("id, meta, track_id").in("id", sids) : Promise.resolve({ data: [] as any[] }),
      cids.length ? db.from("comments").select("id, text").in("id", cids) : Promise.resolve({ data: [] as any[] }),
    ]);
    const nameOf = (id: string) => { const p = (people || []).find((x: any) => x.id === id); return p ? ([p.first_name, p.last_name].filter(Boolean).join(" ") || p.racing_name || "A driver") : "A driver"; };
    const sessOf = (id: string) => { const s = (sess || []).find((x: any) => x.id === id); const m = (s && s.meta) || {}; return { label: m.label || m.name || "your session", best: fmtMs(+m.bestMs), track: m.trackName || "" }; };
    // one line per session: likes grouped ("Pasha and 2 others liked…"), comments quoted
    const perSess = new Map<string, { likes: string[]; comments: { who: string; text: string }[] }>();
    for (const r of list) { const k = r.session_id || ""; if (!perSess.has(k)) perSess.set(k, { likes: [], comments: [] }); const g = perSess.get(k)!; if (r.kind === "comment") { const c = (comments || []).find((x: any) => x.id === r.comment_id); g.comments.push({ who: nameOf(r.actor), text: c ? String(c.text).slice(0, 300) : "" }); } else if (!g.likes.includes(nameOf(r.actor))) g.likes.push(nameOf(r.actor)); }
    const lines: string[] = [], plain: string[] = [];
    for (const [sid, g] of perSess) {
      const s = sessOf(sid), link = `${site}/#lab~${sid}~discuss`, title = `${s.label}${s.best ? " · " + s.best : ""}`;
      if (g.likes.length) { const who = g.likes.length === 1 ? g.likes[0] : g.likes.length === 2 ? `${g.likes[0]} and ${g.likes[1]}` : `${g.likes[0]} and ${g.likes.length - 1} others`; lines.push(`<p style="margin:0 0 10px"><b>${esc(who)}</b> liked <a href="${esc(link)}" style="color:#2f6bf0">${esc(title)}</a></p>`); plain.push(`${who} liked ${title} — ${link}`); }
      for (const c of g.comments) { lines.push(`<p style="margin:0 0 10px"><b>${esc(c.who)}</b> commented on <a href="${esc(link)}" style="color:#2f6bf0">${esc(title)}</a>:<br><span style="color:#5f6b84">“${esc(c.text)}”</span></p>`); plain.push(`${c.who} commented on ${title}: "${c.text}" — ${link}`); }
    }
    const nLikes = list.filter((r) => r.kind === "like").length, nComments = list.filter((r) => r.kind === "comment").length;
    const subject = nComments && nLikes ? `New comments and likes on your sessions` : nComments ? (nComments === 1 ? `New comment on your session` : `${nComments} new comments on your sessions`) : (nLikes === 1 ? `Someone liked your session` : `${nLikes} new likes on your sessions`);
    const html = `<div style="font:15px/1.5 Inter,system-ui,sans-serif;color:#1a2237;max-width:560px;padding:8px"><p style="margin:0 0 14px;font-weight:700;font-size:17px">Activity on Hutka</p>${lines.join("")}<p style="margin:16px 0 0"><a href="${site}/#home" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#1a2237;color:#fff;text-decoration:none;font-weight:600">Open Hutka</a></p><p style="margin:18px 0 0;font-size:12px;color:#5f6b84">You get one e-mail per hour at most. Turn these off in your profile: ${site}/#profile</p></div>`;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [email], subject, html, text: plain.join("\n") + `\n\nOpen Hutka: ${site}\nTurn these off in your profile: ${site}/#profile` }) });
    if (r.ok) sent++; else { const d = await r.text().catch(() => ""); console.error("resend", r.status, d.slice(0, 200)); }
  }
  return json({ sent, skipped });
});
