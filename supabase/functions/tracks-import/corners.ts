// Hutka — how many corners a map line has, counted exactly as the app counts them on the track page (so the list and the page agree):
// the app's own steps, copied — the line in local metres (data2.js geoLayout), a closed centripetal Catmull-Rom spline resampled
// evenly (kll.js buildTrack), the start at the middle of the longest straight (app_tracks.js osmGeom), the curvature over ~4 m
// smoothed (data2.js trackCurv), and the corners: stretches tighter than R 110 m, gaps ≤ 6 m bridged, ≥ 10 m long, a tight bend
// followed by a much faster one of the same hand split in two (data2.js autoCorners, no reference lap). Keep in step with those.
type P = { x: number; y: number };
const clamp = (x: number, a: number, b: number) => x < a ? a : x > b ? b : x;

function splineClosed(pts: P[], perSeg: number): P[] {
  const n = pts.length, out: P[] = [];
  if (n < 3) return pts.slice();
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const d01 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)) || 1e-3;
    const d12 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)) || 1e-3;
    const d23 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)) || 1e-3;
    const t0 = 0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23;
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + (t2 - t1) * k / perSeg;
      const a1x = ((t1 - t) * p0.x + (t - t0) * p1.x) / (t1 - t0), a1y = ((t1 - t) * p0.y + (t - t0) * p1.y) / (t1 - t0);
      const a2x = ((t2 - t) * p1.x + (t - t1) * p2.x) / (t2 - t1), a2y = ((t2 - t) * p1.y + (t - t1) * p2.y) / (t2 - t1);
      const a3x = ((t3 - t) * p2.x + (t - t2) * p3.x) / (t3 - t2), a3y = ((t3 - t) * p2.y + (t - t2) * p3.y) / (t3 - t2);
      const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0), b1y = ((t2 - t) * a1y + (t - t0) * a2y) / (t2 - t0);
      const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1), b2y = ((t3 - t) * a2y + (t - t1) * a3y) / (t3 - t1);
      out.push({ x: ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1), y: ((t2 - t) * b1y + (t - t1) * b2y) / (t2 - t1) });
    }
  }
  return out;
}
function resampleClosed(poly: P[], N: number): { pts: P[]; L: number } {
  const n = poly.length, cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y); }
  const L = cum[n], out: P[] = new Array(N); let seg = 0;
  for (let k = 0; k < N; k++) {
    const target = L * k / N;
    while (seg < n - 1 && cum[seg + 1] < target) seg++;
    const a = poly[seg], b = poly[(seg + 1) % n], segLen = cum[seg + 1] - cum[seg];
    const u = segLen > 0 ? (target - cum[seg]) / segLen : 0;
    out[k] = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }
  return { pts: out, L };
}
type Tr = { N: number; ds: number; cx: Float64Array; cy: Float64Array };
function buildTrack(pts: P[], lengthM: number, startU: number): Tr {
  const dense = splineClosed(pts, 24);
  const dsTarget = clamp(lengthM / 1600, 0.5, 1.0);
  const N = clamp(Math.round(lengthM / dsTarget), 200, 4000);
  const rs = resampleClosed(dense, N);
  const mpp = lengthM / rs.L, ds = lengthM / N;
  const s0 = Math.round(startU * N) % N;
  const cx = new Float64Array(N), cy = new Float64Array(N);
  for (let i = 0; i < N; i++) { const j = (s0 + i) % N; cx[i] = rs.pts[j].x * mpp; cy[i] = rs.pts[j].y * mpp; }
  return { N, ds, cx, cy };
}
function curvAt(qx: Float64Array, qy: Float64Array, N: number, i: number, st: number): number {
  const a = (i - st + N) % N, c = (i + st) % N;
  const abx = qx[i] - qx[a], aby = qy[i] - qy[a], bcx = qx[c] - qx[i], bcy = qy[c] - qy[i], acx = qx[c] - qx[a], acy = qy[c] - qy[a];
  const cross = abx * bcy - aby * bcx;
  const d = Math.sqrt((abx * abx + aby * aby) * (bcx * bcx + bcy * bcy) * (acx * acx + acy * acy));
  return d > 1e-12 ? 2 * cross / d : 0;
}
const smooth = (arr: Float64Array, N: number, k: number) => { const out = new Float64Array(N); for (let i = 0; i < N; i++) { let s = 0; for (let q = -k; q <= k; q++) s += arr[(i + q + N) % N]; out[i] = s / (2 * k + 1); } return out; };
function trackCurv(tr: Tr): Float64Array {
  const N = tr.N, k = Math.max(1, Math.round(4 / tr.ds)), kap = new Float64Array(N);
  for (let i = 0; i < N; i++) kap[i] = curvAt(tr.cx, tr.cy, N, i, k);
  return smooth(kap, N, k);
}
function autoCorners(tr: Tr, Rthr: number): number[] {
  const N = tr.N, ds = tr.ds, m = (x: number) => Math.max(1, Math.round(x / ds)), ks = trackCurv(tr), thr = 1 / (Rthr || 110);
  const on = new Int8Array(N); for (let i = 0; i < N; i++) on[i] = Math.abs(ks[i]) >= thr ? Math.sign(ks[i]) : 0;
  const gap = m(6);
  for (let i = 0; i < N; i++) if (!on[i]) { const prev = on[(i - 1 + N) % N]; if (!prev) continue; let j = 1; while (j <= gap && !on[(i + j) % N]) j++; if (j <= gap && on[(i + j) % N] === prev) for (let q = 0; q < j; q++) on[(i + q) % N] = prev; }
  let s0 = -1; for (let i = 0; i < N; i++) if (!on[i]) { s0 = i; break; }
  if (s0 < 0) return [];
  const st: { a: number; len: number }[] = []; let i = s0, steps = 0;
  while (steps < N) { const v = on[i % N]; if (!v) { i++; steps++; continue; } const a = i % N; let len = 0; while (len < N && on[(a + len) % N] === v) len++; i += len; steps += len; if (len * ds >= 10) st.push({ a, len }); }
  const apexes: number[] = [], ks8 = smooth(ks, N, m(8));
  for (const c of st) {
    const cuts = new Set<number>();
    { const e = m(5), W = m(20), peaks: number[] = [];
      for (let q = e; q <= c.len - e; q++) { const k = (c.a + q) % N, x = Math.abs(ks8[k]); let ok = true; for (let d = -W; d <= W && ok; d++) { if (!d) continue; const kk = (c.a + Math.max(0, Math.min(c.len, q + d))) % N; if (Math.abs(ks8[kk]) > x || (Math.abs(ks8[kk]) === x && d < 0)) ok = false; } if (ok) peaks.push(q); }
      for (let p = 0; p + 1 < peaks.length; p++) { const q1 = peaks[p], q2 = peaks[p + 1]; if ((q2 - q1) * ds < 40) continue; let dip = Infinity, di = q1; for (let d = q1; d <= q2; d++) { const x = Math.abs(ks8[(c.a + d) % N]); if (x < dip) { dip = x; di = d; } } const k1 = Math.abs(ks8[(c.a + q1) % N]), k2 = Math.abs(ks8[(c.a + q2) % N]), small = Math.min(k1, k2), big = Math.max(k1, k2); if (big >= 2 * small && dip <= 0.7 * small) cuts.add(di); } }
    const cutList = [0].concat(Array.from(cuts).sort((p, q) => p - q), [c.len]);
    for (let p = 0; p + 1 < cutList.length; p++) { if ((cutList[p + 1] - cutList[p]) * ds < 12) continue; let bi = -1, bv = -1; for (let q = cutList[p]; q <= cutList[p + 1]; q++) { const k = (c.a + q) % N; if (Math.abs(ks[k]) > bv) { bv = Math.abs(ks[k]); bi = k; } } if (bi >= 0) apexes.push(bi); }
  }
  return apexes.sort((p, q) => p - q);
}
// a line of [lat, lon] → the number of corners the app's track page finds on it (R = the layout's corner radius, 110 m by default)
export function cornerCount(ll: [number, number][], R = 110): number {
  if (!ll || ll.length < 8) return 0;
  let la = 0, lo = 0; for (const p of ll) { la += p[0]; lo += p[1]; } la /= ll.length; lo /= ll.length;
  const kx = 111320 * Math.cos(la * Math.PI / 180), ky = 110574;
  const pts = ll.map(p => ({ x: (p[1] - lo) * kx, y: -(p[0] - la) * ky }));   // metres, y down as on the screen
  let len = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; len += Math.hypot(b.x - a.x, b.y - a.y); }
  const lengthM = Math.round(len); if (lengthM < 50) return 0;
  const tr0 = buildTrack(pts, lengthM, 0), ks = trackCurv(tr0), N = tr0.N;
  let best = { len: 0, mid: 0 }, run = 0, start = 0;
  for (let q = 0; q < 2 * N; q++) { const i = q % N; if (Math.abs(ks[i]) < 1 / 150) { if (!run) start = q; run++; if (run > best.len && run <= N) best = { len: run, mid: (start + Math.floor(run / 2)) % N }; } else run = 0; }
  return autoCorners(buildTrack(pts, lengthM, best.mid / N), R).length;
}
