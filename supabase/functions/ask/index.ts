// Hutka — the racing AI. One call = one answer: checks the wallet (plan or credits), keeps the chat in the database,
// streams the Anthropic reply back as SSE, then stores the reply and charges one credit.
// Deploy as `ask` with "Verify JWT" OFF. Secrets: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional), FREE_CREDITS (optional, default 10).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-chat-id, x-credits, x-plan",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const FREE = Number(Deno.env.get("FREE_CREDITS") || "10");
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
const HOURLY_LIMIT = 40;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "sign_in" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || req.headers.get("apikey") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "sign_in" }, 401);
  const db = serviceKey ? createClient(url, serviceKey) : asUser;

  let body: { chat_id?: number; session_id?: string; track_id?: string; layout_id?: string; title?: string; system?: string; text?: string; lang?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const text = String(body.text || "").trim().slice(0, 4000);
  if (!text) return json({ error: "empty" }, 400);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "not_configured" }, 503);

  // ---- wallet: welcome credits on first use, then plan or credits
  let { data: wallet } = await db.from("wallets").select("*").eq("user_id", user.id).maybeSingle();
  if (!wallet) {
    const { data: w } = await db.from("wallets").insert({ user_id: user.id, credits: FREE }).select("*").single();
    wallet = w; if (w) await db.from("ledger").insert({ user_id: user.id, delta: FREE, reason: "welcome", ref: "welcome:" + user.id });
  }
  const pro = wallet && wallet.plan === "pro" && wallet.plan_until && new Date(wallet.plan_until).getTime() > Date.now();
  if (!pro && (!wallet || wallet.credits < 1)) return json({ error: "no_credits", credits: wallet ? wallet.credits : 0, plan: wallet ? wallet.plan : "free" }, 402);
  // ---- fair use
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("role", "user").gte("created_at", since);
  if ((count || 0) >= HOURLY_LIMIT) return json({ error: "rate_limited" }, 429);

  // ---- chat
  let chatId = body.chat_id ? Number(body.chat_id) : 0;
  if (chatId) {
    const { data: c } = await db.from("chats").select("id,user_id").eq("id", chatId).maybeSingle();
    if (!c || c.user_id !== user.id) return json({ error: "no_chat" }, 404);
  } else {
    const { data: c, error } = await db.from("chats").insert({ user_id: user.id, title: String(body.title || text).slice(0, 80), session_id: body.session_id || null, track_id: body.track_id || null, layout_id: body.layout_id || null }).select("id").single();
    if (error || !c) return json({ error: "chat_create" }, 500);
    chatId = c.id;
  }
  const { data: hist } = await db.from("messages").select("role,content").eq("chat_id", chatId).order("created_at", { ascending: true }).limit(200);
  const history = (hist || []).slice(-16).map((m) => ({ role: m.role, content: m.content }));
  await db.from("messages").insert({ chat_id: chatId, user_id: user.id, role: "user", content: text });
  const messages = [...history, { role: "user", content: text }];
  const system = String(body.system || "").slice(0, 80000);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1800, system, messages, stream: true }),
  });
  if (!upstream.ok || !upstream.body) { const t = await upstream.text(); return json({ error: "upstream", status: upstream.status, detail: t.slice(0, 300) }, 502); }

  // forward the SSE stream; collect the reply and the usage, then store and charge
  let reply = "", tokIn = 0, tokOut = 0, buf = "";
  const dec = new TextDecoder();
  const finish = async () => {
    try {
      const { data: m } = await db.from("messages").insert({ chat_id: chatId, user_id: user.id, role: "assistant", content: reply, tokens_in: tokIn, tokens_out: tokOut, credits: pro ? 0 : 1 }).select("id").single();
      await db.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
      if (!pro && m) {
        await db.from("wallets").update({ credits: Math.max(0, (wallet!.credits || 0) - 1), updated_at: new Date().toISOString() }).eq("user_id", user.id);
        await db.from("ledger").insert({ user_id: user.id, delta: -1, reason: "ask", ref: "msg:" + m.id });
      }
    } catch (_) { /* best effort */ }
  };
  const out = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.text) reply += ev.delta.text;
          if (ev.type === "message_start" && ev.message && ev.message.usage) tokIn = ev.message.usage.input_tokens || 0;
          if (ev.type === "message_delta" && ev.usage) tokOut = ev.usage.output_tokens || 0;
        } catch (_) { /* partial json */ }
      }
    },
    async flush() { await finish(); },
  });
  const headers = { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Chat-Id": String(chatId), "X-Credits": String(pro ? wallet!.credits : Math.max(0, (wallet!.credits || 0) - 1)), "X-Plan": pro ? "pro" : "free" };
  return new Response(upstream.body.pipeThrough(out), { headers });
});
