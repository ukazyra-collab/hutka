// Hutka — the signed-in person's wallet (credits, plan) and prices; creates the wallet with the welcome credits on first call. Deploy with "Verify JWT" OFF.
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const FREE = Number(Deno.env.get("FREE_CREDITS") || "10");
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || ""; if (!auth.startsWith("Bearer ")) return json({ error: "sign_in" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await asUser.auth.getUser(); if (!user) return json({ error: "sign_in" }, 401);
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  const db = service ? createClient(url, service) : asUser;
  let { data: w } = await db.from("wallets").select("credits,plan,plan_until,stripe_customer").eq("user_id", user.id).maybeSingle();
  if (!w) { const { data: n } = await db.from("wallets").insert({ user_id: user.id, credits: FREE }).select("credits,plan,plan_until,stripe_customer").single(); w = n; if (n) await db.from("ledger").insert({ user_id: user.id, delta: FREE, reason: "welcome", ref: "welcome:" + user.id }); }
  const pro = !!(w && w.plan === "pro" && w.plan_until && new Date(w.plan_until).getTime() > Date.now());
  return json({ credits: w ? w.credits : 0, plan: pro ? "pro" : "free", plan_until: w ? w.plan_until : null, has_customer: !!(w && w.stripe_customer), stripe: !!Deno.env.get("STRIPE_SECRET_KEY"), ai: !!Deno.env.get("ANTHROPIC_API_KEY"), free_credits: FREE });
});
