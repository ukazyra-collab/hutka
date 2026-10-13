// Hutka — start a Stripe Checkout for a credit pack or the Pro subscription. Deploy with "Verify JWT" OFF.
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_PACK25, STRIPE_PRICE_PACK80, SITE_URL (https://.../hutka/)
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const auth = req.headers.get("Authorization") || ""; if (!auth.startsWith("Bearer ")) return json({ error: "sign_in" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await asUser.auth.getUser(); if (!user) return json({ error: "sign_in" }, 401);
  const sk = Deno.env.get("STRIPE_SECRET_KEY"); if (!sk) return json({ error: "not_configured" }, 503);
  let body: { kind?: string; return_url?: string }; try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const prices: Record<string, string | undefined> = { pro: Deno.env.get("STRIPE_PRICE_PRO"), pack25: Deno.env.get("STRIPE_PRICE_PACK25"), pack80: Deno.env.get("STRIPE_PRICE_PACK80") };
  const kind = String(body.kind || ""), price = prices[kind]; if (!price) return json({ error: "unknown_product" }, 400);
  const okSite = (u: string) => /^https:\/\/(hutka\.ai|www\.hutka\.ai|ukazyra-collab\.github\.io)(\/|$)/i.test(u) ? u : "";
  const site = (Deno.env.get("SITE_URL") || okSite(String(body.return_url || "")) || "").replace(/#.*$/, "");
  if (!site) return json({ error: "no_site_url" }, 500);
  // reuse the Stripe customer when the wallet already knows it
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  const db = service ? createClient(url, service) : asUser;
  const { data: w } = await db.from("wallets").select("stripe_customer").eq("user_id", user.id).maybeSingle();
  const params: Record<string, string> = {
    mode: kind === "pro" ? "subscription" : "payment",
    "line_items[0][price]": price, "line_items[0][quantity]": "1",
    success_url: site + "#ai~paid", cancel_url: site + "#ai",
    client_reference_id: user.id, "metadata[user_id]": user.id, "metadata[kind]": kind,
    allow_promotion_codes: "true",
  };
  if (w && w.stripe_customer) params.customer = w.stripe_customer; else if (user.email) params.customer_email = user.email;
  if (kind === "pro") { params["subscription_data[metadata][user_id]"] = user.id; }
  else { params["payment_intent_data[metadata][user_id]"] = user.id; params["payment_intent_data[metadata][kind]"] = kind; }
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: "Bearer " + sk, "Content-Type": "application/x-www-form-urlencoded" }, body: form(params) });
  const s = await r.json();
  if (!r.ok) return json({ error: "stripe", detail: s.error && s.error.message }, 502);
  return json({ url: s.url, id: s.id });
});
