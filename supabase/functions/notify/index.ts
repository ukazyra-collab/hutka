// Hutka — activity notifications: "Pasha liked your session", "Greg commented: …". The site calls this on every open (signed in)
// and ~20 s after a like or a comment. Two lanes over the same notify_queue (notify.sql, push.sql):
//   1. pushes to the iPhone / Android app (push_tokens): right away, one push per driver per run, badge = unread activity.
//      iOS goes straight to APNs (HTTP/2, a JWT signed with the .p8 key), Android through FCM HTTP v1 (a service account).
//      Not configured → the lane is skipped, nothing breaks. A row delivered as a push is marked sent, so no e-mail follows it.
//   2. e-mails through Resend for the rest: rows older than two minutes grouped per driver, one e-mail per hour per driver at most.
// Deploy as `notify` with "Verify JWT" OFF (the token is checked here; a NOTIFY_SECRET header works too, for a cron).
// Secrets: RESEND_API_KEY (e-mails); APNS_KEY (the .p8 contents), APNS_KEY_ID, APNS_TEAM_ID, optional APNS_TOPIC (ai.hutka.app);
// FCM_SERVICE_ACCOUNT (the Firebase service-account JSON); optional NOTIFY_FROM ("Hutka <no-reply@hutka.ai>"), SITE_URL, NOTIFY_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notify-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const fmtMs = (ms: number) => { if (!ms || !isFinite(ms)) return ""; const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(3); return m ? `${m}:${s.padStart(6, "0")}` : s; };
const b64url = (u8: Uint8Array) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64json = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const pemDer = (pem: string) => Uint8Array.from(atob(pem.replace(/\\n/g, "\n").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
type Row = { id: number; owner: string; actor: string | null; kind: string; session_id: string | null; comment_id: number | null; created_at: string };

// ---------- APNs: a provider token (ES256 JWT, reused for 50 minutes — Apple wants it refreshed between 20 and 60 minutes) ----------
let apnsJwt = { token: "", at: 0 };
async function apnsAuth(key: string, kid: string, tid: string) {
  if (apnsJwt.token && Date.now() - apnsJwt.at < 50 * 60000) return apnsJwt.token;
  const k = await crypto.subtle.importKey("pkcs8", pemDer(key), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64json({ alg: "ES256", kid }), claims = b64json({ iss: tid, iat: Math.floor(Date.now() / 1000) });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, new TextEncoder().encode(head + "." + claims)));
  apnsJwt = { token: `${head}.${claims}.${b64url(sig)}`, at: Date.now() };
  return apnsJwt.token;
}
// one push to one iPhone; "bad" = the token is dead (drop it), "config" = our side is wrong (keep the token)
async function apnsSend(token: string, payload: unknown, auth: string, topic: string, sandbox = false): Promise<"ok" | "bad" | "fail" | "config"> {
  const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const r = await fetch(`https://${host}/3/device/${token}`, { method: "POST", headers: { authorization: `bearer ${auth}`, "apns-topic": topic, "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": "0" }, body: JSON.stringify(payload) });
  if (r.ok) return "ok";
  const d = await r.json().catch(() => ({})) as { reason?: string };
  if (r.status === 410 || d.reason === "Unregistered" || d.reason === "DeviceTokenNotForTopic") return "bad";
  if (d.reason === "BadDeviceToken") { if (!sandbox) return apnsSend(token, payload, auth, topic, true); return "bad"; }   // a build from Xcode talks to the sandbox
  if (r.status === 403 || d.reason === "InvalidProviderToken" || d.reason === "ExpiredProviderToken" || d.reason === "MissingProviderToken" || d.reason === "TopicDisallowed") { console.error("apns config", r.status, d.reason); return "config"; }
  console.error("apns", r.status, d.reason); return "fail";
}
// ---------- FCM HTTP v1: an OAuth2 access token from the service account (RS256 JWT), reused for 50 minutes ----------
let fcmTok = { token: "", at: 0 };
async function fcmAuth(sa: { client_email: string; private_key: string }) {
  if (fcmTok.token && Date.now() - fcmTok.at < 50 * 60000) return fcmTok.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64json({ alg: "RS256", typ: "JWT" }), claims = b64json({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const k = await crypto.subtle.importKey("pkcs8", pemDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(head + "." + claims)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${head}.${claims}.${b64url(sig)}` });
  const j = await r.json().catch(() => ({})) as { access_token?: string; error?: string };
  if (!r.ok || !j.access_token) { console.error("fcm auth", r.status, j.error); return ""; }
  fcmTok = { token: j.access_token, at: Date.now() };
  return fcmTok.token;
}
async function fcmSend(token: string, project: string, auth: string, title: string, body: string, url: string, badge: number): Promise<"ok" | "bad" | "fail" | "config"> {
  const message = { token, notification: { title, body }, data: { url, badge: String(badge) }, android: { priority: "high", notification: { channel_id: "hutka", sound: "default", notification_count: badge } } };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, { method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
  if (r.ok) return "ok";
  const d = await r.json().catch(() => ({})) as { error?: { status?: string; message?: string } };
  const st = d.error && d.error.status || "";
  if (r.status === 404 || st === "NOT_FOUND" || st === "UNREGISTERED" || (r.status === 400 && /token/i.test(d.error && d.error.message || ""))) return "bad";
  if (r.status === 401 || r.status === 403 || st === "PERMISSION_DENIED" || st === "UNAUTHENTICATED") { console.error("fcm config", r.status, st); return "config"; }
  console.error("fcm", r.status, st, d.error && d.error.message); return "fail";
}

// names and sessions behind a list of queue rows (shared by both lanes)
async function describe(db: ReturnType<typeof createClient>, list: Row[]) {
  const actors = [...new Set(list.map((r) => r.actor).filter(Boolean))] as string[], sids = [...new Set(list.map((r) => r.session_id).filter(Boolean))] as string[], cids = list.map((r) => r.comment_id).filter(Boolean) as number[];
  const [{ data: people }, { data: sess }, { data: comments }] = await Promise.all([
    actors.length ? db.from("profiles").select("id, racing_name, first_name, last_name").in("id", actors) : Promise.resolve({ data: [] as any[] }),
    sids.length ? db.from("sessions").select("id, meta, track_id").in("id", sids) : Promise.resolve({ data: [] as any[] }),
    cids.length ? db.from("comments").select("id, text").in("id", cids) : Promise.resolve({ data: [] as any[] }),
  ]);
  const nameOf = (id: string | null) => { const p = (people || []).find((x: any) => x.id === id); return p ? ([p.first_name, p.last_name].filter(Boolean).join(" ") || p.racing_name || "A driver") : "A driver"; };
  const sessOf = (id: string | null) => { const s = (sess || []).find((x: any) => x.id === id); const m = (s && s.meta) || {}; return { label: m.label || m.name || "your session", best: fmtMs(+m.bestMs), track: m.trackName || "" }; };
  const textOf = (id: number | null) => { const c = (comments || []).find((x: any) => x.id === id); return c ? String(c.text).slice(0, 300) : ""; };
  return { nameOf, sessOf, textOf };
}

// ---------- lane 1: pushes ----------
async function runPushes(db: ReturnType<typeof createClient>) {
  const apnsKey = Deno.env.get("APNS_KEY") || "", apnsKid = Deno.env.get("APNS_KEY_ID") || "", apnsTid = Deno.env.get("APNS_TEAM_ID") || "", topic = Deno.env.get("APNS_TOPIC") || "ai.hutka.app";
  let sa: { client_email: string; private_key: string; project_id: string } | null = null;
  try { const raw = Deno.env.get("FCM_SERVICE_ACCOUNT") || ""; if (raw) sa = JSON.parse(raw); } catch (e) { console.error("FCM_SERVICE_ACCOUNT is not JSON"); }
  const apnsOn = !!(apnsKey && apnsKid && apnsTid), fcmOn = !!(sa && sa.client_email && sa.private_key && sa.project_id);
  if (!apnsOn && !fcmOn) return { configured: false, sent: 0 };
  // pending rows at least 10 s old (a burst of likes becomes one push); anything older than a day is too late for a push
  const { data: rows, error } = await db.from("notify_queue").select("id, owner, actor, kind, session_id, comment_id, created_at").is("pushed_at", null).lt("created_at", new Date(Date.now() - 10000).toISOString()).order("created_at", { ascending: true }).limit(500);
  if (error) { console.error("push rows", error.message); return { configured: true, sent: 0, error: error.message }; }
  if (!rows || !rows.length) return { configured: true, sent: 0 };
  const byOwner = new Map<string, Row[]>(); for (const r of rows as Row[]) { if (!byOwner.has(r.owner)) byOwner.set(r.owner, []); byOwner.get(r.owner)!.push(r); }
  let sent = 0, dropped = 0, config = false;
  for (const [owner, list] of byOwner) {
    const ids = list.map((r) => r.id);
    const { data: claimed } = await db.from("notify_queue").update({ pushed_at: new Date().toISOString() }).in("id", ids).is("pushed_at", null).select("id");   // claim first: two runs cannot push the same rows twice
    if (!claimed || !claimed.length) continue;
    const fresh = list.filter((r) => Date.now() - new Date(r.created_at).getTime() < 86400000); if (!fresh.length) continue;
    const { data: prof } = await db.from("profiles").select("push").eq("id", owner).maybeSingle(); if (prof && prof.push === false) continue;
    const { data: tokens } = await db.from("push_tokens").select("token, platform, failed").eq("user_id", owner); if (!tokens || !tokens.length) continue;
    const { count: unread } = await db.from("notify_queue").select("id", { count: "exact", head: true }).eq("owner", owner).is("seen_at", null);
    const badge = Math.max(1, unread || 0);
    // the text: one person, one session → specific; otherwise a summary
    const { nameOf, sessOf, textOf } = await describe(db, fresh);
    const likes = fresh.filter((r) => r.kind === "like"), comments = fresh.filter((r) => r.kind === "comment");
    const sids = [...new Set(fresh.map((r) => r.session_id).filter(Boolean))] as string[], s0 = sessOf(sids[0] || null), sessTitle = `${s0.label}${s0.best ? " · " + s0.best : ""}`;
    let title = "", body = "";
    if (comments.length === 1 && !likes.length) { title = `${nameOf(comments[0].actor)} commented`; body = `“${textOf(comments[0].comment_id)}” — ${sessTitle}`; }
    else if (!comments.length && sids.length === 1) { const who = [...new Set(likes.map((r) => nameOf(r.actor)))]; title = who.length === 1 ? `${who[0]} liked your session` : who.length === 2 ? `${who[0]} and ${who[1]} liked your session` : `${who[0]} and ${who.length - 1} others liked your session`; body = `${sessTitle}${s0.track ? " — " + s0.track : ""}`; }
    else { title = "Activity on Hutka"; const bits = []; if (likes.length) bits.push(`${likes.length} ${likes.length === 1 ? "like" : "likes"}`); if (comments.length) bits.push(`${comments.length} ${comments.length === 1 ? "comment" : "comments"}`); body = `${bits.join(", ")} on ${sids.length === 1 ? sessTitle : "your sessions"}`; }
    const url = sids.length === 1 ? `#lab~${sids[0]}~discuss` : "#activity";
    const aps = { aps: { alert: { title, body }, badge, sound: "default", "thread-id": "hutka" }, url };
    let okAny = false;
    for (const tk of tokens) {
      let res: "ok" | "bad" | "fail" | "config" = "fail";
      try {
        if (tk.platform === "ios") { if (!apnsOn) continue; res = await apnsSend(tk.token, aps, await apnsAuth(apnsKey, apnsKid, apnsTid), topic); }
        else { if (!fcmOn) continue; const auth = await fcmAuth(sa!); res = auth ? await fcmSend(tk.token, sa!.project_id, auth, title, body, url, badge) : "config"; }
      } catch (e) { console.error("push", tk.platform, String(e && (e as Error).message || e)); res = "fail"; }
      if (res === "ok") { okAny = true; sent++; if (tk.failed) await db.from("push_tokens").update({ failed: 0, seen_at: new Date().toISOString() }).eq("token", tk.token); }
      else if (res === "bad" || (res === "fail" && (tk.failed || 0) >= 9)) { dropped++; await db.from("push_tokens").delete().eq("token", tk.token); }
      else if (res === "fail") await db.from("push_tokens").update({ failed: (tk.failed || 0) + 1 }).eq("token", tk.token);
      else config = true;
    }
    if (okAny) await db.from("notify_queue").update({ sent_at: new Date().toISOString() }).in("id", ids).is("sent_at", null);   // delivered to a phone: no e-mail for the same thing
  }
  return { configured: true, sent, dropped, config };
}

// ---------- lane 2: e-mails ----------
async function runEmails(db: ReturnType<typeof createClient>, site: string, from: string, resend: string) {
  // pending rows older than two minutes (a burst of likes becomes one line), grouped per driver
  const since = new Date(Date.now() - 2 * 60000).toISOString();
  const { data: rows, error } = await db.from("notify_queue").select("id, owner, actor, kind, session_id, comment_id, created_at").is("sent_at", null).lt("created_at", since).order("created_at", { ascending: true }).limit(500);
  if (error) return { sent: 0, error: error.message };
  if (!rows || !rows.length) return { sent: 0, pending: 0 };
  const byOwner = new Map<string, Row[]>(); for (const r of rows as Row[]) { if (!byOwner.has(r.owner)) byOwner.set(r.owner, []); byOwner.get(r.owner)!.push(r); }
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
    const { nameOf, sessOf, textOf } = await describe(db, list);
    // one line per session: likes grouped ("Pasha and 2 others liked…"), comments quoted
    const perSess = new Map<string, { likes: string[]; comments: { who: string; text: string }[] }>();
    for (const r of list) { const k = r.session_id || ""; if (!perSess.has(k)) perSess.set(k, { likes: [], comments: [] }); const g = perSess.get(k)!; if (r.kind === "comment") g.comments.push({ who: nameOf(r.actor), text: textOf(r.comment_id) }); else if (!g.likes.includes(nameOf(r.actor))) g.likes.push(nameOf(r.actor)); }
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
  return { sent, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "", resend = Deno.env.get("RESEND_API_KEY") || "";
  if (!serviceKey) return json({ error: "not_configured", detail: "service key" }, 503);
  // who may trigger a run: any signed-in driver (the site pings on open and after a like / comment) or a cron with the secret
  const secret = Deno.env.get("NOTIFY_SECRET") || "";
  let allowed = !!secret && req.headers.get("x-notify-secret") === secret;
  if (!allowed) { const sb = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } }); const { data: { user } } = await sb.auth.getUser(); allowed = !!user; }
  if (!allowed) return json({ error: "sign_in" }, 401);
  const site = (Deno.env.get("SITE_URL") || "https://hutka.ai").replace(/\/$/, ""), from = Deno.env.get("NOTIFY_FROM") || "Hutka <no-reply@hutka.ai>";
  const db = createClient(url, serviceKey);
  let push: unknown = { configured: false, sent: 0 };
  try { push = await runPushes(db); } catch (e) { console.error("push lane", String(e && (e as Error).message || e)); push = { error: String(e && (e as Error).message || e) }; }
  const mail = resend ? await runEmails(db, site, from, resend) : { sent: 0, error: "RESEND_API_KEY" };
  return json({ sent: mail.sent, skipped: (mail as any).skipped || 0, push });
});
