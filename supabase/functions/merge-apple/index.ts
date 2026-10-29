// Hutka — merge-apple: a driver signed in with Apple with "Hide My Email" and got a second, empty account
// (xxx@privaterelay.appleid.com). Once they sign in to their real account (Google / e-mail), the site calls this with the
// empty account's access token; the Apple identity moves onto the real account and the empty one is removed
// (public.merge_apple_identity, service role only). From then on "Continue with Apple" opens the real account.
// Deploy as `merge-apple` with "Verify JWT" OFF (the function checks both tokens itself).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const RELAY = /@privaterelay\.appleid\.com$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  if (!serviceKey) return json({ error: "not_configured" }, 503);

  // the real account: the caller
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const asTarget = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user: target } } = await asTarget.auth.getUser();
  if (!target) return json({ error: "unauthorized" }, 401);

  // the empty Apple account: its access token, sent by the page that still remembers it
  let body: { appleToken?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const appleToken = String(body.appleToken || "");
  if (appleToken.length < 40) return json({ error: "no_token" }, 400);
  const asSource = createClient(url, anonKey, { global: { headers: { Authorization: "Bearer " + appleToken } } });
  const { data: { user: source } } = await asSource.auth.getUser();
  if (!source) return json({ error: "source_token_invalid" }, 400);
  if (source.id === target.id) return json({ error: "same_user" }, 400);

  // only a fresh, empty, Apple-only account with a relay address may be merged — the SQL function checks the data side again
  const srcIds = (source.identities || []).map((i) => i.provider);
  if (!RELAY.test(source.email || "") || srcIds.length !== 1 || srcIds[0] !== "apple") return json({ error: "source_not_relay_apple" }, 400);
  if ((target.identities || []).some((i) => i.provider === "apple")) return json({ error: "target_has_apple" }, 409);

  const db = createClient(url, serviceKey);
  const { error } = await db.rpc("merge_apple_identity", { a: source.id, b: target.id });
  if (error) return json({ error: "merge_failed", detail: error.message }, 500);
  return json({ ok: true, merged: source.id, into: target.id });
});
