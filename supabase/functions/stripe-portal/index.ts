// Hutka — open the Stripe customer portal (manage or cancel the Pro subscription). Deploy with "Verify JWT" OFF.
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || ""; if (!auth.startsWith("Bearer ")) return json({ error: "sign_in" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await asUser.auth.getUser(); if (!user) return json({ error: "sign_in" }, 401);
  const sk = Deno.env.get("STRIPE_SECRET_KEY"); if (!sk) return json({ error: "not_configured" }, 503);
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  const db = service ? createClient(url, service) : asUser;
  const { data: w } = await db.from("wallets").select("stripe_customer").eq("user_id", user.id).maybeSingle();
  if (!w || !w.stripe_customer) return json({ error: "no_customer" }, 404);
  const site = (Deno.env.get("SITE_URL") || "").replace(/#.*$/, "");
  const r = await fetch("https://api.stripe.com/v1/billing_portal/sessions", { method: "POST", headers: { Authorization: "Bearer " + sk, "Content-Type": "application/x-www-form-urlencoded" }, body: "customer=" + encodeURIComponent(w.stripe_customer) + "&return_url=" + encodeURIComponent(site + "#ai") });
  const s = await r.json(); if (!r.ok) return json({ error: "stripe", detail: s.error && s.error.message }, 502);
  return json({ url: s.url });
});
