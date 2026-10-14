// Hutka — bug reports from the little button in the corner: stores the report and emails it to the owner.
// Deploy as `report` with "Verify JWT" OFF (guests can report too).
// Secrets: REPORT_TO (where the reports go, e.g. you@example.com), RESEND_API_KEY (the Resend key used for SMTP),
// REPORT_FROM (optional, default "Hutka <no-reply@hutka.ai>"), LIMIT_REPORT_IP_DAY (optional, default 10).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const num = (k: string, d: number) => { const v = Number(Deno.env.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
const esc = (s: string) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

async function ipHash(req: Request) {
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || xff[xff.length - 1] || "";
  if (!ip) return "";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hutka:" + ip));
  return Array.from(new Uint8Array(d)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  if (!serviceKey) return json({ error: "not_configured" }, 503);
  const db = createClient(url, serviceKey);

  // who (optional): a signed-in driver's id and email, from the token when there is one
  let userId: string | null = null, userEmail = "";
  const auth = req.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ") && auth.length > 40) {
    try { const asUser = createClient(url, anonKey, { global: { headers: { Authorization: auth } } }); const { data: { user } } = await asUser.auth.getUser(); if (user) { userId = user.id; userEmail = user.email || ""; } } catch { /* a guest */ }
  }

  let body: { text?: string; email?: string; page?: string; ua?: string; screen?: string; errors?: unknown[]; shot?: string; version?: string; name?: string; session?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const text = String(body.text || "").trim().slice(0, 4000);
  if (text.length < 3) return json({ error: "empty" }, 400);
  const email = String(body.email || userEmail || "").trim().slice(0, 120);
  const shot = typeof body.shot === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(body.shot) && body.shot.length <= 900_000 ? body.shot : null;
  const errors = Array.isArray(body.errors) ? body.errors.slice(0, 8).map((e) => String(e).slice(0, 400)) : [];
  const row = {
    user_id: userId, email, text, page: String(body.page || "").slice(0, 300), ua: String(body.ua || "").slice(0, 300), screen: String(body.screen || "").slice(0, 60),
    errors, shot, version: String(body.version || "").slice(0, 40), name: String(body.name || "").slice(0, 80), session_id: String(body.session || "").slice(0, 64) || null, ip_hash: await ipHash(req),
  };

  // a network address sends at most N reports a day
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  if (row.ip_hash) { const { count } = await db.from("reports").select("id", { count: "exact", head: true }).eq("ip_hash", row.ip_hash).gte("created_at", dayAgo); if ((count || 0) >= num("LIMIT_REPORT_IP_DAY", 10)) return json({ error: "rate_limited" }, 429); }

  const { data: saved, error } = await db.from("reports").insert(row).select("id").single();
  if (error) return json({ error: "db", detail: error.message }, 500);

  // the email (best effort: the report is already stored)
  let mailed = false;
  const to = Deno.env.get("REPORT_TO"), key = Deno.env.get("RESEND_API_KEY");
  if (to && key) {
    const who = [row.name, email, userId ? "user " + userId.slice(0, 8) : "guest"].filter(Boolean).join(" · ");
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1a2237">
      <p style="white-space:pre-wrap;background:#f3f4f7;border-radius:10px;padding:12px 14px">${esc(text)}</p>
      <table style="font-size:13px;color:#5f6b84;border-collapse:collapse">
        <tr><td style="padding:2px 12px 2px 0">From</td><td>${esc(who)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0">Page</td><td><a href="${esc(row.page)}">${esc(row.page)}</a></td></tr>
        ${row.session_id ? `<tr><td style="padding:2px 12px 2px 0">Session</td><td><a href="https://hutka.ai/#lab~${esc(row.session_id)}">${esc(row.session_id)}</a></td></tr>` : ""}
        <tr><td style="padding:2px 12px 2px 0">Device</td><td>${esc(row.ua)} · ${esc(row.screen)} · ${esc(row.version)}</td></tr>
        ${errors.length ? `<tr><td style="padding:2px 12px 2px 0;vertical-align:top">JS errors</td><td><pre style="white-space:pre-wrap;margin:0;font-size:12px">${esc(errors.join("\n"))}</pre></td></tr>` : ""}
        <tr><td style="padding:2px 12px 2px 0">Report</td><td>#${saved.id} · <a href="https://hutka.ai/#admin">admin panel</a></td></tr>
      </table></div>`;
    const payload: Record<string, unknown> = { from: Deno.env.get("REPORT_FROM") || "Hutka <no-reply@hutka.ai>", to: [to], subject: `[Hutka] ${text.replace(/\s+/g, " ").slice(0, 70)}${text.length > 70 ? "…" : ""}`, html };
    if (email) payload.reply_to = email;
    if (shot) payload.attachments = [{ filename: "screenshot." + (shot.startsWith("data:image/png") ? "png" : "jpg"), content: shot.split(",")[1] }];
    try { const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(payload) }); mailed = r.ok; if (!r.ok) console.error("resend", r.status, await r.text()); } catch (e) { console.error("resend", e); }
  }
  return json({ ok: true, id: saved.id, mailed });
});
