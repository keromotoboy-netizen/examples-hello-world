// Gravador PES v1 (Brother) — portado da pyembroidery (MIT).
// stitches: array de [x, y, cmd] em unidades de 0,1 mm (inteiros), já "normalizados":
//   cmd: STITCH | JUMP | COLOR_CHANGE | END. Todo JUMP depois do primeiro vira "corte + salto" no PEC.
// threads: array de {r,g,b,name}

export const STITCH = 0, JUMP = 1, TRIM = 2, COLOR_CHANGE = 5, END = 4;

const PEC_PALETTE = [null,
  [14,31,124,"Prussian Blue"],[10,85,163,"Blue"],[0,135,119,"Teal Green"],[75,107,175,"Cornflower Blue"],
  [237,23,31,"Red"],[209,92,0,"Reddish Brown"],[145,54,151,"Magenta"],[228,154,203,"Light Lilac"],
  [145,95,172,"Lilac"],[158,214,125,"Mint Green"],[232,169,0,"Deep Gold"],[254,186,53,"Orange"],
  [255,255,0,"Yellow"],[112,188,31,"Lime Green"],[186,152,0,"Brass"],[168,168,168,"Silver"],
  [125,111,0,"Russet Brown"],[255,255,179,"Cream Brown"],[79,85,86,"Pewter"],[0,0,0,"Black"],
  [11,61,145,"Ultramarine"],[119,1,118,"Royal Purple"],[41,49,51,"Dark Gray"],[42,19,1,"Dark Brown"],
  [246,74,138,"Deep Rose"],[178,118,36,"Light Brown"],[252,187,197,"Salmon Pink"],[254,55,15,"Vermilion"],
  [240,240,240,"White"],[106,28,138,"Violet"],[168,221,196,"Seacrest"],[37,132,187,"Sky Blue"],
  [254,179,67,"Pumpkin"],[255,243,107,"Cream Yellow"],[208,166,96,"Khaki"],[209,84,0,"Clay Brown"],
  [102,186,73,"Leaf Green"],[19,74,70,"Peacock Blue"],[135,135,135,"Gray"],[216,204,198,"Warm Gray"],
  [67,86,7,"Dark Olive"],[253,217,222,"Flesh Pink"],[249,147,188,"Pink"],[0,56,34,"Deep Green"],
  [178,175,212,"Lavender"],[104,106,176,"Wisteria Violet"],[239,227,185,"Beige"],[247,56,102,"Carmine"],
  [181,75,100,"Amber Red"],[19,43,26,"Olive Green"],[199,1,86,"Dark Fuchsia"],[254,158,50,"Tangerine"],
  [168,222,235,"Light Blue"],[0,103,62,"Emerald Green"],[78,41,144,"Purple"],[47,126,32,"Moss Green"],
  [255,204,204,"Flesh Pink"],[255,217,17,"Harvest Gold"],[9,91,166,"Electric Blue"],[240,249,112,"Lemon Yellow"],
  [227,243,91,"Fresh Green"],[255,153,0,"Orange"],[255,240,141,"Cream Yellow"],[255,200,200,"Applique"]];
export const BROTHER_PALETTE = PEC_PALETTE;

function colorDist(r1, g1, b1, r2, g2, b2) {
  const rm = Math.round((r1 + r2) / 2);
  const r = r1 - r2, g = g1 - g2, b = b1 - b2;
  return (((512 + rm) * r * r) >> 8) + 4 * g * g + (((767 - rm) * b * b) >> 8);
}
export function nearestIndex(t, values) {
  let best = null, bd = Infinity;
  values.forEach((v, i) => {
    if (!v) return;
    const d = colorDist(t.r, t.g, t.b, v[0], v[1], v[2]);
    if (d <= bd) { bd = d; best = i; }
  });
  return best;
}

class Buf {
  constructor() { this.a = new Uint8Array(1 << 16); this.n = 0; }
  grow(k) { if (this.n + k > this.a.length) { const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; } }
  u8(v) { this.grow(1); this.a[this.n++] = v & 255; }
  bytes(arr) { for (const v of arr) this.u8(v); }
  str(s) { this.bytes(new TextEncoder().encode(s)); }
  i16(v) { this.u8(v); this.u8(v >> 8); }
  i24(v) { this.u8(v); this.u8(v >> 8); this.u8(v >> 16); }
  i32(v) { this.u8(v); this.u8(v >> 8); this.u8(v >> 16); this.u8(v >> 24); }
  f32(v) { const b = new Uint8Array(new Float32Array([v]).buffer); this.bytes(b); }
  put16(pos, v) { this.a[pos] = v & 255; this.a[pos + 1] = (v >> 8) & 255; }
  put24(pos, v) { this.a[pos] = v & 255; this.a[pos + 1] = (v >> 8) & 255; this.a[pos + 2] = (v >> 16) & 255; }
  put32(pos, v) { this.put24(pos, v); this.a[pos + 3] = (v >> 24) & 255; }
  out() { return this.a.slice(0, this.n); }
}

function bounds(st) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const [x, y, c] of st) {
    if (c === END) continue;
    if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
  }
  if (l === Infinity) return [0, 0, 0, 0];
  return [l, t, r, b];
}

function commandBlocks(st) {
  const out = []; let last = -1, start = 0;
  st.forEach((s, i) => {
    const c = s[2];
    if (c === last || last === -1) { last = c; return; }
    last = c; out.push(st.slice(start, i)); start = i;
  });
  out.push(st.slice(start));
  return out;
}

function writePesBlocks(f, st, threads, left, top, right, bottom, cx, cy) {
  const width = right - left, height = bottom - top;
  const str16 = (s) => { f.i16(s.length); f.str(s); };
  str16("CEmbOne");
  for (let i = 0; i < 8; i++) f.i16(0);
  const tx = 350 + 1300 / 2 - width / 2;
  const ty = 100 + height + 1800 / 2 - height / 2;
  f.f32(1); f.f32(0); f.f32(0); f.f32(1); f.f32(tx); f.f32(ty);
  f.i16(1); f.i16(0); f.i16(0); f.i16(Math.trunc(width)); f.i16(Math.trunc(height));
  f.bytes([0, 0, 0, 0, 0, 0, 0, 0]);
  const placeholder = f.n; f.i16(0);
  f.i16(0xFFFF); f.i16(0);
  str16("CSewSeg");
  const ax = left + cx, ay = bottom + cy;
  let ci = 0;
  let code = nearestIndex(threads[ci++] || threads[0], PEC_PALETTE);
  let sx = 0, sy = 0, section = 0, prev = -1, flag = -1;
  const log = [];
  for (const blk of commandBlocks(st)) {
    const cmd = blk[0][2];
    let seg, fl;
    if (cmd === JUMP) {
      const lp = blk[blk.length - 1];
      seg = [[sx - ax, sy - ay], [lp[0] - ax, lp[1] - ay]]; fl = 1;
    } else if (cmd === COLOR_CHANGE) {
      code = nearestIndex(threads[ci++] || threads[threads.length - 1], PEC_PALETTE); continue;
    } else if (cmd === STITCH) {
      seg = blk.map(s => { sx = s[0]; sy = s[1]; return [s[0] - ax, s[1] - ay]; }); fl = 0;
    } else continue;
    if (flag !== -1) f.i16(0x8003);
    flag = fl;
    if (prev !== code) { log.push([section, code]); prev = code; }
    f.i16(fl); f.i16(code); f.i16(seg.length);
    for (const [x, y] of seg) { f.i16(Math.trunc(x)); f.i16(Math.trunc(y)); }
    section++;
  }
  f.i16(log.length);
  for (const [s, c] of log) { f.i16(s); f.i16(c); }
  f.put16(placeholder, section);
  f.i16(0); f.i16(0);
}

const BLANK_HEX = "000000000000f0ffffffff0f080000000010040000000020020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040040000000020080000000010f0ffffffff0f000000000000";
function blank() { const a = new Uint8Array(228); for (let i = 0; i < 228; i++) a[i] = parseInt(BLANK_HEX.substr(i * 2, 2), 16); return a; }
function drawScaled(ext, pts, g, stride, buffer = 5) {
  const [l, t, r, b] = ext;
  const dw = (r - l) || 1, dh = (b - t) || 1;
  const gw = stride * 8, gh = g.length / stride;
  const scale = Math.min((gw - buffer) / dw, (gh - buffer) / dh);
  const tx = -((r + l) / 2) * scale + gw / 2, ty = -((b + t) / 2) * scale + gh / 2;
  for (const p of pts) {
    const x = Math.floor(p[0] * scale + tx), y = Math.floor(p[1] * scale + ty);
    let idx = y * stride + Math.trunc(x / 8);
    if (idx < 0) idx += g.length; // mesmo comportamento da pyembroidery
    if (idx >= 0 && idx < g.length) g[idx] |= 1 << (((x % 8) + 8) % 8);
  }
}

function writePec(f, st, threads, name) {
  const ext = bounds(st);
  // cabeçalho
  f.str(("LA:" + (name.slice(0, 8)).padEnd(16, " ") + "\r"));
  f.bytes([0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0xFF, 0x00]);
  f.u8(6); f.u8(38);
  // paleta única
  const pal = PEC_PALETTE.slice();
  const chart = new Array(pal.length).fill(null);
  const seen = new Set();
  for (const t of threads) {
    const key = `${t.r},${t.g},${t.b}`; if (seen.has(key)) continue; seen.add(key);
    const i = nearestIndex(t, pal); if (i === null) break;
    pal[i] = null; chart[i] = [t.r, t.g, t.b];
  }
  const idx = threads.map(t => nearestIndex(t, chart));
  if (idx.length) {
    f.bytes(new Array(12).fill(0x20));
    f.u8(idx.length - 1); f.bytes(idx);
  } else f.bytes([0x20, 0x20, 0x20, 0x20, 0x64, 0x20, 0x00, 0x20, 0x00, 0x20, 0x20, 0x20, 0xFF]);
  for (let i = idx.length; i < 463; i++) f.u8(0x20);
  // bloco de pontos
  const start = f.n;
  f.bytes([0, 0]); f.i24(0); f.bytes([0x31, 0xff, 0xf0]);
  f.i16(Math.round(ext[2] - ext[0])); f.i16(Math.round(ext[3] - ext[1]));
  f.i16(0x1E0); f.i16(0x1B0);
  const val = (v, long, flag = 0) => {
    if (!long && v > -64 && v < 63) f.u8(v & 0x7F);
    else { v &= 0x0FFF; v |= 0x8000; v |= flag << 8; f.u8((v >> 8) & 255); f.u8(v & 255); }
  };
  let colorTwo = true, jumping = true, init = true, xx = 0, yy = 0;
  for (const [x, y, c] of st) {
    const dx = Math.round(x - xx), dy = Math.round(y - yy); xx += dx; yy += dy;
    if (c === STITCH) {
      if (jumping) { if (dx !== 0 && dy !== 0) { val(0, false); val(0, false); } jumping = false; }
      val(dx, false); val(dy, false);
    } else if (c === JUMP) {
      jumping = true;
      const fl = init ? 0x10 : 0x20;
      val(dx, true, fl); val(dy, true, fl);
    } else if (c === COLOR_CHANGE) {
      if (jumping) { val(0, false); val(0, false); jumping = false; }
      f.bytes([0xfe, 0xb0, colorTwo ? 2 : 1]); colorTwo = !colorTwo;
    } else if (c === END) { f.u8(0xff); break; }
    init = false;
  }
  f.put24(start + 2, f.n - start);
  // miniaturas
  let g = blank();
  // stitchblocks: todos os STITCH
  drawScaled(ext, st.filter(s => s[2] === STITCH), g, 6, 4);
  f.bytes(g);
  let blk = [];
  const flush = () => { const gg = blank(); drawScaled(ext, blk.filter(s => s[2] === STITCH), gg, 6); f.bytes(gg); blk = []; };
  for (const s of st) { blk.push(s); if (s[2] === COLOR_CHANGE) flush(); }
  if (blk.length) flush();
}

export function writePES(stitches, threads, name = "bordado") {
  const st = stitches.map(([x, y, c]) => [Math.round(x), Math.round(y), c]);
  const f = new Buf();
  f.str("#PES0001");
  const [l, t, r, b] = bounds(st);
  const cx = (r + l) / 2, cy = (b + t) / 2;
  const ph = f.n; f.i32(0);
  if (st.length === 0) { f.i16(1); f.i16(1); f.i16(0); f.i16(0); f.i16(0); }
  else {
    f.i16(1); f.i16(1); f.i16(1);
    f.i16(0xFFFF); f.i16(0);
    writePesBlocks(f, st, threads, l - cx, t - cy, r - cx, b - cy, cx, cy);
  }
  f.put32(ph, f.n);
  writePec(f, st, threads, name);
  return f.out();
}
