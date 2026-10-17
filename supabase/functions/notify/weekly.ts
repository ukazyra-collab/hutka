// Hutka — the weekly digest, the pure part: which week is due, who gets one, and what it says. No database here; notify/index.ts
// fetches the rows and sends. Kept apart so it can be run in Node (node --experimental-strip-types) with made-up rows.
export type Sess = { id: string; owner: string; track_id: string | null; layout_id: string | null; published: boolean; best_ms: number | null; meta: any; created_at: string };
export type Digest = { owner: string; title: string; body: string; url: string; subject: string; html: string; text: string; sessions: number };

const fmtMs = (ms: number) => { if (!ms || !isFinite(ms)) return ""; const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(3); return m ? `${m}:${s.padStart(6, "0")}` : s; };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${+m[3]} ${MON[+m[2] - 1] || ""}` : String(d || ""); };
// the kart class of a session, the way the site groups them (kartKeyOf): a rental model, a sport class, or just "rental"
const kartSlug = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "");
export const kartKey = (m: any) => { if (!m) return "rental"; if (m.kartClass === "sport") return m.kartCat ? String(m.kartCat) : (m.kart ? "sport:" + kartSlug(m.kart) : "sport"); return m.kart ? "rental:" + kartSlug(m.kart) : "rental"; };

// ISO week of a date, as "2026-W42"
export function weekKey(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); const w = 1 + Math.round(((t.getTime() - y0.getTime()) / 86400000 - 3 + ((y0.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}
// the week that is due at `now`: from Monday 03:00 UTC (07:00 in Dubai) through Tuesday the previous Monday–Sunday is reported; null otherwise
export function dueWeek(now: Date): { key: string; start: Date; end: Date } | null {
  const dow = now.getUTCDay();
  if (!((dow === 1 && now.getUTCHours() >= 3) || dow === 2)) return null;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dow === 1 ? 0 : 1)));   // this week's Monday 00:00 UTC
  const start = new Date(end.getTime() - 7 * 86400000);
  return { key: weekKey(start), start, end };
}
export const inWeek = (m: any, w: { start: Date; end: Date }) => { const d = String((m && m.date) || "").slice(0, 10); return d >= dateStr(w.start) && d < dateStr(w.end); };

// one driver's digest. `mine` = their sessions of the week; `earlier` = all their sessions before the week (for the records);
// `followed` = the published sessions of the week by drivers they follow, with the drivers' names; `trackName` resolves a track id
export function buildDigest(owner: string, mine: Sess[], earlier: Sess[], followed: { s: Sess; who: string }[], trackName: (id: string | null) => string, site: string, layoutName?: (tid: string | null, lid: string | null) => string): Digest | null {
  const week = mine.filter((s) => s.meta).sort((a, b) => String(a.meta.date || "").localeCompare(String(b.meta.date || "")));
  if (!week.length) return null;
  const key = (s: Sess) => `${s.track_id || ""}|${s.layout_id || "custom"}|${kartKey(s.meta)}`;
  const bestBefore = new Map<string, number>(); for (const s of earlier) { const b = +(s.best_ms || (s.meta && s.meta.bestMs) || 0); if (b > 0) bestBefore.set(key(s), Math.min(bestBefore.get(key(s)) || Infinity, b)); }
  const where = (s: Sess) => { const tn = trackName(s.track_id) || (s.meta && s.meta.trackName) || "Custom track"; const ln = s.layout_id && s.layout_id !== "custom" ? ` · ${(layoutName && layoutName(s.track_id, s.layout_id)) || s.layout_id}` : ""; return tn + ln; };
  // a record: faster than every earlier session of theirs on that layout in that kart class — and than the week's earlier sessions
  const seen = new Map<string, number>(); const rows = week.map((s) => { const b = +(s.best_ms || s.meta.bestMs || 0), k = key(s), prev = Math.min(bestBefore.get(k) || Infinity, seen.get(k) || Infinity); if (b > 0) seen.set(k, Math.min(seen.get(k) || Infinity, b)); return { s, b, pb: b > 0 && b < prev && isFinite(prev) ? "pb" : (b > 0 && !isFinite(prev) ? "first" : "") }; });
  const best = rows.filter((r) => r.b > 0).sort((a, b) => a.b - b.b)[0];
  // the corners with the most to gain, from the feed cards of the week's sessions (the latest session of each layout decides)
  const gains: { n: number; d: number; s: Sess }[] = []; const latestByKey = new Map<string, Sess>(); for (const s of week) latestByKey.set(key(s), s);
  for (const s of latestByKey.values()) { const top = s.meta && s.meta.card && Array.isArray(s.meta.card.top) ? s.meta.card.top : []; for (const [n, d] of top) if (+d >= 0.1) gains.push({ n: +n, d: +d, s }); }
  gains.sort((a, b) => b.d - a.d); const fix = gains.slice(0, 2);
  const pbRows = rows.filter((r) => r.pb === "pb");
  const nSess = week.length, sessWord = nSess === 1 ? "session" : "sessions";
  // the push / the e-mail subject
  const title = "Your week on Hutka";
  const bits = [`${nSess} ${sessWord}`]; if (best) bits.push(`best ${fmtMs(best.b)} at ${where(best.s)}`); if (pbRows.length) bits.push(pbRows.length === 1 ? "a personal best" : `${pbRows.length} personal bests`); if (fix.length) bits.push(`T${fix[0].n} first (${fix[0].d.toFixed(2)} s to gain)`);
  const body = bits.join(" · ");
  const url = best ? `#lab~${best.s.id}` : "#profile";
  const subject = pbRows.length ? `Your week on Hutka: a personal best` : `Your week on Hutka: ${nSess} ${sessWord}`;
  // the e-mail
  const li = rows.map((r) => `<li style="margin:0 0 6px"><a href="${esc(site)}/#lab~${esc(r.s.id)}" style="color:#2f6bf0;text-decoration:none"><b>${esc(r.s.meta.label || r.s.meta.name || "Session")}</b></a> · ${esc(where(r.s))} · ${esc(fmtDate(r.s.meta.date))}${r.b ? ` · <b>${esc(fmtMs(r.b))}</b>` : ""}${r.pb === "pb" ? ` <span style="color:#1f8f4f;font-weight:700">personal best</span>` : (r.pb === "first" ? ` <span style="color:#5f6b84">first time here</span>` : "")}</li>`).join("");
  const fixHtml = fix.length ? `<p style="margin:14px 0 4px;font-weight:700">Most to gain</p><p style="margin:0 0 6px">${fix.map((g) => `<a href="${esc(site)}/#lab~${esc(g.s.id)}~t${g.n}" style="color:#2f6bf0;text-decoration:none">T${g.n}</a> — ${g.d.toFixed(2)} s against the best passes${g.s === fix[0].s && fix.length > 1 && fix[1].s !== fix[0].s ? ` (${esc(where(g.s))})` : ""}`).join("; ")}. Open the corner — the inspector says what the fastest do differently.</p>` : "";
  const folHtml = followed.length ? `<p style="margin:14px 0 4px;font-weight:700">Drivers you follow</p><ul style="margin:0;padding-left:18px">${followed.slice(0, 6).map((f) => `<li style="margin:0 0 6px"><b>${esc(f.who)}</b> — <a href="${esc(site)}/#lab~${esc(f.s.id)}" style="color:#2f6bf0;text-decoration:none">${esc(fmtMs(+(f.s.best_ms || f.s.meta.bestMs || 0)))}</a> at ${esc(where(f.s))}</li>`).join("")}</ul>` : "";
  const html = `<div style="font:15px/1.5 Inter,system-ui,sans-serif;color:#1a2237;max-width:560px;padding:8px"><p style="margin:0 0 4px;font-weight:700;font-size:17px">Your week on Hutka</p><p style="margin:0 0 12px;color:#5f6b84">${esc(body)}</p><ul style="margin:0;padding-left:18px">${li}</ul>${fixHtml}${folHtml}<p style="margin:18px 0 0"><a href="${esc(site)}/#profile" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#1a2237;color:#fff;text-decoration:none;font-weight:600">Your progress</a></p><p style="margin:14px 0 0;font-size:12px;color:#8b94a7">One e-mail a week, only after a week with sessions. Turn it off in your profile: ${esc(site)}/#profile</p></div>`;
  const text = [`Your week on Hutka — ${body}`, ...rows.map((r) => `- ${r.s.meta.label || r.s.meta.name || "Session"} · ${where(r.s)} · ${fmtDate(r.s.meta.date)}${r.b ? " · " + fmtMs(r.b) : ""}${r.pb === "pb" ? " · personal best" : ""} — ${site}/#lab~${r.s.id}`), ...(fix.length ? [`Most to gain: ${fix.map((g) => `T${g.n} (${g.d.toFixed(2)} s) ${site}/#lab~${g.s.id}~t${g.n}`).join("; ")}`] : []), ...(followed.length ? [`Drivers you follow: ${followed.slice(0, 6).map((f) => `${f.who} ${fmtMs(+(f.s.best_ms || f.s.meta.bestMs || 0))} at ${where(f.s)}`).join("; ")}`] : []), `Turn it off in your profile: ${site}/#profile`].join("\n");
  return { owner, title, body, url, subject, html, text, sessions: nSess };
}
