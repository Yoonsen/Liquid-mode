// Feilsøkingshjelpere for nettleserkonsollen. Åpne appen med ?debug og kjør:
//   const D = await import("/dev/debug-console.js");
//   await D.merged([12, 13, 14]);   // alle sammensydde bindestrek-ord på sidene, slik leseren tegner dem
//   await D.waitLoad(15); D.show(0, 0, 1500, 900, 0.5);   // ordbokser + målt grunnlinje over sidebildet
//   await D.bookStats([[urn, [10, 20]]]);   // linjer, ord, sammenføyninger, kantord per side
//   D.hide();   // fjerner overlegget
// Ikke en del av den publiserte appen (pages.yml kopierer ikke dev/).
const SULT = "URN:NBN:no-nb_digibok_2015051929001";
const P = () => window.__pixelLiquid;

export async function waitLoad(idx, urn = SULT) {
  const before = P().state.detectedWords;
  await P().loadPage(urn, idx);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const s = P().state;
    if (s.detectedWords !== before && s.iiifBook && s.iiifBook.currentIndex === idx) break;
  }
  await new Promise((r) => setTimeout(r, 300));
}

function ctx() {
  const { state, sourceCanvas } = P();
  return { state, W: sourceCanvas.width, g: state.gray, th: state.otsuThreshold + state.contrastOffset };
}

// Grunnlinje målt i ordets ferdige utklipp (med samme skjæring som leseren): avstand fra
// utklippets bunn til underkanten av x-høyden (persentilmetoden). Uavhengig av hvordan appen
// plasserte utklippet, så den kan brukes til å sammenligne versjoner.
export function base(wd) {
  const { state, W, g, th } = ctx();
  const slope = state.useDejaggBaseline ? wd.localSlope || 0 : 0;
  const midC = wd.shearMidC ?? (wd.w - 1) / 2;
  const cnt = new Float32Array(wd.h);
  for (let c = 0; c < wd.w; c++) {
    const dy = (c - midC) * slope;
    for (let r = 0; r < wd.h; r++) {
      const y = Math.round(wd.y + r + dy);
      if (g[y * W + wd.x + c] < th) cnt[r]++;
    }
  }
  const sorted = Array.from(cnt).sort((a, b) => a - b);
  const q75 = sorted[Math.floor((sorted.length - 1) * 0.75)];
  if (q75 < 3) return null;
  let peak = 0;
  for (let r = 1; r < wd.h; r++) if (cnt[r] > cnt[peak]) peak = r;
  let top = peak;
  let bot = peak;
  while (top > 0 && cnt[top - 1] >= q75 * 0.5) top--;
  while (bot < wd.h - 1 && cnt[bot + 1] >= q75 * 0.5) bot++;
  if (bot - top + 1 < 6) return null;
  return wd.h - 1 - bot;
}

export function measure() {
  const { state } = ctx();
  const L = state.detectedLines;
  const diffs = [];
  const within = [];
  for (let i = 0; i < L.length; i++) {
    const ws = L[i].words;
    const bs = ws.map(base);
    for (let j = 1; j < ws.length; j++) if (bs[j] != null && bs[j - 1] != null) within.push(bs[j] - bs[j - 1]);
    if (i + 1 < L.length && !L[i + 1].isParagraphStart) {
      const a = bs[bs.length - 1];
      const b = base(L[i + 1].words[0]);
      if (a != null && b != null) diffs.push({ line: i, d: b - a });
    }
  }
  const mean = (a) => a.reduce((s, x) => s + Math.abs(x), 0) / Math.max(1, a.length);
  const med = (a) => {
    const s = a.map(Math.abs).sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const W = ctx().W;
  const edgeWords = state.detectedWords.filter((w) => w.w < 20 && (w.x < 60 || w.x + w.w > W - 60)).length;
  const share = (a, t) => +(a.filter((x) => Math.abs(x) >= t).length / Math.max(1, a.length)).toFixed(2);
  return {
    crossN: diffs.length,
    crossGe3: share(diffs.map((d) => d.d), 3),
    withinGe3: share(within, 3),
    cross: +mean(diffs.map((d) => d.d)).toFixed(2),
    crossMed: med(diffs.map((d) => d.d)),
    within: +mean(within).toFixed(2),
    hyphenJoins: state.detectedHyphenJoinCount,
    trailingHyphens: state.detectedWords.filter((w) => w.hasTrailingHyphen).length,
    words: state.detectedWords.length,
    edgeWords,
    worst: diffs.filter((d) => Math.abs(d.d) >= 4).map((d) => `L${d.line}:${d.d}`).join(" "),
  };
}

export async function sweep(pages, urn = SULT) {
  const res = {};
  for (const idx of pages) {
    await waitLoad(idx, urn);
    res[idx] = measure();
  }
  return res;
}

export function show(x0, y0, w, h, scale) {
  const { state, sourceCanvas } = P();
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const cx = c.getContext("2d");
  cx.drawImage(sourceCanvas, x0, y0, w, h, 0, 0, w * scale, h * scale);
  for (const wd of state.detectedWords) {
    cx.strokeStyle = wd.joinWithNextWord ? "red" : wd.hasTrailingHyphen ? "orange" : "rgba(0,120,255,0.8)";
    cx.lineWidth = 1;
    cx.strokeRect((wd.x - x0) * scale, (wd.y - y0) * scale, wd.w * scale, wd.h * scale);
    const b = base(wd);
    if (b != null) {
      cx.fillStyle = "rgba(0,160,0,0.9)";
      cx.fillRect((wd.x - x0) * scale, (wd.y + wd.h - 1 - b - y0) * scale, wd.w * scale, 2);
    }
    if (wd.hyphenBox) {
      cx.strokeStyle = "magenta";
      const hb = wd.hyphenBox;
      cx.strokeRect((hb.x0 - x0) * scale, (hb.y0 - y0) * scale, (hb.x1 - hb.x0) * scale, (hb.y1 - hb.y0) * scale);
    }
  }
  let o = document.getElementById("__dbg");
  if (!o) {
    o = document.createElement("div");
    o.id = "__dbg";
    o.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto";
    o.onclick = () => o.remove();
    document.body.appendChild(o);
  }
  o.innerHTML = "";
  c.style.width = "100%";
  o.appendChild(c);
  return [c.width, c.height];
}

export function hide() {
  document.getElementById("__dbg")?.remove();
}

export function pixels(lineIdx, wordIdx, cols = 40) {
  const { state, W, g, th } = ctx();
  const l = state.detectedLines[lineIdx];
  const wd = l.words[wordIdx < 0 ? l.words.length + wordIdx : wordIdx];
  const rows = [];
  for (let y = l.yTop; y <= l.yBottom; y++) {
    let s = "";
    for (let x = wd.x + wd.w - cols; x < wd.x + wd.w; x++) {
      const v = g[y * W + x];
      s += v < th ? "#" : v < th + 25 ? "+" : ".";
    }
    rows.push((y === Math.round(l.yCore) ? ">" : " ") + s);
  }
  return `x=${wd.x} w=${wd.w} band=${l.yTop}-${l.yBottom}\n` + rows.join("\n");
}

// Viser alle sammensydde bindestrek-ord fra sidene som de tegnes i leseren.
export async function merged(pages, urn = SULT) {
  const cs = [];
  for (const p of pages) {
    await waitLoad(p, urn);
    document.querySelectorAll(".hyphen-merged-token").forEach((t) => {
      const [a, b] = t.querySelectorAll("canvas.word-ink");
      cs.push([p, a, b]);
    });
  }
  const s = 0.6;
  const rowH = 48;
  const cols = 2;
  const out = document.createElement("canvas");
  out.width = 750;
  out.height = Math.max(1, rowH * Math.ceil(cs.length / cols));
  const x = out.getContext("2d");
  x.fillStyle = "#f6efe0";
  x.fillRect(0, 0, 750, out.height);
  x.font = "11px sans-serif";
  cs.forEach(([p, a, b], k) => {
    const y = Math.floor(k / cols) * rowH;
    const xo = (k % cols) * 375;
    const wa = a.dataset.origW * s;
    const ha = a.dataset.origH * s;
    const wb = b.dataset.origW * s;
    const hb = b.dataset.origH * s;
    x.drawImage(a, xo + 30, y + rowH - 2 - ha, wa, ha);
    x.drawImage(b, xo + 30 + wa - 1, y + rowH - 2 - hb, wb, hb);
    x.fillStyle = "#000";
    x.fillText("s" + p, xo + 2, y + 25);
  });
  let o = document.getElementById("__dbg");
  if (!o) {
    o = document.createElement("div");
    o.id = "__dbg";
    o.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto";
    document.body.appendChild(o);
  }
  o.innerHTML = "";
  out.style.width = "100%";
  o.appendChild(out);
  return cs.length;
}

export async function bookStats(books) {
  const out = {};
  for (const [urn, pages] of books) {
    for (const p of pages) {
      await waitLoad(p, urn);
      const s = P().state;
      const W = P().sourceCanvas.width;
      out[`${urn.slice(-6)}:${p}`] = {
        lines: s.detectedLines.length,
        words: s.detectedWords.length,
        joins: s.detectedHyphenJoinCount,
        edgeWords: s.detectedWords.filter((w) => w.w < 20 && (w.x < 60 || w.x + w.w > W - 60)).length,
        tinyLines: s.detectedLines.filter((l) => l.yBottom - l.yTop < 12).length,
      };
    }
  }
  return out;
}
