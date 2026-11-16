'use strict';
// Ortak durum: birden fazla bilgisayar ayni (paylasilan) BASKI klasorunu kullandiginda
// "basildi", "fis yazdirildi", "indirildi" ve "dizildi" bilgileri bu klasordeki tek bir dosyada tutulur.
// Tek bilgisayarda da ayni sekilde calisir; ileride bilgisayar eklenince hicbir sey degismeden ortaklasir.
const fs = require('fs');
const path = require('path');

const DIR = '.tuhalf';
const FILE = 'ortak-durum.json';
const DAY = 864e5;

const fileOf = (root) => path.join(root, DIR, FILE);
const relOf = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const absOf = (root, rel) => path.join(root, ...String(rel).split('/'));

function read(root) {
  try { return JSON.parse(fs.readFileSync(fileOf(root), 'utf8')); } catch { return {}; }
}
function mtime(root) { try { return fs.statSync(fileOf(root)).mtimeMs; } catch { return 0; } }

function write(root, data) {
  fs.mkdirSync(path.join(root, DIR), { recursive: true });
  const f = fileOf(root);
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  let last;
  for (let i = 0; i < 8; i++) {
    try { fs.renameSync(tmp, f); return; } catch (e) { last = e; const until = Date.now() + 60; while (Date.now() < until) { /* kisa bekle (ag klasoru mesgul) */ } }
  }
  try { fs.unlinkSync(tmp); } catch { /* */ }
  throw last;
}

// Saf birlestirme (test edilebilir). L: bu bilgisayarin yerel durumu. S: ortak dosya.
// L = { downloaded:[id], printed:{abs:at}, printedOff:{abs:at}, labels:{key:at}, arranged:{name:n}, arrangedAt }
function merge(S0, L, { root, station, roles, version, now = Date.now() }) {
  const S = { v: 1, downloaded: {}, printed: {}, labels: {}, arranged: null, stations: {}, ...JSON.parse(JSON.stringify(S0 || {})) };
  // indirilen siparisler: birlesim
  for (const id of L.downloaded || []) if (!S.downloaded[id]) S.downloaded[id] = now;
  for (const [id, at] of Object.entries(S.downloaded)) if (now - at > 150 * DAY) delete S.downloaded[id];
  // basilan sayfalar: anahtar = BASKI'ya gore goreli yol; en son degisiklik kazanir
  const put = (abs, on, at) => {
    const rel = relOf(root, abs);
    const cur = S.printed[rel];
    if (!cur || cur.at < at) S.printed[rel] = { on, at, by: station };
  };
  for (const [abs, at] of Object.entries(L.printed || {})) put(abs, true, Number(at) || now);
  for (const [abs, at] of Object.entries(L.printedOff || {})) put(abs, false, Number(at) || now);
  for (const [rel, e] of Object.entries(S.printed)) if (now - e.at > 120 * DAY) delete S.printed[rel];
  // kargo fisleri
  const putL = (k, on, at) => { const cur = S.labels[k]; if (!cur || cur.at < at) S.labels[k] = { on, at, by: station }; };
  for (const [k, at] of Object.entries(L.labels || {})) putL(k, true, Number(at) || now);
  for (const [k, at] of Object.entries(L.labelsOff || {})) putL(k, false, Number(at) || now);
  for (const [k, e] of Object.entries(S.labels)) if (now - e.at > 90 * DAY) delete S.labels[k];
  // dizilen dosyalar: en son hazirlayan bilgisayarin listesi gecerli
  if (L.arrangedAt && (!S.arranged || S.arranged.at < L.arrangedAt)) S.arranged = { map: L.arranged || {}, at: L.arrangedAt, by: station };
  S.stations[station] = { seen: now, roles: roles || {}, version: version || '' };
  for (const [n, st] of Object.entries(S.stations)) if (now - st.seen > 60 * DAY) delete S.stations[n];

  // ortak dosyadan yerel duruma
  const out = {
    downloaded: Object.keys(S.downloaded),
    printed: {}, printedOff: {}, printedBy: {},
    labels: {}, labelsOff: {}, labelsBy: {},
    arranged: S.arranged ? S.arranged.map : (L.arranged || {}),
    arrangedAt: S.arranged ? S.arranged.at : (L.arrangedAt || 0),
  };
  for (const [rel, e] of Object.entries(S.printed)) {
    const abs = absOf(root, rel);
    if (e.on) { out.printed[abs] = e.at; out.printedBy[abs] = e.by; } else if (now - e.at < 30 * DAY) out.printedOff[abs] = e.at;
  }
  for (const [k, e] of Object.entries(S.labels)) { if (e.on === false) { if (now - e.at < 30 * DAY) out.labelsOff[k] = e.at; } else { out.labels[k] = e.at; out.labelsBy[k] = e.by; } }
  return { S, L: out };
}

// Kilit: ayni anda tek bilgisayar sayfa hazirlasin (Photoshop isi)
function lock(root, name, station, ttlMs = 20 * 60000) {
  const f = path.join(root, DIR, `kilit-${name}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const body = JSON.stringify({ by: station, at: Date.now() });
  try { fs.writeFileSync(f, body, { flag: 'wx' }); return { ok: true }; } catch { /* var */ }
  let cur = null; try { cur = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* bozuk */ }
  if (!cur || cur.by === station || Date.now() - (cur.at || 0) > ttlMs) { fs.writeFileSync(f, body); return { ok: true }; }
  return { ok: false, by: cur.by, at: cur.at };
}
function unlock(root, name, station) {
  const f = path.join(root, DIR, `kilit-${name}.json`);
  try { const cur = JSON.parse(fs.readFileSync(f, 'utf8')); if (cur.by === station) fs.unlinkSync(f); } catch { /* */ }
}

module.exports = { read, write, merge, mtime, lock, unlock, relOf, absOf, fileOf };
