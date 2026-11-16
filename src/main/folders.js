'use strict';
const fs = require('fs');
const path = require('path');
const { parseName } = require('./naming');

const DAY_RE = /^(\d\d)-(\d\d)-(\d\d)-SIPARISLER$/;
const IMG_RE = /\.(png|jpe?g|tiff?|psd)$/i;

function pad(n) { return String(n).padStart(2, '0'); }

// Mesai bitisinden sonra -> ertesi gunun klasoru
function dayFolderName(now, dayEnd) {
  const [hh, mm] = String(dayEnd || '18:00').split(':').map(Number);
  const cut = new Date(now); cut.setHours(hh, mm || 0, 0, 0);
  const d = new Date(now);
  if (now >= cut) d.setDate(d.getDate() + 1);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)}-SIPARISLER`;
}

// Siparisin geldigi gun (yerel saat) -> o gunun klasoru. 15.11'de gelen siparis 15-11-..-SIPARISLER'e gider.
function orderDayFolderName(date) {
  const d = new Date(date);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)}-SIPARISLER`;
}

function dayKey(name) { const m = name.match(DAY_RE); return m ? `${m[3]}${m[2]}${m[1]}` : ''; }

function listDayFolders(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && DAY_RE.test(d.name))
    .map((d) => ({ name: d.name, path: path.join(root, d.name), key: dayKey(d.name) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && IMG_RE.test(f.name) && !f.name.startsWith('.'))
    .map((f) => {
      const p = path.join(dir, f.name);
      const st = fs.statSync(p);
      return { name: f.name, path: p, mtime: st.mtimeMs, bytes: st.size, info: parseName(f.name) };
    });
}

// Siparisler paneli: son N gun klasoru, dizilecek + dizildi
function listOrders(root, days = 7) {
  const folders = listDayFolders(root).slice(-days).reverse();
  return folders.map((f) => {
    const pending = listImages(f.path).map((x) => ({ ...x, status: 'pending' }));
    const done = listImages(path.join(f.path, '_Dizildi')).map((x) => ({ ...x, status: 'arranged' }));
    const files = pending.concat(done).sort((a, b) => ((b.info?.order || 0) - (a.info?.order || 0)) || a.name.localeCompare(b.name));
    return { name: f.name, path: f.path, files };
  });
}

// Baskiya girecek ogeler (eskiden yeniye, adet kadar kopya).
// arranged: { dosyaAdi: dizilmis kopya sayisi } -> cok adetli dosyanin dizilen kopyalari tekrar gelmez
function pendingItems(root, lockList, arranged) {
  const lock = new Set((lockList || []).map((s) => String(s).toLowerCase()));
  const items = [], bad = [];
  let newest = null;
  for (const f of listDayFolders(root)) {
    for (const img of listImages(f.path)) {
      if (!img.info) { bad.push(img.name); continue; }
      newest = f.path;
      const i = img.info;
      const doneCopies = (arranged && arranged[img.name]) || 0;
      for (let c = doneCopies + 1; c <= i.qty; c++) {
        items.push({
          id: `${img.name}#${c}`,
          name: img.name.replace(/\.[^.]+$/, '') + (i.qty > 1 ? ` (${c}/${i.qty})` : ''),
          file: img.path, fileName: img.name, folder: f.path,
          order: i.order, urun: i.urun, copy: c,
          w: i.wCm * 10, h: i.hCm * 10,
          lockPortrait: lock.has(i.size.toLowerCase()),
        });
      }
    }
  }
  items.sort((a, b) => (a.order - b.order) || (a.urun - b.urun) || (a.copy - b.copy));
  return { items, bad, newestFolder: newest };
}

function listSheets(root) {
  const out = [];
  for (const f of listDayFolders(root).reverse()) {
    const dir = path.join(f.path, '_Sayfalar');
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir).filter((x) => /^Sayfa-\d+\.psd$/i.test(x)).sort().reverse()) {
      const p = path.join(dir, n);
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(p.replace(/\.psd$/i, '.json'), 'utf8')); } catch { /* yok */ }
      out.push({ name: n.replace(/\.psd$/i, ''), path: p, folder: f.name, meta, mtime: fs.statSync(p).mtimeMs });
    }
  }
  return out;
}

// dosyaAdi -> [{ sheet, path, printedAt }]  (hangi sayfada, basildi mi)
function sheetIndex(root, printed) {
  const idx = new Map();
  for (const s of listSheets(root)) {
    if (!s.meta || !Array.isArray(s.meta.items)) continue;
    for (const it of s.meta.items) {
      if (!it.fileName || it.card) continue;
      if (!idx.has(it.fileName)) idx.set(it.fileName, []);
      const arr = idx.get(it.fileName);
      if (!arr.some((x) => x.path === s.path)) arr.push({ sheet: s.name, folder: s.folder, path: s.path, printedAt: (printed || {})[s.path] || null });
    }
  }
  return idx;
}

function nextSheetNo(outDir) {
  if (!fs.existsSync(outDir)) return 1;
  const nums = fs.readdirSync(outDir).map((n) => (n.match(/^Sayfa-(\d+)\.(psd|json)$/i) || [])[1]).filter(Boolean).map(Number);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function moveToArranged(file) {
  if (!fs.existsSync(file)) return;
  const dir = path.join(path.dirname(file), '_Dizildi');
  fs.mkdirSync(dir, { recursive: true });
  let target = path.join(dir, path.basename(file));
  if (fs.existsSync(target)) target = target.replace(/(\.[^.]+)$/, `-${Date.now()}$1`);
  fs.renameSync(file, target);
}

module.exports = { dayFolderName, orderDayFolderName, listDayFolders, listImages, listOrders, pendingItems, listSheets, sheetIndex, nextSheetNo, moveToArranged, pad };
