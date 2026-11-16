// Motor de digitalização: camadas (máscaras) -> polígonos -> pontos de bordado.
import { contours } from "d3-contour";
import ClipperLib from "clipper-lib";
import { STITCH, JUMP, COLOR_CHANGE, END } from "./pes.js";

const CS = 1000; // escala do Clipper: 1 unidade = 1 µm

// ------------------------------------------------------------------ cor

function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function rgbToLab(r, g, b) {
  const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Analisa a imagem e propõe as cores do bordado.
 * img: {width,height,data(RGBA)}. Retorna {labels(Int8Array, -1=fundo), colors:[{rgb,lab,share}]}
 */
export function analyzeColors(img, opts = {}) {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const lab = new Float32Array(N * 3);
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const L = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    lab[i * 3] = L[0]; lab[i * 3 + 1] = L[1]; lab[i * 3 + 2] = L[2];
    alpha[i] = data[i * 4 + 3];
  }
  // fundo = cor mediana da borda (ou transparente)
  const border = [];
  for (let x = 0; x < W; x++) { border.push(x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { border.push(y * W, y * W + W - 1); }
  const med = (k) => { const v = border.map(i => lab[i * 3 + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const bgTol = opts.bgTolerance ?? 18;
  const isFg = new Uint8Array(N);
  let fgCount = 0;
  for (let i = 0; i < N; i++) {
    if (alpha[i] < 128) continue;
    const d = Math.hypot(lab[i * 3] - bg[0], lab[i * 3 + 1] - bg[1], lab[i * 3 + 2] - bg[2]);
    if (d > bgTol) { isFg[i] = 1; fgCount++; }
  }
  // k-means em amostra
  const K = opts.k ?? 8;
  const sample = [];
  const step = Math.max(1, Math.floor(fgCount / 30000));
  let c = 0;
  for (let i = 0; i < N; i++) if (isFg[i] && (c++ % step === 0)) sample.push(i);
  if (!sample.length) return { labels: new Int8Array(N).fill(-1), colors: [], width: W, height: H, bg };
  let cent = [];
  // k-means++ simples
  cent.push([...lab.subarray(sample[0] * 3, sample[0] * 3 + 3)]);
  while (cent.length < Math.min(K, sample.length)) {
    let best = -1, bd = -1;
    for (let s = 0; s < sample.length; s += 7) {
      const p = lab.subarray(sample[s] * 3, sample[s] * 3 + 3);
      const d = Math.min(...cent.map(q => dE(p, q)));
      if (d > bd) { bd = d; best = sample[s]; }
    }
    cent.push([...lab.subarray(best * 3, best * 3 + 3)]);
  }
  const assign = new Int32Array(sample.length);
  for (let it = 0; it < 15; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    sample.forEach((i, s) => {
      const p = lab.subarray(i * 3, i * 3 + 3);
      let bi = 0, bd = Infinity;
      cent.forEach((q, k) => { const d = dE(p, q); if (d < bd) { bd = d; bi = k; } });
      assign[s] = bi; const S = sum[bi]; S[0] += p[0]; S[1] += p[1]; S[2] += p[2]; S[3]++;
    });
    cent = cent.map((q, k) => (sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : q));
  }
  // junta clusters parecidos (sombras/brilhos da mesma linha)
  const counts = cent.map(() => 0); assign.forEach(a => counts[a]++);
  let groups = cent.map((q, k) => ({ lab: q, n: counts[k], members: [k] })).filter(g => g.n > 0);
  const mergeTol = opts.mergeTolerance ?? 28;
  const dM = (p, q) => Math.hypot((p[0] - q[0]) * 0.4, p[1] - q[1], p[2] - q[2]);
  let merged = true;
  while (merged) {
    merged = false;
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const d = dM(groups[i].lab, groups[j].lab); if (d < bd) { bd = d; bi = i; bj = j; }
    }
    if (bd < mergeTol) {
      const A = groups[bi], B = groups[bj];
      const n = A.n + B.n;
      groups[bi] = { lab: A.lab.map((v, k) => (v * A.n + B.lab[k] * B.n) / n), n, members: A.members.concat(B.members) };
      groups.splice(bj, 1); merged = true;
    }
  }
  // remove cores muito pequenas
  const minShare = opts.minShare ?? 0.03;
  groups = groups.filter(g => g.n / sample.length >= minShare).sort((a, b) => b.n - a.n);
  // rotula todos os pixels (cor representativa = pixel real mais "saturado" típico -> usamos a média)
  const labels = new Int8Array(N).fill(-1);
  const glab = groups.map(g => g.lab);
  const centToGroup = cent.map(q => { let bi = 0, bd = Infinity; glab.forEach((g, k) => { const d = dE(q, g); if (d < bd) { bd = d; bi = k; } }); return bi; });
  for (let i = 0; i < N; i++) {
    if (!isFg[i]) continue;
    const p = lab.subarray(i * 3, i * 3 + 3);
    let bi = 0, bd = Infinity;
    cent.forEach((q, k) => { const d = dE(p, q); if (d < bd) { bd = d; bi = k; } });
    labels[i] = centToGroup[bi];
  }
  // cor RGB média real de cada grupo
  const acc = groups.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < N; i++) { const l = labels[i]; if (l < 0) continue; const A = acc[l]; A[0] += data[i * 4]; A[1] += data[i * 4 + 1]; A[2] += data[i * 4 + 2]; A[3]++; }
  const colors = groups.map((g, k) => ({
    rgb: acc[k][3] ? [Math.round(acc[k][0] / acc[k][3]), Math.round(acc[k][1] / acc[k][3]), Math.round(acc[k][2] / acc[k][3])] : [0, 0, 0],
    lab: g.lab, share: acc[k][3] / Math.max(1, fgCount),
  }));
  return { labels, colors, width: W, height: H, bg };
}

// ------------------------------------------------------------------ máscaras

function boxSum(src, W, H, r) {
  // soma em janela (2r+1)^2 via imagem integral
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += src[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      out[y * W + x] = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    }
  }
  return out;
}
function dilate(m, W, H, r) { const s = boxSum(m, W, H, r); const o = new Uint8Array(W * H); for (let i = 0; i < o.length; i++) o[i] = s[i] > 0 ? 1 : 0; return o; }
function erode(m, W, H, r) {
  const s = boxSum(m, W, H, r); const o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const full = (Math.min(H, y + r + 1) - Math.max(0, y - r)) * (Math.min(W, x + r + 1) - Math.max(0, x - r));
    o[y * W + x] = s[y * W + x] >= full - 0.5 ? 1 : 0;
  }
  return o;
}

/** Filtro de moda nos rótulos (tira textura de ponto/ruído) e gera uma máscara por cor. */
export function labelsToMasks(labels, W, H, nColors, smoothPx = 2) {
  const masks = [];
  const sums = [];
  for (let k = -1; k < nColors; k++) {
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) if (labels[i] === k) m[i] = 1;
    sums.push(boxSum(m, W, H, smoothPx));
  }
  const lab2 = new Int8Array(W * H);
  for (let i = 0; i < lab2.length; i++) {
    let bi = 0, bv = -1;
    for (let k = 0; k < sums.length; k++) if (sums[k][i] > bv) { bv = sums[k][i]; bi = k; }
    lab2[i] = bi - 1;
  }
  for (let k = 0; k < nColors; k++) {
    let m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) if (lab2[i] === k) m[i] = 1;
    // fecha frestas finas (ex.: pesponto decorativo) e abre pontinhos soltos
    m = erode(dilate(m, W, H, 1), W, H, 1);
    m = dilate(erode(m, W, H, 1), W, H, 1);
    masks.push(m);
  }
  return masks;
}

// ------------------------------------------------------------------ polígonos

function rdp(pts, eps) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    let bi = -1, bd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L;
      if (d > bd) { bd = d; bi = i; }
    }
    if (bd > eps && bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function rdpRing(r, eps) {
  let pts = r.slice();
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length < 4) return pts;
  let m = 0, bd = -1;
  pts.forEach((p, i) => { const d = (p[0] - pts[0][0]) ** 2 + (p[1] - pts[0][1]) ** 2; if (d > bd) { bd = d; m = i; } });
  const a = rdp(pts.slice(0, m + 1), eps), b = rdp(pts.slice(m).concat([pts[0]]), eps);
  return a.concat(b.slice(1, -1));
}

export function ringArea(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return a / 2; }

/** Máscara -> polígonos em mm: [{outer:[[x,y]..], holes:[[..]]}] */
export function maskToPolys(mask, W, H, pxPerMm, minAreaMm2 = 1.0) {
  // borra levemente para contornos suaves
  const vals = new Float64Array(W * H);
  const s = boxSum(mask, W, H, 1);
  for (let i = 0; i < vals.length; i++) vals[i] = s[i] / 9;
  const mp = contours().size([W, H]).smooth(true).thresholds([0.5])(vals)[0];
  const polys = [];
  for (const poly of mp.coordinates) {
    const rings = poly.map(r => rdpRing(r.map(([x, y]) => [x / pxPerMm, y / pxPerMm]), 0.04));
    const outer = rings[0];
    if (outer.length < 3 || Math.abs(ringArea(outer)) < minAreaMm2) continue;
    const holes = rings.slice(1).filter(h => h.length >= 3 && Math.abs(ringArea(h)) > 0.2);
    polys.push({ outer, holes });
  }
  return polys;
}

// --- Clipper helpers
const toPath = (r) => r.map(([x, y]) => ({ X: Math.round(x * CS), Y: Math.round(y * CS) }));
const fromPath = (p) => p.map(q => [q.X / CS, q.Y / CS]);
function polyToPaths(p) {
  const o = toPath(p.outer); if (!ClipperLib.Clipper.Orientation(o)) o.reverse();
  const hs = p.holes.map(h => { const q = toPath(h); if (ClipperLib.Clipper.Orientation(q)) q.reverse(); return q; });
  return [o, ...hs];
}
function treeToPolys(tree) {
  const out = [];
  const walk = (node) => {
    for (const ch of node.Childs()) {
      if (!ch.IsHole()) {
        out.push({ outer: fromPath(ch.Contour()), holes: ch.Childs().map(h => fromPath(h.Contour())) });
        for (const h of ch.Childs()) walk(h);
      }
    }
  };
  walk(tree);
  return out;
}
export function offsetPoly(p, d) {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * CS / 10);
  co.AddPaths(polyToPaths(p), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, d * CS);
  return treeToPolys(tree);
}
/** Expande só a borda externa (furos mantêm o tamanho). */
export function growOuter(p, d) {
  const g = offsetPoly({ outer: p.outer, holes: [] }, d);
  if (!g.length || !p.holes.length) return g;
  const c = new ClipperLib.Clipper();
  for (const q of g) c.AddPaths(polyToPaths(q), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(p.holes.map(h => toPath(h)), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctDifference, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return treeToPolys(tree);
}
export function clipRect(polys, x0, y0, x1, y1) {
  const c = new ClipperLib.Clipper();
  for (const p of polys) c.AddPaths(polyToPaths(p), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(toPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctIntersection, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return treeToPolys(tree);
}
export function polyArea(p) { return Math.abs(ringArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0); }
export function polyBounds(polys) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const p of polys) for (const [x, y] of p.outer) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
  return [l, t, r, b];
}
function rings(p) { return [p.outer, ...p.holes]; }
function pointInPoly(p, x, y) {
  let inside = false;
  for (const r of rings(p)) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segmentInside(p, a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(2, Math.ceil(L / 0.4));
  for (let i = 0; i <= n; i++) { const t = i / n; if (!pointInPoly(p, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; }
  return true;
}

function projectOnRing(r, p) {
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1]; const L2 = dx * dx + dy * dy || 1e-12;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
    const q = [a[0] + dx * t, a[1] + dy * t]; const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!best || d < best.d) best = { i, t, q, d };
  }
  return best;
}
/** Caminho de a até b andando pela borda interna da região (evita salto/corte). */
export function routeAlongEdge(regions, a, b, maxGap = 1.6) {
  let best = null;
  for (const reg of regions) for (const r of rings(reg)) {
    if (r.length < 3) continue;
    const A = projectOnRing(r, a), B = projectOnRing(r, b);
    if (A.d > maxGap || B.d > maxGap) continue;
    const n = r.length;
    const fwd = [A.q]; let i = A.i;
    if (!(A.i === B.i && B.t >= A.t)) { do { i = (i + 1) % n; fwd.push(r[i]); } while (i !== B.i); }
    fwd.push(B.q);
    const bwd = [A.q]; i = A.i;
    if (!(A.i === B.i && B.t <= A.t)) { bwd.push(r[i]); while (i !== (B.i + 1) % n) { i = (i - 1 + n) % n; bwd.push(r[i]); } }
    bwd.push(B.q);
    const len = (p) => p.reduce((s, q, k) => (k ? s + Math.hypot(q[0] - p[k - 1][0], q[1] - p[k - 1][1]) : 0), 0);
    const path = len(fwd) <= len(bwd) ? fwd : bwd;
    const L = len(path) + A.d + B.d;
    if (!best || L < best.L) best = { path, L };
  }
  return best;
}

/** Grafo de deslocamento por dentro de uma forma: bordas (anéis) + pontes retas entre anéis. */
function buildTravelGraph(reg) {
  const rs = rings(reg).filter(r => r.length >= 3);
  const nodes = [], adj = [], ringStart = [];
  const add = (p) => { nodes.push(p); adj.push([]); return nodes.length - 1; };
  const link = (i, j) => { const w = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]); adj[i].push([j, w]); adj[j].push([i, w]); };
  rs.forEach(r => {
    const s0 = nodes.length; ringStart.push(s0);
    r.forEach(p => add(p));
    for (let k = 0; k < r.length; k++) link(s0 + k, s0 + (k + 1) % r.length);
  });
  // pontes: para cada par de anéis, alguns pares de pontos próximos ligados em linha reta por dentro
  for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
    const cand = [];
    const stepA = Math.max(1, Math.floor(rs[a].length / 150)), stepB = Math.max(1, Math.floor(rs[b].length / 150));
    for (let i = 0; i < rs[a].length; i += stepA) for (let j = 0; j < rs[b].length; j += stepB) {
      const d = Math.hypot(rs[a][i][0] - rs[b][j][0], rs[a][i][1] - rs[b][j][1]);
      if (d < 8) cand.push([d, i, j]);
    }
    cand.sort((x, y) => x[0] - y[0]);
    let made = 0;
    for (const [, i, j] of cand) {
      if (made >= 4) break;
      const A = rs[a][i], B = rs[b][j];
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      if (!pointInPoly(reg, mid[0], mid[1])) continue;
      if (!segmentInside(reg, [A[0] + (B[0] - A[0]) * 0.05, A[1] + (B[1] - A[1]) * 0.05], [B[0] - (B[0] - A[0]) * 0.05, B[1] - (B[1] - A[1]) * 0.05])) continue;
      link(ringStart[a] + i, ringStart[b] + j); made++;
    }
  }
  return { reg, rs, nodes, adj, ringStart };
}
let travelGap = 1.6;
function routeGraph(G, a, b, maxGap = travelGap) {
  // conecta a e b ao anel mais próximo (projeção)
  const attach = (p) => {
    let best = null;
    G.rs.forEach((r, k) => { const pr = projectOnRing(r, p); if (pr.d <= maxGap && (!best || pr.d < best.d)) best = { ...pr, k }; });
    return best;
  };
  const A = attach(a), B = attach(b);
  if (!A || !B) return null;
  const N = G.nodes.length;
  const ia = G.ringStart[A.k] + A.i, ia2 = G.ringStart[A.k] + (A.i + 1) % G.rs[A.k].length;
  const ib = G.ringStart[B.k] + B.i, ib2 = G.ringStart[B.k] + (B.i + 1) % G.rs[B.k].length;
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const heap = [];
  const push = (d, i) => { heap.push([d, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  for (const i of [ia, ia2]) { const d = Math.hypot(G.nodes[i][0] - A.q[0], G.nodes[i][1] - A.q[1]); if (d < dist[i]) { dist[i] = d; push(d, i); } }
  const targets = new Set([ib, ib2]);
  let end = -1;
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    if (targets.has(i)) { end = i; break; }
    if (d > 200) break;
    for (const [j, w] of G.adj[i]) if (d + w < dist[j]) { dist[j] = d + w; prev[j] = i; push(d + w, j); }
  }
  if (end < 0) return null;
  const path = [];
  for (let i = end; i >= 0; i = prev[i]) path.push(G.nodes[i]);
  path.reverse();
  const pts = [A.q, ...path, B.q];
  const L = pts.reduce((s, q, k) => (k ? s + Math.hypot(q[0] - pts[k - 1][0], q[1] - pts[k - 1][1]) : 0), 0);
  return { path: pts, L };
}

// ------------------------------------------------------------------ preenchimento

function rotPt([x, y], c, s, cx, cy) { const dx = x - cx, dy = y - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; }

function rowSegments(rs, y) {
  const xs = [];
  for (const r of rs) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [x1, y1] = r[j], [x2, y2] = r[i];
    if ((y1 > y) !== (y2 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
  }
  xs.sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.05) segs.push([xs[i], xs[i + 1]]);
  return segs;
}

/** Tatami: retorna caminhos (listas de pontos em mm). */
export function fillPaths(p, angleDeg, spacing, stitchLen, stagger = true) {
  const [l, t, r, b] = polyBounds([p]);
  const cx = (l + r) / 2, cy = (t + b) / 2;
  const a = -angleDeg * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const rr = rings(p).map(ring => ring.map(q => rotPt(q, c, s, cx, cy)));
  let ymin = Infinity, ymax = -Infinity;
  for (const ring of rr) for (const [, y] of ring) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const rows = [];
  for (let y = ymin + spacing / 2; y < ymax; y += spacing) rows.push([y, rowSegments(rr, y)]);
  // cadeias monotônicas
  const used = rows.map(r => r[1].map(() => false));
  const paths = [];
  const ci = Math.cos(-a), si = Math.sin(-a);
  for (let ri = 0; ri < rows.length; ri++) for (let si0 = 0; si0 < rows[ri][1].length; si0++) {
    if (used[ri][si0]) continue;
    const chain = [[rows[ri][0], rows[ri][1][si0]]]; used[ri][si0] = true;
    let cur = rows[ri][1][si0];
    for (let rj = ri + 1; rj < rows.length; rj++) {
      const k = rows[rj][1].findIndex((sg, k2) => !used[rj][k2] && sg[0] <= cur[1] && sg[1] >= cur[0]);
      if (k < 0) break;
      used[rj][k] = true; cur = rows[rj][1][k]; chain.push([rows[rj][0], cur]);
    }
    const pts = [];
    chain.forEach(([y, [x0, x1]], k) => {
      const [A, B] = k % 2 === 0 ? [x0, x1] : [x1, x0];
      pts.push([A, y]);
      const d = B > A ? 1 : -1;
      if (Math.abs(B - A) > stitchLen) {
        if (stagger) {
          const off = ((k * 3) % 5) / 5 * stitchLen;
          let x = A + d * (off > 0.6 ? off : off + stitchLen);
          while ((B - x) * d > 0.6) { pts.push([x, y]); x += d * stitchLen; }
        } else {
          const n = Math.ceil(Math.abs(B - A) / stitchLen);
          for (let i = 1; i < n; i++) pts.push([A + (B - A) * i / n, y]);
        }
      }
      pts.push([B, y]);
    });
    paths.push(pts.map(q => rotPt(q, ci, si, cx, cy)));
  }
  return paths;
}

function outlinePaths(p, stitchLen) {
  return rings(p).map(r => {
    const out = []; const ring = r.concat([r[0]]);
    for (let i = 0; i + 1 < ring.length; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      const L = Math.hypot(x2 - x1, y2 - y1); const n = Math.max(1, Math.round(L / stitchLen));
      for (let k = 0; k < n; k++) out.push([x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n]);
    }
    out.push(ring[ring.length - 1]);
    return out;
  });
}

// ------------------------------------------------------------------ montagem

/**
 * layers: [{polys, thread:{r,g,b,name}, angle}]
 * fabric: {density, fillStitch, maxStitch, underlaySpacing, underlayInset, pullComp, edgeRun}
 * Retorna {stitches:[[x,y,cmd]] em 0,1 mm centralizados, threads, stats, bounds(mm, antes de centralizar)}
 */
export function buildStitches(layers, fabric) {
  const out = []; // [x,y,cmd] em mm
  let pos = null;
  const threads = [];
  const stats = [];
  const tieLen = 0.4;
  const tie = (p, q) => { // pontos de amarração em p na direção de q
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const u = [(q[0] - p[0]) / L * tieLen, (q[1] - p[1]) / L * tieLen];
    out.push([p[0] + u[0], p[1] + u[1], STITCH], [p[0], p[1], STITCH], [p[0] + u[0], p[1] + u[1], STITCH], [p[0], p[1], STITCH]);
  };
  const tieOff = () => {
    if (!pos || out.length < 2) return;
    const prev = out[out.length - 2];
    tie(pos, [prev[0], prev[1]]);
  };
  const walk = (pts) => { // pontos de deslocamento (corridos) seguindo pts
    let cur = pos;
    for (const q of pts) {
      const d = Math.hypot(q[0] - cur[0], q[1] - cur[1]);
      if (d < 0.2) continue;
      const n = Math.max(1, Math.ceil(d / 2.5));
      for (let i = 1; i <= n; i++) out.push([cur[0] + (q[0] - cur[0]) * i / n, cur[1] + (q[1] - cur[1]) * i / n, STITCH]);
      cur = q;
    }
    pos = cur;
  };
  let travelGraphs = null, travelEdgeGraph = null; // região da forma atual (encolhida), para andar por dentro
  const emit = (path, inside) => {
    if (path.length < 2) return;
    const p0 = path[0];
    if (!pos) { out.push([p0[0], p0[1], JUMP]); tie(p0, path[1]); }
    else {
      const d = Math.hypot(p0[0] - pos[0], p0[1] - pos[1]);
      if (d > 0.5) {
        let route = null;
        const okIn = inside && (typeof inside === 'function' ? d < 14 && inside(pos, p0) : d < 6 && segmentInside(inside, pos, p0));
        if (okIn) route = [p0];
        else if (travelGraphs) {
          let r = null;
          for (const G of travelGraphs) { const q = routeGraph(G, pos, p0); if (q && (!r || q.L < r.L)) r = q; }
          if (!r && travelEdgeGraph) r = routeGraph(travelEdgeGraph, pos, p0, 2.2);
          if (r && r.L < 200) route = r.path.concat([p0]);
        }
        if (route) walk(route);
        else { tieOff(); out.push([p0[0], p0[1], JUMP]); tie(p0, path[1]); }
      }
    }
    let last = p0;
    for (let i = 1; i < path.length; i++) {
      const q = path[i];
      const L = Math.hypot(q[0] - last[0], q[1] - last[1]);
      if (L < 0.3 && i < path.length - 1) continue;
      const m = Math.floor(L / fabric.maxStitch);
      for (let k = 1; k <= m; k++) out.push([last[0] + (q[0] - last[0]) * k / (m + 1), last[1] + (q[1] - last[1]) * k / (m + 1), STITCH]);
      out.push([q[0], q[1], STITCH]);
      last = q;
    }
    pos = last;
  };
  const orderPolys = (polys) => {
    const rest = polys.slice(); const res = [];
    let cur = pos || [0, 0];
    while (rest.length) {
      let bi = 0, bd = Infinity;
      rest.forEach((p, k) => { for (const q of p.outer) { const d = (q[0] - cur[0]) ** 2 + (q[1] - cur[1]) ** 2; if (d < bd) { bd = d; bi = k; } } });
      const p = rest.splice(bi, 1)[0]; res.push(p);
      const [l, t, r, b] = polyBounds([p]); cur = [(l + r) / 2, (t + b) / 2];
    }
    return res;
  };

  const active = layers.filter(L => (L.fillPolys ?? L.polys).length || (L.satin || []).length);
  active.forEach((L, li) => {
    if (li > 0) { tieOff(); out.push([pos[0], pos[1], COLOR_CHANGE]); }
    threads.push(L.thread);
    const n0 = out.length;
    const ang = L.angle ?? 45;
    for (const poly of orderPolys(L.fillPolys ?? L.polys)) {
      const safe = offsetPoly(poly, -0.2)[0] || poly;
      const tr = offsetPoly(poly, -0.3);
      travelGraphs = (tr.length ? tr : [poly]).map(buildTravelGraph);
      travelEdgeGraph = buildTravelGraph(poly);
      // 1) base
      for (const u of offsetPoly(poly, -fabric.underlayInset)) {
        if (polyArea(u) < 1.0) continue;
        emit(outlinePaths(u, 2.5)[0], safe);
        for (const pth of fillPaths(u, ang + 90, fabric.underlaySpacing, 3.0, false)) emit(pth, safe);
      }
      // 2) preenchimento
      const tops = growOuter(poly, fabric.pullComp);
      const loose = offsetPoly(poly, 0.3)[0] || poly;
      for (const tp of tops) for (const pth of fillPaths(tp, ang, fabric.density, fabric.fillStitch)) emit(pth, loose);
      // 3) contorno de acabamento
      if (fabric.edgeRun) for (const tp of tops) for (const e of offsetPoly(tp, -0.15)) for (const pth of outlinePaths(e, 2.0)) emit(pth, offsetPoly(poly, 0.5)[0] || poly);
    }
    // 4) ponto cheio (satin) nos traços finos
    if (L.satin && L.satin.length) {
      travelGap = 3.2;
      travelGraphs = L.polys.map(p => { const o = offsetPoly(p, -0.3); return o.length ? o : [p]; }).flat().map(buildTravelGraph);
      travelEdgeGraph = null;
      const comp = fabric.satinComp ?? 0.15, sp = fabric.satinSpacing ?? 0.42;
      const inside = L.inMask ? (a, b) => { const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.4)); for (let i = 0; i <= n; i++) if (!L.inMask(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)) return false; return true; } : null;
      const rest = L.satin.slice();
      const first = (c, rev) => { const q = rev ? c.s[c.s.length - 1] : c.s[0]; return [q.x, q.y]; };
      while (rest.length) {
        const cur = pos || [0, 0];
        let bi = 0, br = false, bd = Infinity;
        rest.forEach((c, k) => [false, true].forEach(rev => { const f = first(c, rev), d = (f[0] - cur[0]) ** 2 + (f[1] - cur[1]) ** 2; if (d < bd) { bd = d; bi = k; br = rev; } }));
        const col = rest.splice(bi, 1)[0];
        const S = br ? col.s.slice().reverse() : col.s;
        const left = (q, e = comp) => [q.x + q.nx * (q.hl + e), q.y + q.ny * (q.hl + e)];
        const right = (q, e = comp) => [q.x - q.nx * (q.hr + e), q.y - q.ny * (q.hr + e)];
        const everyK = Math.max(1, Math.round(2.5 / sp));
        const center = S.filter((_, i) => i % everyK === 0 || i === S.length - 1).map(q => [q.x, q.y]);
        if (col.w < 1.1) { emit(center, inside); emit(center.slice().reverse(), inside); continue; }
        emit(center, inside);                       // base: linha central
        if (col.w > 3.5) {                          // colunas largas: zigue-zague de base
          const k2 = Math.max(1, Math.round(1.5 / sp)); const zz = [];
          S.forEach((q, i) => { if (i % k2) return; const side = (i / k2) % 2 === 0; const p = side ? left(q, -0.5) : right(q, -0.5); zz.push(p); });
          emit(zz, inside);
        }
        const zig = S.slice().reverse().map((q, i) => (i % 2 === 0 ? left(q) : right(q)));
        emit(zig, inside);                          // ponto cheio, de volta ao começo
      }
    }
    travelGap = 1.6;
    stats.push({ name: L.thread.name, stitches: out.slice(n0).filter(s => s[2] === STITCH).length, shapes: (L.fillPolys ?? L.polys).length, satin: (L.satin || []).length });
  });
  if (pos) { tieOff(); out.push([pos[0], pos[1], END]); }
  // centraliza
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const [x, y] of out) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
  const cx = (l + r) / 2, cy = (t + b) / 2;
  const st = out.map(([x, y, c]) => [Math.round((x - cx) * 10), Math.round((y - cy) * 10), c]);
  const nSt = st.filter(s => s[2] === STITCH).length;
  const nJ = st.filter(s => s[2] === JUMP).length - 1;
  return {
    stitches: st, threads, stats,
    bounds: [l, t, r, b], center: [cx, cy],
    size: [r - l, b - t], count: nSt, trims: Math.max(0, nJ),
    minutes: nSt / 550 + Math.max(0, nJ) * 0.06 + (threads.length - 1) * 0.5,
  };
}

// ------------------------------------------------------------------ divisão em partes

/**
 * Escolhe cortes verticais para que cada parte tenha largura <= maxW.
 * colInk: tinta por coluna (mm), dados como array de {x, ink}. Retorna lista de x de corte.
 */
export function chooseCuts(layersPolys, maxW, overlap = 1.5) {
  const all = layersPolys.flat();
  const [l, , r] = polyBounds(all);
  const W = r - l;
  if (W <= maxW) return [];
  // perfil de tinta (comprimento vertical coberto) por coluna a cada 0.25 mm
  const stepMm = 0.25;
  const n = Math.ceil(W / stepMm) + 1;
  const ink = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = l + i * stepMm;
    let s = 0;
    for (const p of all) {
      const xs = [];
      for (const ring of rings(p)) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [x1, y1] = ring[b], [x2, y2] = ring[a];
        if ((x1 > x) !== (x2 > x)) xs.push(y1 + (x - x1) * (y2 - y1) / (x2 - x1));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) s += xs[k + 1] - xs[k];
    }
    ink[i] = s;
  }
  const cuts = [];
  let start = l;
  const parts = Math.ceil(W / (maxW - overlap));
  for (let k = 1; k < parts; k++) {
    const ideal = l + (W * k) / parts;
    const lo = Math.max(start + maxW * 0.4, ideal - maxW * 0.35);
    const hi = Math.min(start + maxW - overlap, ideal + maxW * 0.35);
    let best = Math.min(hi, ideal), bs = Infinity;
    for (let x = lo; x <= hi; x += stepMm) {
      const i = Math.round((x - l) / stepMm);
      const score = ink[i] * 10 + Math.abs(x - ideal) * 0.05; // prefere colunas vazias perto do ideal
      if (score < bs) { bs = score; best = x; }
    }
    cuts.push({ x: best, inked: ink[Math.round((best - l) / stepMm)] > 0.05 });
    start = best;
  }
  // garante que a última parte caiba
  if (r - start > maxW) return null;
  return cuts;
}

/**
 * Rotula pixels usando cores já escolhidas (cada cor -> grupo/camada).
 * colors: [{lab, group}] (group = -1 para "não bordar"). Retorna Int8Array de grupos (-1 = fundo).
 */
export function labelWithPalette(img, colors, bgLab, bgTol = 18) {
  const { width: W, height: H, data } = img;
  const N = W * H, out = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const p = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    if (dE(p, bgLab) <= bgTol) continue;
    let bi = -1, bd = Infinity;
    for (const c of colors) { const d = dE(p, c.lab); if (d < bd) { bd = d; bi = c.group; } }
    out[i] = bi;
  }
  return out;
}

/** Fração da tinta que sobra após "afinar" r px — mede se há traços finos demais. */
export function thickFraction(mask, W, H, r) {
  let a = 0, b = 0; const e = erode(mask, W, H, r);
  for (let i = 0; i < mask.length; i++) { a += mask[i]; b += e[i]; }
  return a ? b / a : 1;
}

// ================================================================== PONTO CHEIO (SATIN)
const BIG = 1e12;
function edt1d(f, d, v, z, n) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
/** distância² de cada pixel até a semente (seed=1) mais próxima */
function sqdist(seed, W, H) {
  const N = W * H, g = new Float64Array(N);
  for (let i = 0; i < N; i++) g[i] = seed[i] ? 0 : BIG;
  const m = Math.max(W, H) + 1;
  const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; edt1d(f, d, v, z, H); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; edt1d(f, d, v, z, W); for (let x = 0; x < W; x++) g[y * W + x] = d[x]; }
  return Float32Array.from(g);
}
function distInside(mask, W, H) {
  const seed = new Uint8Array(W * H);
  for (let i = 0; i < seed.length; i++) seed[i] = mask[i] ? 0 : 1;
  const d = sqdist(seed, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const b = Math.min(x + 1, W - x, y + 1, H - y); if (b * b < d[y * W + x]) d[y * W + x] = b * b; }
  return d;
}
/** abertura por disco: união de todos os discos de raio r que cabem dentro da máscara */
function discOpen(mask, W, H, r) {
  const d = distInside(mask, W, H), r2 = r * r, core = new Uint8Array(W * H);
  let any = false;
  for (let i = 0; i < core.length; i++) if (mask[i] && d[i] >= r2) { core[i] = 1; any = true; }
  const out = new Uint8Array(W * H);
  if (!any) return out;
  const d2 = sqdist(core, W, H);
  for (let i = 0; i < out.length; i++) if (mask[i] && d2[i] <= r2) out[i] = 1;
  return out;
}
function components(mask, W, H) {
  const N = W * H, label = new Int32Array(N), areas = [0], stack = new Int32Array(N);
  let n = 0;
  for (let s = 0; s < N; s++) {
    if (!mask[s] || label[s]) continue;
    n++; let sp = 0, area = 0; stack[sp++] = s; label[s] = n;
    while (sp) {
      const i = stack[--sp]; area++;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx; if (mask[j] && !label[j]) { label[j] = n; stack[sp++] = j; }
      }
    }
    areas.push(area);
  }
  return { label, areas };
}

/** Separa a máscara de uma cor em "grosso" (preenchimento) e "fino" (ponto cheio).
 *  Cruzamentos/ramificações dos traços finos também viram preenchimento: o satin fica só em traços simples. */
export function splitLayerMask(mask, W, H, ppm, o) {
  const thick0 = discOpen(mask, W, H, (o.satinMax / 2) * ppm);
  const thin0 = new Uint8Array(W * H);
  for (let i = 0; i < thin0.length; i++) thin0[i] = mask[i] && !thick0[i] ? 1 : 0;
  const thinO = discOpen(thin0, W, H, Math.max(1, 0.35 * ppm));
  // cruzamentos: esqueleto -> pontos com 3+ vizinhos -> discos que viram preenchimento
  const dIn = distInside(thinO, W, H);
  const skel = zsThin(thinO, W, H);
  pruneSpurs(skel, W, H, dIn, ppm);
  const { deg } = tracePaths(skel, W, H);
  const blob = new Uint8Array(W * H);
  for (let i = 0; i < deg.length; i++) {
    if (deg[i] < 3) continue;
    const r = Math.sqrt(dIn[i]) * 1.7 + 0.7 * ppm, cx = i % W, cy = (i / W) | 0, R = Math.ceil(r);
    for (let y = Math.max(0, cy - R); y <= Math.min(H - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(W - 1, cx + R); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) blob[y * W + x] = 1;
  }
  const thin1 = new Uint8Array(W * H);
  for (let i = 0; i < thin1.length; i++) thin1[i] = thinO[i] && !blob[i] ? 1 : 0;
  const { label, areas } = components(thin1, W, H);
  const minA = (o.minThinArea ?? 3) * ppm * ppm;
  const d1 = distInside(thin1, W, H), rmax = new Float32Array(areas.length);
  for (let i = 0; i < thin1.length; i++) if (label[i] && d1[i] > rmax[label[i]]) rmax[label[i]] = d1[i];
  // só vale satin em traços ALONGADOS (comprimento >= ~3x a largura); formas curtas/redondas (pingo do i) ficam como preenchimento
  const ok = areas.map((a, k) => k > 0 && a >= minA && a / (4 * rmax[k]) >= 3.5 * 1.0);
  const thin = new Uint8Array(W * H), thick = new Uint8Array(W * H);
  for (let i = 0; i < thin.length; i++) if (label[i] && ok[label[i]]) thin[i] = 1;
  for (let i = 0; i < thick.length; i++) thick[i] = mask[i] && !thin[i] ? 1 : 0;
  return { thick, thin };
}

function zsThin(mask, W, H) {
  const img = Uint8Array.from(mask), del = [];
  let y0 = H, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (img[y * W + x]) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  y0 = Math.max(1, y0); y1 = Math.min(H - 2, y1);
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = y0; y <= y1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x; if (!img[i]) continue;
        const p2 = img[i - W], p3 = img[i - W + 1], p4 = img[i + 1], p5 = img[i + W + 1], p6 = img[i + W], p7 = img[i + W - 1], p8 = img[i - 1], p9 = img[i - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (pass === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; } else { if (p2 * p4 * p8 || p2 * p6 * p8) continue; }
        del.push(i);
      }
      if (del.length) { changed = true; for (const i of del) img[i] = 0; }
    }
  }
  return img;
}

function tracePaths(skel, W, H) {
  const N = W * H, px = [];
  for (let i = 0; i < N; i++) if (skel[i]) px.push(i);
  const nbrs = (i) => {
    const x = i % W, y = (i / W) | 0, r = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if (skel[yy * W + xx]) r.push(yy * W + xx);
    }
    return r;
  };
  const deg = new Uint8Array(N);
  for (const i of px) deg[i] = nbrs(i).length;
  const seen = new Set(), touched = new Uint8Array(N), paths = [];
  const ek = (a, b) => (a < b ? a * N + b : b * N + a);
  for (const i of px) {
    if (deg[i] === 2) continue;
    for (const j of nbrs(i)) {
      if (seen.has(ek(i, j))) continue;
      seen.add(ek(i, j));
      const path = [i, j]; let prev = i, cur = j;
      while (deg[cur] === 2) {
        const ns = nbrs(cur); const nx = ns[0] === prev ? ns[1] : ns[0];
        if (nx === undefined || seen.has(ek(cur, nx))) break;
        seen.add(ek(cur, nx)); path.push(nx); prev = cur; cur = nx;
      }
      for (const p of path) touched[p] = 1;
      paths.push(path);
    }
  }
  for (const i of px) { // laços sem nó
    if (touched[i]) continue;
    const path = [i]; touched[i] = 1;
    let prev = i, cur = nbrs(i)[0];
    while (cur !== undefined && cur !== i && !touched[cur]) {
      path.push(cur); touched[cur] = 1;
      const ns = nbrs(cur); const nx = ns[0] === prev ? ns[1] : ns[0]; prev = cur; cur = nx;
    }
    if (path.length > 3) { path.push(i); paths.push(path); }
  }
  return { paths, deg };
}
function pruneSpurs(skel, W, H, dIn, ppm) {
  for (let it = 0; it < 3; it++) {
    const { paths, deg } = tracePaths(skel, W, H);
    let removed = 0;
    for (const p of paths) {
      const a = deg[p[0]], b = deg[p[p.length - 1]];
      if ((a === 1) === (b === 1)) continue;
      const jn = a === 1 ? p.length - 1 : 0;
      if (deg[p[jn]] < 3) continue;
      if (p.length < Math.max(Math.sqrt(dIn[p[jn]]), 0.8 * ppm)) { for (let k = 0; k < p.length; k++) if (k !== jn) skel[p[k]] = 0; removed++; }
    }
    if (!removed) break;
  }
}
const inPx = (m, W, H, x, y) => x >= 0 && y >= 0 && x < W && y < H && m[(y | 0) * W + (x | 0)] === 1;
function smoothPts(pts, k) {
  const n = pts.length; if (n < 3 || k < 1) return pts;
  return pts.map((p, i) => { const h = Math.min(k, i, n - 1 - i); let sx = 0, sy = 0; for (let j = i - h; j <= i + h; j++) { sx += pts[j][0]; sy += pts[j][1]; } const m = 2 * h + 1; return [sx / m, sy / m]; });
}
function resamplePts(pts, step) {
  const n = pts.length, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[n - 1], m = Math.max(1, Math.round(L / step)), out = [];
  let j = 0;
  for (let k = 0; k <= m; k++) {
    const t = L * k / m; while (j < n - 2 && cum[j + 1] < t) j++;
    const seg = cum[j + 1] - cum[j] || 1, u = (t - cum[j]) / seg;
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]);
  }
  return out;
}
function extendEnd(pts, atStart, ray, W, H, cap) {
  const n = pts.length, a = atStart ? pts[0] : pts[n - 1], b = atStart ? pts[Math.min(n - 1, 4)] : pts[Math.max(0, n - 5)];
  let tx = a[0] - b[0], ty = a[1] - b[1]; const L = Math.hypot(tx, ty); if (L < 1e-6) return;
  tx /= L; ty /= L; let last = a;
  for (let s = 0.5; s <= cap; s += 0.5) { const x = a[0] + tx * s, y = a[1] + ty * s; if (!inPx(ray, W, H, x, y)) break; last = [x, y]; }
  if (last !== a) { if (atStart) pts.unshift(last); else pts.push(last); }
}
const med5 = (a) => a.map((_, i) => { const w = []; for (let k = -2; k <= 2; k++) w.push(a[Math.min(a.length - 1, Math.max(0, i + k))]); w.sort((x, y) => x - y); return w[2]; });

/** Colunas de ponto cheio ao longo do esqueleto de cada traço fino. Coordenadas em mm. */
export function satinColumns(thin, W, H, ppm, o) {
  const dIn = distInside(thin, W, H);
  const skel = zsThin(thin, W, H);
  pruneSpurs(skel, W, H, dIn, ppm);
  const { paths } = tracePaths(skel, W, H);
  const ray = new Uint8Array(W * H), sm = boxSum(thin, W, H, 1);
  for (let i = 0; i < ray.length; i++) ray[i] = sm[i] > 0 ? 1 : 0;
  const cols = [], cap = o.satinMax * ppm * 0.6, step = o.spacing * ppm;
  for (const path of paths) {
    if (path.length < 3) continue;
    let pts = path.map(i => [i % W + 0.5, ((i / W) | 0) + 0.5]);
    pts = smoothPts(pts, Math.round(0.9 * ppm));
    const ecap = Math.sqrt(dIn[path[0]] || 1) * 1.3 + 2, ecap2 = Math.sqrt(dIn[path[path.length - 1]] || 1) * 1.3 + 2;
    extendEnd(pts, true, ray, W, H, ecap); extendEnd(pts, false, ray, W, H, ecap2);
    const S = resamplePts(pts, step); if (S.length < 3) continue;
    const m = S.length, hl = [], hr = [], nn = [];
    for (let i = 0; i < m; i++) {
      const a = S[Math.max(0, i - 3)], b = S[Math.min(m - 1, i + 3)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      const nx = -ty, ny = tx; nn.push([nx, ny]);
      const march = (sg) => { let s = 0; while (s < cap && inPx(ray, W, H, S[i][0] + sg * nx * (s + 0.5), S[i][1] + sg * ny * (s + 0.5))) s += 0.5; return s; };
      hl.push(march(1)); hr.push(march(-1));
    }
    const HL = med5(hl), HR = med5(hr);
    const s = S.map((p, i) => ({ x: p[0] / ppm, y: p[1] / ppm, nx: nn[i][0], ny: nn[i][1], hl: Math.max(0.2, HL[i] / ppm), hr: Math.max(0.2, HR[i] / ppm) }));
    const w = s.reduce((a, q) => a + q.hl + q.hr, 0) / s.length;
    cols.push({ s, w, len: (m - 1) * o.spacing });
  }
  return cols;
}

/** Monta as camadas (preenchimento + ponto cheio) a partir da máscara de uma cor. */
export function layerGeometry(mask, W, H, ppm, fab) {
  const polys = maskToPolys(mask, W, H, ppm, 0.8);
  const inMask = (x, y) => { const px = Math.floor(x * ppm), py = Math.floor(y * ppm); return px >= 0 && py >= 0 && px < W && py < H && mask[py * W + px] === 1; };
  if (!fab.satin) return { polys, fillPolys: polys, satin: [], inMask };
  const { thick, thin } = splitLayerMask(mask, W, H, ppm, { satinMax: fab.satinMax, minThinArea: 3 });
  const fillPolys = maskToPolys(thick, W, H, ppm, 0.8);
  const satin = satinColumns(thin, W, H, ppm, { satinMax: fab.satinMax, spacing: fab.satinSpacing });
  return { polys, fillPolys, satin, inMask };
}
/** Recorta colunas de satin a uma faixa vertical [x0,x1] (mm) para dividir em partes. */
export function clipSatin(cols, x0, x1) {
  const out = [];
  for (const c of cols) {
    let run = [];
    const flush = () => { if (run.length >= 3) out.push({ s: run, w: c.w, len: c.len }); run = []; };
    for (const q of c.s) { if (q.x >= x0 && q.x <= x1) run.push(q); else flush(); }
    flush();
  }
  return out;
}
