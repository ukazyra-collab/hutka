// Hutka — what the signed-in person may ask: in the free beta (FREE_MODE=1, default) their fair-use usage today; with billing on, their credits and plan.
// Creates the wallet with the welcome credits on first call when billing is on. Deploy with "Verify JWT" OFF.
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const num = (k: string, d: number) => { const v = Number(Deno.env.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
const FREE = num("FREE_CREDITS", 10);
const FREE_MODE = (Deno.env.get("FREE_MODE") ?? "1") !== "0";
const PAUSED = (Deno.env.get("AI_PAUSED") || "0") === "1";
const LIM = { hour: num("LIMIT_HOUR", 15), day: num("LIMIT_DAY", 50), global: num("LIMIT_GLOBAL_DAY", 800) };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || ""; if (!auth.startsWith("Bearer ")) return json({ error: "sign_in" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await asUser.auth.getUser(); if (!user) return json({ error: "sign_in" }, 401);
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  const db = service ? createClient(url, service) : asUser;
  const ai = !!Deno.env.get("ANTHROPIC_API_KEY"), stripe = !!Deno.env.get("STRIPE_SECRET_KEY");
  // usage today (rolling 24 h) and this hour: mine, and everyone's
  const hourAgo = new Date(Date.now() - 3600_000).toISOString(), dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const cnt = async (q: PromiseLike<{ count: number | null }>) => (await q).count || 0;
  const [usedHour, usedDay, usedGlobal] = await Promise.all([
    cnt(db.from("messages").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("role", "user").gte("created_at", hourAgo)),
    cnt(db.from("messages").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("role", "user").gte("created_at", dayAgo)),
    cnt(db.from("messages").select("id", { count: "exact", head: true }).eq("role", "user").gte("created_at", dayAgo)),
  ]);
  const usage = { used_hour: usedHour, limit_hour: LIM.hour, used_day: usedDay, limit_day: LIM.day, global_day: usedGlobal, global_limit: LIM.global, paused: PAUSED };
  if (FREE_MODE) return json({ free: true, plan: "beta", credits: null, ai, stripe, ...usage });
  let { data: w } = await db.from("wallets").select("credits,plan,plan_until,stripe_customer").eq("user_id", user.id).maybeSingle();
  if (!w) { const { data: n } = await db.from("wallets").insert({ user_id: user.id, credits: FREE }).select("credits,plan,plan_until,stripe_customer").single(); w = n; if (n) await db.from("ledger").insert({ user_id: user.id, delta: FREE, reason: "welcome", ref: "welcome:" + user.id }); }
  const pro = !!(w && w.plan === "pro" && w.plan_until && new Date(w.plan_until).getTime() > Date.now());
  return json({ credits: w ? w.credits : 0, plan: pro ? "pro" : "free", plan_until: w ? w.plan_until : null, has_customer: !!(w && w.stripe_customer), stripe, ai, free_credits: FREE, ...usage });
});
