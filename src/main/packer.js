'use strict';
// Tuhalf Print yerlesim motoru. Birimler mm.
//
// Kurallar:
//  - Sayfa (canvas) sabit: cfg.width x cfg.maxLength (609,6 x 720,01). Kenar boslugu cfg.margin, tasarimlar arasi cfg.gap.
//  - Tasarimlar tam genislikte "satirlar" halinde dizilir (giyotinle kesilebilir duzen). Her ebat gerekirse 90 derece doner.
//  - Bir satir ancak "tam" ise basilir: satirda baska bir tasarimin (en kucuk 15x21) sigacagi bosluk kalmamalidir.
//    Tam satir kuramayan fazla tasarimlar bekletilir, sonra gelen siparislerin yanina dizilir (force ile hepsi dizilir).
//  - Kalan bosluklara (sayfanin alti, 50x70 yani vb.) tesekkur karti otomatik yerlesir.

const EPS = 1e-6;
const MIN_DESIGN = { w: 150, h: 210 }; // en kucuk urun: 15x21

function orients(t) {
  const o = [{ w: t.w, h: t.h, rot: false }];
  if (!t.lock && Math.abs(t.w - t.h) > EPS) o.push({ w: t.h, h: t.w, rot: true });
  return o;
}

// ---------- Bos alan (MaxRects) ----------
function freeRects(region, occupied) {
  let free = [{ ...region }];
  for (const o of occupied) {
    const next = [];
    for (const f of free) {
      if (o.x >= f.x + f.w - EPS || o.x + o.w <= f.x + EPS || o.y >= f.y + f.h - EPS || o.y + o.h <= f.y + EPS) { next.push(f); continue; }
      if (o.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: o.x - f.x, h: f.h });
      if (o.x + o.w < f.x + f.w - EPS) next.push({ x: o.x + o.w, y: f.y, w: f.x + f.w - o.x - o.w, h: f.h });
      if (o.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: o.y - f.y });
      if (o.y + o.h < f.y + f.h - EPS) next.push({ x: f.x, y: o.y + o.h, w: f.w, h: f.y + f.h - o.y - o.h });
    }
    const inside = (a, b) => a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
    free = next.filter((a, i) => !next.some((b, j) => j !== i && inside(a, b) && (!inside(b, a) || j < i)));
  }
  return free;
}

function fitsIn(f, w, h, g, lock) {
  return (w + g <= f.w + EPS && h + g <= f.h + EPS) || (!lock && h + g <= f.w + EPS && w + g <= f.h + EPS);
}

// ---------- Bolge doldurma (giyotin, en cok alan) ----------
function makeFiller(types, g, budget) {
  const memo = new Map();
  const EMPTY = { area: 0, used: null, parts: null };
  let steps = 0;
  function fill(W, H, counts) {
    if (W < 100 - EPS || H < 100 - EPS) return EMPTY;
    const c = counts.map((n, i) => {
      if (!n) return 0;
      const cap = Math.max(0, ...orients(types[i]).map((o) => (o.w <= W + EPS && o.h <= H + EPS ? Math.floor(((W + g) * (H + g)) / ((o.w + g) * (o.h + g))) : 0)));
      return Math.min(n, cap);
    });
    if (!c.some(Boolean)) return EMPTY;
    const key = W.toFixed(1) + ',' + H.toFixed(1) + ',' + c.join(',');
    const hit = memo.get(key);
    if (hit) return hit;
    let best = EMPTY;
    if (++steps > budget) return best;
    for (let ti = 0; ti < types.length; ti++) {
      if (!c[ti]) continue;
      for (const o of orients(types[ti])) {
        if (o.w > W + EPS || o.h > H + EPS) continue;
        const c2 = c.slice(); c2[ti]--;
        const rw = W - o.w - g, bh = H - o.h - g;
        for (const split of [0, 1]) {
          const r = rw > 0 ? fill(rw, split ? H : o.h, c2) : EMPTY;
          const c3 = r.used ? c2.map((n, i) => n - r.used[i]) : c2;
          const b = bh > 0 ? fill(split ? o.w : W, bh, c3) : EMPTY;
          const area = o.w * o.h + r.area + b.area;
          if (area > best.area + EPS) {
            const used = types.map((_, i) => (i === ti ? 1 : 0) + (r.used ? r.used[i] : 0) + (b.used ? b.used[i] : 0));
            best = { area, used, parts: [{ ti, x: 0, y: 0, w: o.w, h: o.h, rot: o.rot }, { dx: o.w + g, dy: 0, sub: r }, { dx: 0, dy: o.h + g, sub: b }] };
          }
        }
      }
    }
    memo.set(key, best);
    return best;
  }
  return fill;
}

function flatten(res, dx = 0, dy = 0, out = []) {
  if (!res || !res.parts) return out;
  for (const p of res.parts) {
    if (p.sub) flatten(p.sub, dx + p.dx, dy + p.dy, out);
    else out.push({ ...p, x: p.x + dx, y: p.y + dy });
  }
  return out;
}

// ---------- Satir kurma ----------
function rowHasHole(list, W, rowH, g, types) {
  const occ = list.map((p) => ({ x: p.x, y: p.y, w: p.w + g, h: p.h + g }));
  const free = freeRects({ x: 0, y: 0, w: W + g, h: rowH + g }, occ);
  const sizes = [MIN_DESIGN, ...types];
  return free.some((f) => sizes.some((s) => fitsIn(f, s.w, s.h, g, s.lock)));
}

function buildRow(types, counts, W, Hmax, cfg, force) {
  const g = cfg.gap, slack = cfg.rowSlack;
  const fill = makeFiller(types, g, 300000);
  const dims = Array.from(new Set(types.flatMap((t) => [t.w, t.h])));
  const live = types.filter((_, i) => counts[i]);
  let fallback = null;
  // Capa: en eski siparisin ebadi once denenir
  for (let a = 0; a < types.length; a++) {
    if (!counts[a]) continue;
    let bestA = null;
    for (const o of orients(types[a])) {
      if (o.w > W + EPS || o.h > Hmax + EPS) continue;
      const hs = new Set([o.h, ...dims.filter((d) => d > o.h + EPS)].map((d) => Math.min(Hmax, d + slack)).filter((d) => d >= o.h - EPS));
      for (const H of hs) {
        const c = counts.slice(); c[a]--;
        const right = fill(W - o.w - g, H, c);
        const c2 = right.used ? c.map((n, i) => n - right.used[i]) : c;
        const below = fill(o.w, H - o.h - g, c2);
        const list = [{ ti: a, x: 0, y: 0, w: o.w, h: o.h, rot: o.rot }, ...flatten(right, o.w + g, 0), ...flatten(below, 0, o.h + g)];
        const rowH = Math.max(...list.map((p) => p.y + p.h));
        const area = list.reduce((s, p) => s + p.w * p.h, 0);
        const cand = { list, h: rowH, eff: area / (W * rowH), complete: !rowHasHole(list, W, rowH, g, live) };
        if (cand.complete && (!bestA || cand.eff > bestA.eff + EPS)) bestA = cand;
        if (force && !cand.complete && (!fallback || (fallback.a === a && cand.eff > fallback.eff + EPS))) fallback = { ...cand, a };
      }
    }
    if (bestA) return bestA;
  }
  return force ? fallback : null;
}

// ---------- Tesekkur karti ----------
function placeCards(occupied, region, card, g, max) {
  const placed = [];
  const occ = occupied.map((p) => ({ x: p.x, y: p.y, w: p.w + g, h: p.h + g }));
  for (;;) {
    if (max && placed.length >= max) break;
    const free = freeRects({ x: region.x, y: region.y, w: region.w + g, h: region.h + g }, occ);
    let best = null;
    for (const f of free) {
      for (const o of orients({ w: card.w, h: card.h })) {
        if (o.w + g > f.w + EPS || o.h + g > f.h + EPS) continue;
        if (!best || f.y < best.y - EPS || (Math.abs(f.y - best.y) < EPS && f.x < best.x - EPS)) best = { x: f.x, y: f.y, o };
      }
    }
    if (!best) break;
    const p = { x: best.x, y: best.y, w: best.o.w, h: best.o.h, rotated: best.o.rot };
    placed.push(p); occ.push({ x: p.x, y: p.y, w: p.w + g, h: p.h + g });
  }
  return placed;
}

// ---------- Ana fonksiyon ----------
// items: eskiden yeniye sirali {w, h, lockPortrait, ...}
// cfg: {width, maxLength, margin, gap, rowSlack?, card?: {w, h, file, max}}
// opts.force: tam satir olusmasa da bekleyenleri de diz
function packAll(items, cfg, opts = {}) {
  // Yan yana / ust uste gelen tasarimlar arasinda her zaman en az 1 mm bosluk
  cfg = { rowSlack: 6, ...cfg, gap: Math.max(1, Number(cfg.gap) || 0) };
  const m = cfg.margin, g = cfg.gap;
  const W = cfg.width - 2 * m, L = cfg.maxLength - 2 * m;
  const skipped = [], pool = [];
  for (const it of items) {
    const ok = (it.w <= W + EPS && it.h <= L + EPS) || (!it.lockPortrait && it.h <= W + EPS && it.w <= L + EPS);
    (ok ? pool : skipped).push(it);
  }
  const sheets = [];
  while (pool.length) {
    const sheet = { items: [], length: cfg.maxLength, width: cfg.width, cards: 0 };
    let y = 0;
    for (;;) {
      const typeMap = new Map();
      for (const it of pool) {
        const k = `${it.w}x${it.h}${it.lockPortrait ? 'L' : ''}`;
        if (!typeMap.has(k)) typeMap.set(k, { w: it.w, h: it.h, lock: !!it.lockPortrait, items: [] });
        typeMap.get(k).items.push(it);
      }
      const types = Array.from(typeMap.values());
      const row = types.length && L - y >= 100 ? buildRow(types, types.map((t) => t.items.length), W, L - y, cfg, !!opts.force) : null;
      if (!row) break;
      for (const p of row.list) {
        const it = types[p.ti].items.shift();
        pool.splice(pool.indexOf(it), 1);
        sheet.items.push({ item: it, x: m + p.x, y: m + y + p.y, w: p.w, h: p.h, rotated: p.rot });
      }
      y += row.h + g;
    }
    if (!sheet.items.length) break;
    sheets.push(sheet);
  }
  if (cfg.card && cfg.card.w > 0 && cfg.card.h > 0) {
    for (const s of sheets) {
      const cards = placeCards(s.items, { x: m, y: m, w: W, h: L }, cfg.card, g, cfg.card.max || 0);
      s.cards = cards.length;
      for (const c of cards) s.items.push({ item: { isCard: true, name: 'Teşekkür kartı', file: cfg.card.file, w: cfg.card.w, h: cfg.card.h }, ...c });
    }
  }
  return { sheets, skipped, waiting: pool };
}

module.exports = { packAll, freeRects };
