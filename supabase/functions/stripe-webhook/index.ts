// Hutka — Stripe webhook: credits packs and the Pro subscription land in the wallet. Deploy with "Verify JWT" OFF.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_PACK25, STRIPE_PRICE_PACK80, PACK25_CREDITS (25), PACK80_CREDITS (80)
import { createClient } from "npm:@supabase/supabase-js@2";
const enc = new TextEncoder();
async function verify(payload: string, sig: string, secret: string) {
  const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts.t, v1 = parts.v1; if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(t + "." + payload)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== v1.length) return false; let d = 0; for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ v1.charCodeAt(i); return d === 0;   // constant-time compare
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET"), sk = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret || !sk) return new Response("not configured", { status: 503 });
  const payload = await req.text();
  if (!(await verify(payload, req.headers.get("stripe-signature") || "", secret))) return new Response("bad signature", { status: 400 });
  const ev = JSON.parse(payload);
  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  const db = createClient(url, service);
  const packs: Record<string, number> = { pack25: Number(Deno.env.get("PACK25_CREDITS") || "25"), pack80: Number(Deno.env.get("PACK80_CREDITS") || "80") };
  const ensure = async (uid: string) => { const { data } = await db.from("wallets").select("*").eq("user_id", uid).maybeSingle(); if (data) return data; const { data: w } = await db.from("wallets").insert({ user_id: uid, credits: 0 }).select("*").single(); return w; };
  const addCredits = async (uid: string, n: number, reason: string, ref: string) => {
    const { error } = await db.from("ledger").insert({ user_id: uid, delta: n, reason, ref }); if (error) return;   // same event twice → the unique ref stops a double credit
    const w = await ensure(uid); await db.from("wallets").update({ credits: (w.credits || 0) + n, updated_at: new Date().toISOString() }).eq("user_id", uid);
  };
  const stripeGet = async (path: string) => (await fetch("https://api.stripe.com/v1/" + path, { headers: { Authorization: "Bearer " + sk } })).json();
  try {
    if (ev.type === "checkout.session.completed") {
      const s = ev.data.object, uid = s.client_reference_id || (s.metadata && s.metadata.user_id); if (!uid) return new Response("no user", { status: 200 });
      const w = await ensure(uid);
      if (s.customer && s.customer !== w.stripe_customer) await db.from("wallets").update({ stripe_customer: s.customer }).eq("user_id", uid);
      if (s.mode === "payment") { const kind = s.metadata && s.metadata.kind; const n = packs[kind] || 0; if (n) await addCredits(uid, n, "pack:" + kind, "cs:" + s.id); }
      if (s.mode === "subscription" && s.subscription) { const sub = await stripeGet("subscriptions/" + s.subscription); await db.from("wallets").update({ plan: "pro", plan_until: new Date((sub.current_period_end || 0) * 1000).toISOString(), stripe_subscription: sub.id, updated_at: new Date().toISOString() }).eq("user_id", uid); await db.from("ledger").insert({ user_id: uid, delta: 0, reason: "pro:start", ref: "cs:" + s.id }); }
    } else if (ev.type === "invoice.paid") {
      const inv = ev.data.object; if (inv.subscription) { const sub = await stripeGet("subscriptions/" + inv.subscription); const uid = sub.metadata && sub.metadata.user_id; if (uid) { await ensure(uid); await db.from("wallets").update({ plan: "pro", plan_until: new Date((sub.current_period_end || 0) * 1000).toISOString(), stripe_subscription: sub.id, stripe_customer: sub.customer, updated_at: new Date().toISOString() }).eq("user_id", uid); await db.from("ledger").insert({ user_id: uid, delta: 0, reason: "pro:renew", ref: "inv:" + inv.id }); } }
    } else if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
      const sub = ev.data.object, uid = sub.metadata && sub.metadata.user_id;
      if (uid) { const active = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due"; await ensure(uid); await db.from("wallets").update({ plan: active ? "pro" : "free", plan_until: active ? new Date((sub.current_period_end || 0) * 1000).toISOString() : null, stripe_subscription: sub.id, updated_at: new Date().toISOString() }).eq("user_id", uid); }
    }
  } catch (e) { return new Response("error: " + (e && (e as Error).message), { status: 500 }); }
  return new Response("ok", { status: 200 });
});
