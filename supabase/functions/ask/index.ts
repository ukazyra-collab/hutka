// Hutka — "Ask the AI" edge function: forwards the chat to the Anthropic API and streams the answer back.
// Deploy as function name `ask`; secrets: ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("method", { status: 405, headers: cors });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return new Response("sign in first", { status: 401, headers: cors });
  // only signed-in Hutka users may spend the key
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("sign in first", { status: 401, headers: cors });
  let body: { system?: string; messages?: unknown[] };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400, headers: cors }); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-14) : [];
  if (!messages.length) return new Response("no messages", { status: 400, headers: cors });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return new Response("ANTHROPIC_API_KEY is not set", { status: 500, headers: cors });
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5", max_tokens: 1500, system: String(body.system || "").slice(0, 60000), messages, stream: true }),
  });
  if (!upstream.ok || !upstream.body) return new Response(await upstream.text(), { status: upstream.status, headers: cors });
  return new Response(upstream.body, { headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } });
});
