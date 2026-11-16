import { analyzeColors, labelsToMasks, layerGeometry, clipSatin, buildStitches, chooseCuts, clipRect, polyBounds, labelWithPalette, thickFraction, polyArea } from "./engine.js";
import { writePES, BROTHER_PALETTE, nearestIndex, STITCH } from "./pes.js";
import { makeZip } from "./zip.js";
import { HOOP, FABRICS, PIECES, FONTS } from "./presets.js";

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const hex = ([r, g, b]) => "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
const fmt = (v, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const slug = (s) => (s || "bordado").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase().slice(0, 24) || "bordado";
const PALETTE = BROTHER_PALETTE.map((p, i) => (p ? { i, rgb: [p[0], p[1], p[2]], name: p[3] } : null)).filter(Boolean);
const NOMES_PT = { "Prussian Blue": "Azul-prússia", "Blue": "Azul", "Teal Green": "Verde-petróleo", "Cornflower Blue": "Azul-centáurea", "Red": "Vermelho", "Reddish Brown": "Marrom-avermelhado", "Magenta": "Magenta", "Light Lilac": "Lilás-claro", "Lilac": "Lilás", "Mint Green": "Verde-menta", "Deep Gold": "Dourado", "Orange": "Laranja", "Yellow": "Amarelo", "Lime Green": "Verde-limão", "Brass": "Latão", "Silver": "Prata", "Russet Brown": "Marrom", "Cream Brown": "Creme", "Pewter": "Estanho", "Black": "Preto", "Ultramarine": "Azul royal", "Royal Purple": "Roxo-real", "Dark Gray": "Cinza-escuro", "Dark Brown": "Marrom-escuro", "Deep Rose": "Rosa-escuro", "Light Brown": "Marrom-claro", "Salmon Pink": "Salmão", "Vermilion": "Vermelhão", "White": "Branco", "Violet": "Violeta", "Seacrest": "Verde-água", "Sky Blue": "Azul-céu", "Pumpkin": "Abóbora", "Cream Yellow": "Amarelo-creme", "Khaki": "Cáqui", "Clay Brown": "Terracota", "Leaf Green": "Verde-folha", "Peacock Blue": "Azul-pavão", "Gray": "Cinza", "Warm Gray": "Cinza-quente", "Dark Olive": "Oliva-escuro", "Flesh Pink": "Rosa-pele", "Pink": "Rosa", "Deep Green": "Verde-escuro", "Lavender": "Lavanda", "Wisteria Violet": "Glicínia", "Beige": "Bege", "Carmine": "Carmim", "Amber Red": "Vermelho-âmbar", "Olive Green": "Verde-oliva", "Dark Fuchsia": "Fúcsia", "Tangerine": "Tangerina", "Light Blue": "Azul-claro", "Emerald Green": "Verde-esmeralda", "Purple": "Roxo", "Moss Green": "Verde-musgo", "Harvest Gold": "Ouro", "Electric Blue": "Azul-elétrico", "Lemon Yellow": "Amarelo-limão", "Fresh Green": "Verde-fresco", "Applique": "Aplique" };
const ptName = (n) => NOMES_PT[n] || n;
const nearestThread = (rgb) => nearestIndex({ r: rgb[0], g: rgb[1], b: rgb[2] }, BROTHER_PALETTE);

const state = {
  useSatin: true, mode: "imagem", img: null, imgName: "", analysis: null, colors: [],
  text: "", font: FONTS[0].family, textThread: 21,
  piece: "toalha_rosto", fabric: "toalha", widthCm: 9, letterCm: 2.5, result: null,
};

// ------------------------------------------------------------------ UI básica

function setMode(m) {
  state.mode = m;
  document.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
  $("#bloco-imagem").hidden = m !== "imagem";
  $("#bloco-nome").hidden = m !== "nome";
  $("#campo-largura").hidden = m !== "imagem";
  $("#campo-letra").hidden = m !== "nome";
  $("#bloco-cores").hidden = m !== "imagem" || !state.colors.length;
  updateSizeInfo();
}

function fillSelects() {
  const ps = $("#peca");
  for (const [k, p] of Object.entries(PIECES)) ps.append(el("option", { value: k }, p.label));
  ps.value = state.piece;
  const fs = $("#tecido");
  for (const [k, f] of Object.entries(FABRICS)) fs.append(el("option", { value: k }, f.label));
  fs.value = state.fabric;
  const fo = $("#fonte");
  for (const f of FONTS) fo.append(el("option", { value: f.family, style: `font-family:'${f.family}';font-weight:${f.weight || 400}` }, `${f.label} — ${f.family}`));
  fo.value = state.font;
  const tc = $("#cor-texto");
  for (const p of PALETTE) tc.append(el("option", { value: p.i }, ptName(p.name)));
  tc.value = state.textThread;
  updateTextSwatch();
}

function applyPiece() {
  const p = PIECES[state.piece];
  state.fabric = p.fabric; $("#tecido").value = p.fabric;
  state.widthCm = p.widthCm; $("#largura").value = p.widthCm;
  state.letterCm = p.letterCm; $("#letra").value = p.letterCm;
  $("#dica-peca").textContent = "Posição sugerida: " + p.place;
  applyFabric();
  updateSizeInfo();
}
function applyFabric() {
  const f = FABRICS[state.fabric];
  $("#dicas-tecido").replaceChildren(...f.tips.map(t => el("li", {}, t)));
}
function updateTextSwatch() { $("#amostra-texto").style.background = hex(BROTHER_PALETTE[state.textThread]); }

function updateSizeInfo() {
  const info = $("#info-tamanho");
  if (state.mode === "imagem") {
    if (!state.img) { info.textContent = ""; return; }
    const w = state.widthCm, h = w * state.img.height / state.img.width;
    const parts = w * 10 > HOOP.usable ? Math.ceil((w * 10) / (HOOP.usable - 5)) : 1;
    info.innerHTML = `Tamanho final: <b>${fmt(w)} × ${fmt(h)} cm</b>. ` +
      (h * 10 > HOOP.usable ? `<span class="erro">A altura passa de ${HOOP.usable / 10} cm: não cabe no bastidor de 10 × 10 cm. Diminua a largura.</span>` :
        parts > 1 ? `<span class="aviso">Não cabe num bastidor só: será dividido em cerca de <b>${parts} partes</b>.</span>` : `<span class="ok">Cabe no bastidor de 10 × 10 cm.</span>`);
  } else {
    const min = FABRICS[state.fabric].minLetterMm / 10;
    info.innerHTML = `Altura da letra maiúscula: <b>${fmt(state.letterCm)} cm</b>. A largura total é calculada ao gerar.` +
      (state.letterCm < min ? ` <span class="erro">Para ${FABRICS[state.fabric].label.toLowerCase()} o mínimo recomendado é ${fmt(min)} cm.</span>` : "");
  }
}

// ------------------------------------------------------------------ imagem

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
  state.img = img; state.imgName = file.name.replace(/\.[^.]+$/, "");
  $("#miniatura").src = url; $("#miniatura").hidden = false;
  // análise de cores em resolução reduzida
  const maxSide = 700, k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const an = analyzeColors(data);
  state.analysis = an;
  state.colors = an.colors.filter(c => c.share >= 0.05).map(c => ({ ...c, thread: nearestThread(c.rgb), on: true }));
  // ordem: cores claras primeiro (normalmente fundo/detalhes atrás), escuras por último
  state.colors.sort((a, b) => b.lab[0] - a.lab[0]);
  renderColors();
  setMode("imagem");
}

function renderColors() {
  const box = $("#lista-cores");
  box.replaceChildren();
  state.colors.forEach((c, i) => {
    const sel = el("select", { "aria-label": "Linha", onchange: (e) => { c.thread = +e.target.value; renderColors(); } },
      PALETTE.map(p => el("option", { value: p.i, ...(p.i === c.thread ? { selected: "" } : {}) }, ptName(p.name))));
    box.append(el("div", { class: "cor" + (c.on ? "" : " off") },
      el("span", { class: "ordem" }, `${i + 1}ª`),
      el("span", { class: "sw", title: "Cor na imagem", style: `background:${hex(c.rgb)}` }),
      el("span", { class: "seta" }, "→"),
      el("span", { class: "sw", title: "Linha", style: `background:${hex(BROTHER_PALETTE[c.thread])}` }),
      sel,
      el("label", { class: "chk" }, el("input", { type: "checkbox", ...(c.on ? { checked: "" } : {}), onchange: (e) => { c.on = e.target.checked; renderColors(); } }), "bordar"),
      el("span", { class: "mover" },
        el("button", { type: "button", title: "Subir", disabled: i === 0 ? "" : null, onclick: () => { [state.colors[i - 1], state.colors[i]] = [state.colors[i], state.colors[i - 1]]; renderColors(); } }, "↑"),
        el("button", { type: "button", title: "Descer", disabled: i === state.colors.length - 1 ? "" : null, onclick: () => { [state.colors[i + 1], state.colors[i]] = [state.colors[i], state.colors[i + 1]]; renderColors(); } }, "↓")),
    ));
  });
  $("#bloco-cores").hidden = state.mode !== "imagem" || !state.colors.length;
}

// ------------------------------------------------------------------ raster -> camadas

function rasterImage(pxPerMm) {
  const wMm = state.widthCm * 10, hMm = wMm * state.img.height / state.img.width;
  const W = Math.round(wMm * pxPerMm), H = Math.round(hMm * pxPerMm);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(state.img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H);
  // grupos = linhas (cores que vão para a mesma linha viram uma camada só)
  const groups = [];
  const cols = state.colors.map(c => {
    if (!c.on) return { lab: c.lab, group: -1 };
    let g = groups.findIndex(x => x.thread === c.thread);
    if (g < 0) { groups.push({ thread: c.thread }); g = groups.length - 1; }
    return { lab: c.lab, group: g };
  });
  const labels = labelWithPalette(data, cols, state.analysis.bg);
  const masks = labelsToMasks(labels, W, H, groups.length, Math.max(1, Math.round(pxPerMm * 0.2)));
  return { W, H, masks, threads: groups.map(g => g.thread) };
}

async function rasterText(pxPerMm) {
  const f = FONTS.find(x => x.family === state.font) || FONTS[0];
  const weight = f.weight || 400;
  const probe = `${weight} 200px "${f.family}"`;
  try { await document.fonts.load(probe, state.text + "H"); } catch (e) { /* segue com o que tiver */ }
  const c = document.createElement("canvas"); const ctx = c.getContext("2d");
  ctx.font = probe;
  const capRatio = (ctx.measureText("H").actualBoundingBoxAscent || 140) / 200;
  const F = (state.letterCm * 10 * pxPerMm) / capRatio;
  const font = `${weight} ${F}px "${f.family}"`;
  ctx.font = font;
  const m = ctx.measureText(state.text);
  const pad = Math.ceil(pxPerMm * 2);
  const W = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 2 * pad;
  const H = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 2 * pad;
  c.width = W; c.height = H;
  ctx.font = font; ctx.fillStyle = "#000";
  ctx.fillText(state.text, pad + m.actualBoundingBoxLeft, pad + m.actualBoundingBoxAscent);
  const d = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return { W, H, masks: [mask], threads: [state.textThread] };
}

// ------------------------------------------------------------------ gerar

async function generate() {
  const msg = $("#mensagem"); msg.className = ""; msg.textContent = "";
  if (state.mode === "imagem" && !state.img) return fail("Escolha uma imagem primeiro.");
  if (state.mode === "nome" && !state.text.trim()) return fail("Digite o nome ou texto.");
  if (state.mode === "imagem" && !state.colors.some(c => c.on)) return fail("Marque pelo menos uma cor para bordar.");
  $("#processando").hidden = false;
  await new Promise(r => setTimeout(r, 30));
  try {
    // resolução de trabalho: 10 px/mm, limitada a ~4 megapixels
    let pxPerMm = 10;
    const estW = state.mode === "imagem" ? state.widthCm * 10 : state.letterCm * 10 * Math.max(4, state.text.length * 0.8);
    const estH = state.mode === "imagem" ? estW * state.img.height / state.img.width : state.letterCm * 10 * 2;
    pxPerMm = Math.min(10, Math.sqrt(4e6 / (estW * estH)));
    const R = state.mode === "imagem" ? rasterImage(pxPerMm) : await rasterText(pxPerMm);
    const warnings = [];
    if (state.mode === "nome") {
      const frac = thickFraction(R.masks[0], R.W, R.H, Math.max(1, Math.round(pxPerMm * 0.45)));
      if (frac < 0.25) warnings.push("Esta fonte tem traços muito finos neste tamanho. Aumente a altura da letra ou escolha uma fonte mais grossa (ex.: Pacifico, Fredoka).");
    }
    const fabric = FABRICS[state.fabric];
    const fabParams = { ...fabric.params, satin: !!(fabric.params.satin && state.useSatin) };
    const layers = R.masks.map((m, k) => ({
      ...layerGeometry(m, R.W, R.H, pxPerMm, fabParams),
      thread: { r: BROTHER_PALETTE[R.threads[k]][0], g: BROTHER_PALETTE[R.threads[k]][1], b: BROTHER_PALETTE[R.threads[k]][2], name: ptName(BROTHER_PALETTE[R.threads[k]][3]) },
      angle: k % 2 ? 135 : 45,
    }));
    const all = layers.flatMap(L => L.polys);
    if (!all.length) throw new Error("Nada para bordar foi encontrado. Confira as cores marcadas ou o contraste da imagem.");
    const [l, t, r, b] = polyBounds(all);
    if (b - t > HOOP.usable) throw new Error(`A altura do desenho (${fmt((b - t) / 10)} cm) passa de ${HOOP.usable / 10} cm e não cabe no bastidor de 10 × 10 cm. Diminua o tamanho.`);
    const cuts = chooseCuts(layers.map(L => L.polys), HOOP.usable - 2);
    if (cuts === null) throw new Error("Não consegui dividir em partes que caibam no bastidor (alguma letra/forma tem mais de 9,5 cm de largura). Diminua o tamanho.");
    const ov = 1.5;
    const edges = [{ x: l - 1, inked: false }, ...cuts, { x: r + 1, inked: false }];
    const parts = [];
    for (let i = 0; i + 1 < edges.length; i++) {
      const x0 = edges[i].x - (edges[i].inked ? ov / 2 : 0), x1 = edges[i + 1].x + (edges[i + 1].inked ? ov / 2 : 0);
      const keep = (ps) => clipRect(ps, x0, t - 1, x1, b + 1).filter(p => polyArea(p) > 0.3);
      const pl = edges.length === 2 ? layers : layers.map(L => ({ ...L, polys: keep(L.polys), fillPolys: keep(L.fillPolys), satin: clipSatin(L.satin, x0, x1) }));
      const res = buildStitches(pl, fabParams);
      if (!res.count) continue;
      if (res.size[0] > HOOP.usable + 0.5) throw new Error("Uma das partes ficou larga demais. Tente um tamanho um pouco menor.");
      parts.push(res);
    }
    const tiny = all.filter(p => polyArea(p) < 2).length;
    if (tiny > 3) warnings.push(`Há ${tiny} detalhes muito pequenos (menos de 2 mm²); eles podem sumir no bordado.`);
    const base = slug(state.mode === "nome" ? state.text : state.imgName);
    parts.forEach((p, i) => {
      p.name = parts.length > 1 ? `${base}_parte${i + 1}de${parts.length}.pes` : `${base}.pes`;
      p.pes = writePES(p.stitches, p.threads, base.slice(0, 8));
    });
    state.result = { parts, bounds: [l, t, r, b], warnings, base, layers, cuts };
    renderResult();
  } catch (e) {
    console.error(e); fail(e.message || String(e));
  } finally { $("#processando").hidden = true; }
}
function fail(t) { const m = $("#mensagem"); m.className = "erro"; m.textContent = t; $("#resultado").hidden = true; }

// ------------------------------------------------------------------ prévia e resultado

function drawStitches(ctx, part, scale, ox, oy, lw = 1.6) {
  const [cx, cy] = part.center;
  let ti = 0, last = null;
  const colorOf = (k) => { const t = part.threads[Math.min(k, part.threads.length - 1)]; return [t.r, t.g, t.b]; };
  let col = colorOf(0);
  for (const [x, y, c] of part.stitches) {
    const px = ox + (x / 10 + cx) * scale, py = oy + (y / 10 + cy) * scale;
    if (c === STITCH) {
      if (last) {
        ctx.strokeStyle = `rgb(${col.map(v => v * 0.55).join(",")})`; ctx.lineWidth = lw + 0.8;
        ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(px, py); ctx.stroke();
        ctx.strokeStyle = `rgb(${col.join(",")})`; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(px, py); ctx.stroke();
      }
      last = [px, py];
    } else if (c === 5) { ti++; col = colorOf(ti); last = null; } else last = null;
  }
}

function renderResult() {
  const R = state.result; const box = $("#resultado"); box.hidden = false;
  const [l, t, r, b] = R.bounds;
  const total = R.parts.reduce((s, p) => s + p.count, 0);
  const mins = R.parts.reduce((s, p) => s + p.minutes, 0);
  const jumps = R.parts.reduce((s, p) => s + p.trims, 0);
  // prévia geral
  const cv = $("#previa"); const pad = 24;
  const maxW = Math.min(1100, cv.parentElement.clientWidth * 2 || 900);
  const scale = Math.min((maxW - 2 * pad) / (r - l), 700 / (b - t));
  cv.width = Math.round((r - l) * scale + 2 * pad); cv.height = Math.round((b - t) * scale + 2 * pad + 20);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#f6f3ee"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.lineCap = "round";
  const ox = pad - l * scale, oy = pad - t * scale;
  for (const p of R.parts) drawStitches(ctx, p, scale, ox, oy, Math.max(1, scale * 0.18));
  if (R.parts.length > 1) {
    ctx.setLineDash([6, 5]); ctx.strokeStyle = "#c0392b"; ctx.lineWidth = 1.5;
    for (const c of R.cuts) { const x = ox + c.x * scale; ctx.beginPath(); ctx.moveTo(x, pad - 10); ctx.lineTo(x, cv.height - 26); ctx.stroke(); }
    ctx.setLineDash([]);
    R.parts.forEach((p, i) => { ctx.fillStyle = "#c0392b"; ctx.font = "bold 22px system-ui"; ctx.fillText(String(i + 1), ox + p.center[0] * scale - 6, cv.height - 6); });
  }
  // resumo
  const fab = FABRICS[state.fabric];
  const order = R.parts[0].threads.map((t, i) => el("li", {}, el("span", { class: "sw", style: `background:${hex([t.r, t.g, t.b])}` }), ` ${i + 1}ª linha: ${t.name}`));
  $("#resumo").replaceChildren(...[
    el("p", {}, el("b", {}, `${fmt((r - l) / 10)} × ${fmt((b - t) / 10)} cm`), ` · ${total.toLocaleString("pt-BR")} pontos · ${R.parts[0].threads.length} cor(es) · cerca de ${Math.ceil(mins)} min de máquina · ${jumps} salto(s) de linha`),
    jumps ? el("p", { class: "dica" }, "A PE-560L não corta a linha sozinha entre uma forma e outra: quando a máquina parar para trocar de cor (e no final), corte rente os fios de salto com uma tesourinha curva, por cima e por baixo do tecido.") : null,
    R.parts.length > 1 ? el("p", { class: "aviso" }, `Dividido em ${R.parts.length} partes para caber no bastidor de 10 × 10 cm. Borde na ordem 1, 2, 3… usando o gabarito para posicionar cada parte.`) : null,
    el("p", {}, "Ordem das linhas (a máquina pede a troca nesta ordem):"), el("ul", { class: "ordem-linhas" }, order),
    R.warnings.length ? el("ul", { class: "avisos" }, R.warnings.map(w => el("li", {}, w))) : null,
    el("p", {}, el("b", {}, "Na hora de bordar: ")), el("ul", {}, fab.tips.map(t => el("li", {}, t))),
  ].filter(Boolean));
  // arquivos
  const files = $("#arquivos"); files.replaceChildren();
  R.parts.forEach((p, i) => {
    const blob = new Blob([p.pes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const row = el("div", { class: "arquivo" },
      el("div", {}, el("b", {}, p.name), el("br"), `${fmt(p.size[0] / 10)} × ${fmt(p.size[1] / 10)} cm · ${p.count.toLocaleString("pt-BR")} pontos`,
        R.parts.length > 1 ? el("span", { class: "pos" }, ` · centro a ${fmt((p.center[0] - l) / 10)} cm da borda esquerda e ${fmt((p.center[1] - t) / 10)} cm do topo do desenho`) : null),
      el("div", { class: "botoes" },
        el("a", { class: "btn", href: url, download: p.name }, "Baixar .PES"),
        navigator.canShare && navigator.canShare({ files: [new File([blob], p.name)] }) ? el("button", { class: "btn sec", type: "button", onclick: () => navigator.share({ files: [new File([blob], p.name, { type: "application/octet-stream" })], title: p.name }).catch(() => { }) }, "Compartilhar (Artspira)") : null));
    files.append(row);
  });
  if (R.parts.length > 1) {
    const zip = makeZip(R.parts.map(p => ({ name: p.name, data: p.pes })));
    files.prepend(el("div", { class: "arquivo destaque" }, el("div", {}, el("b", {}, "Todas as partes"), el("br"), `${R.parts.length} arquivos .PES num .zip`),
      el("div", { class: "botoes" }, el("a", { class: "btn", href: URL.createObjectURL(zip), download: `${R.base}_partes.zip` }, "Baixar tudo (.zip)"))));
  }
  buildPrint();
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ------------------------------------------------------------------ ficha + gabarito para imprimir (1:1)

function svgOf(polysLayers, x0, y0, w, h, extra = "") {
  const NS = "http://www.w3.org/2000/svg";
  let paths = "";
  for (const L of polysLayers) {
    const d = L.polys.map(p => [p.outer, ...p.holes].map(r => "M" + r.map(([x, y]) => `${(x - x0).toFixed(2)},${(y - y0).toFixed(2)}`).join("L") + "Z").join("")).join("");
    paths += `<path d="${d}" fill="${hex([L.thread.r, L.thread.g, L.thread.b])}" fill-opacity="0.35" stroke="#222" stroke-width="0.25" fill-rule="evenodd"/>`;
  }
  return `<svg xmlns="${NS}" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${paths}${extra}</svg>`;
}
function cross(x, y, s = 8) { return `<path d="M${x - s},${y}H${x + s}M${x},${y - s}V${y + s}" stroke="#c0392b" stroke-width="0.4"/><circle cx="${x}" cy="${y}" r="1.2" fill="none" stroke="#c0392b" stroke-width="0.3"/>`; }

function buildPrint() {
  const R = state.result; const pr = $("#impressao"); pr.replaceChildren();
  const [l, t, r, b] = R.bounds; const fab = FABRICS[state.fabric]; const piece = PIECES[state.piece];
  // página 1: ficha
  const ov = R.parts.length > 1 ? R.parts.map((p, i) => cross(p.center[0] - l + 2, p.center[1] - t + 2, 4) + `<text x="${p.center[0] - l + 3}" y="${b - t + 7}" font-size="5" fill="#c0392b" font-family="sans-serif">${i + 1}</text>`).join("") +
    R.cuts.map(c => `<path d="M${c.x - l + 2},0V${b - t + 4}" stroke="#c0392b" stroke-dasharray="2 1.5" stroke-width="0.3"/>`).join("") : "";
  const scaleNote = (r - l) + 4 > 180 ? " (reduzido para caber na folha)" : "";
  const ficha = el("section", { class: "pagina" },
    el("h1", {}, `Ficha de bordado — ${state.mode === "nome" ? state.text : state.imgName}`),
    el("p", {}, `Peça: ${piece.label} · Tecido: ${fab.label} · Tamanho: ${fmt((r - l) / 10)} × ${fmt((b - t) / 10)} cm · Máquina: Brother PE-560L (bastidor 10 × 10 cm)`),
    el("p", {}, `Posição: ${piece.place}`),
    el("h2", {}, "Ordem das linhas"),
    el("ol", {}, R.parts[0].threads.map(th => el("li", {}, `${th.name} (${hex([th.r, th.g, th.b])})`))),
    el("h2", {}, "Preparação"), el("ul", {}, fab.tips.map(x => el("li", {}, x))),
    R.parts.length > 1 ? el("div", {},
      el("h2", {}, `Partes (${R.parts.length})`),
      el("ol", {}, R.parts.map(p => el("li", {}, `${p.name}: centro a ${fmt((p.center[0] - l) / 10)} cm da borda esquerda e ${fmt((p.center[1] - t) / 10)} cm do topo do desenho.`))),
      el("p", {}, "Como alinhar: imprima as páginas seguintes em tamanho real (100%, sem \"ajustar à página\"), recorte e posicione na peça. Marque a cruz vermelha de cada parte com caneta hidrossolúvel. Prenda o tecido com a cruz no centro do bastidor (use as marcas do bastidor) e borde a parte correspondente."),
    ) : null,
    el("h2", {}, "Visão geral" + scaleNote),
  );
  const wrap = el("div", { class: "svgwrap" }); wrap.innerHTML = svgOf(R.layers, l - 2, t - 2, r - l + 4, b - t + 10, ov);
  if ((r - l) + 4 > 180) { const s = wrap.querySelector("svg"); s.setAttribute("width", "180mm"); s.setAttribute("height", `${(180 * (b - t + 10) / (r - l + 4)).toFixed(1)}mm`); }
  ficha.append(wrap);
  pr.append(ficha);
  // gabaritos 1:1
  R.parts.forEach((p, i) => {
    const [pl, pt, pr2, pb] = p.bounds;
    const cx = p.center[0], cy = p.center[1];
    const x0 = cx - 55, y0 = cy - 55;
    const extra = `<rect x="5" y="5" width="100" height="100" fill="none" stroke="#888" stroke-dasharray="3 2" stroke-width="0.3"/>` + cross(55, 55, 10) +
      `<text x="7" y="10" font-size="3.5" fill="#888" font-family="sans-serif">bastidor 10 × 10 cm</text>`;
    const layersPart = R.layers.map(L => ({ ...L, polys: clipRect(L.polys, pl - 0.5, pt - 0.5, pr2 + 0.5, pb + 0.5) }));
    const sec = el("section", { class: "pagina" },
      el("h2", {}, R.parts.length > 1 ? `Gabarito — parte ${i + 1} de ${R.parts.length} (${p.name})` : `Gabarito — ${p.name}`),
      el("p", {}, `Tamanho real. Confira: o quadrado tracejado deve medir exatamente 10 cm. Centro (cruz vermelha) = centro do bastidor.`));
    const w2 = el("div", { class: "svgwrap" }); w2.innerHTML = svgOf(layersPart, x0, y0, 110, 110, extra);
    sec.append(w2); pr.append(sec);
  });
}

// ------------------------------------------------------------------ eventos

function init() {
  fillSelects(); applyPiece();
  document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("#arquivo").addEventListener("change", (e) => e.target.files[0] && loadImage(e.target.files[0]).catch(err => fail("Não consegui abrir a imagem: " + err)));
  $("#peca").addEventListener("change", (e) => { state.piece = e.target.value; applyPiece(); });
  $("#tecido").addEventListener("change", (e) => { state.fabric = e.target.value; applyFabric(); updateSizeInfo(); });
  $("#largura").addEventListener("input", (e) => { state.widthCm = parseFloat(String(e.target.value).replace(",", ".")) || 1; updateSizeInfo(); });
  $("#letra").addEventListener("input", (e) => { state.letterCm = parseFloat(String(e.target.value).replace(",", ".")) || 1; updateSizeInfo(); });
  $("#texto").addEventListener("input", (e) => { state.text = e.target.value; $("#amostra-fonte").textContent = state.text || "Seu nome"; });
  $("#fonte").addEventListener("change", (e) => { state.font = e.target.value; const f = FONTS.find(x => x.family === state.font); const a = $("#amostra-fonte"); a.style.fontFamily = `'${f.family}'`; a.style.fontWeight = f.weight || 400; });
  $("#cor-texto").addEventListener("change", (e) => { state.textThread = +e.target.value; updateTextSwatch(); $("#amostra-fonte").style.color = hex(BROTHER_PALETTE[state.textThread]); });
  $("#satin").addEventListener("change", (e) => { state.useSatin = e.target.checked; });
  $("#gerar").addEventListener("click", generate);
  $("#imprimir").addEventListener("click", () => window.print());
  $("#amostra-fonte").style.fontFamily = `'${state.font}'`;
  $("#amostra-fonte").style.color = hex(BROTHER_PALETTE[state.textThread]);
  setMode("imagem");
  window.__app = { state, generate, loadImage, setMode, renderColors };
}
init();
