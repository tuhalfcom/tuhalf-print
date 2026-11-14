'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, Notification, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { JsonStore } = require('./store');
const { runDownload, fetchOrderDetails, fetchPayStatuses, holdReason } = require('./downloader');
const F = require('./folders');
const { packAll } = require('./packer');
const PS = require('./photoshop');
const { createUpdater } = require('./updater');
const { parseName } = require('./naming');

const ROOT = path.join(__dirname, '..', '..');
const ICON = path.join(ROOT, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const TRAY_ICON = path.join(ROOT, 'build', 'tray.png');
const JSX = (n) => path.join(ROOT, 'src', 'jsx', n);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, tray = null, timer = null, quitting = false;
let config, state, updater;
const logs = [];
const status = { running: false, lastCheck: null, nextCheck: null, lastError: null, job: null };

// ---------------- Ayarlar ----------------
function defaults() {
  return {
    shop: '', clientId: '', clientSecret: '', apiVersion: '2026-10',
    downloadDir: path.join(app.getPath('desktop'), 'BASKI'),
    firstOrderNo: 0, lookbackDays: 10, renderWaitMin: 5, missingWarnMin: 120,
    dayEnd: '18:00', intervalMin: 30, openAtLogin: true,
    colorWords: ['Siyah', 'Beyaz', 'Ahsap', 'Naturel', 'Ceviz', 'Gold', 'Altin', 'Gumus', 'Silver', 'Mese'],
    print: { rollWidthMm: 609.6, maxLengthMm: 720.01, marginMm: 3, gapMm: 1, dpi: 300, portraitLocked: [] },
    card: { enabled: true, file: '', wMm: 0, hMm: 0, maxPerSheet: 0 },
    photoshopPath: '', schema: 3,
  };
}

// Eski PowerShell kurulumundan (Belgeler\tuhalf-baski) ayarlari ve gecmisi al
function importLegacy() {
  const dir = path.join(app.getPath('documents'), 'tuhalf-baski');
  const f = path.join(dir, 'ayarlar.json');
  if (!fs.existsSync(f) || config.data.shop) return false;
  try {
    const a = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
    const b = a.Baski || {};
    config.set({
      shop: a.MagazaAdresi || '', clientId: a.ClientId || '', clientSecret: a.ClientSecret || '',
      apiVersion: a.ApiSurumu || '2026-10',
      downloadDir: String(a.IndirmeKlasoru || '').replace(/%([^%]+)%/g, (m, v) => process.env[v] || m) || config.data.downloadDir,
      firstOrderNo: a.IlkSiparisNo || 0, lookbackDays: a.GeriyeDonukGun || 10,
      renderWaitMin: a.RenderBeklemeDakika || 5, missingWarnMin: a.EksikUyariDakika || 120,
      dayEnd: a.MesaiBitisSaati || '18:00', colorWords: a.RenkKelimeleri || config.data.colorWords,
      print: {
        rollWidthMm: b.RuloGenisligiMm || 610, maxLengthMm: b.MaksUzunlukMm || 720, marginMm: b.KenarBoslukMm ?? 3,
        gapMm: b.AraBoslukMm ?? 0, dpi: b.Dpi || 300, portraitLocked: b.DikKalacakEbatlar || ['30x42', '50x70'],
      },
    });
    const st = path.join(dir, 'veri', 'indirilen-siparisler.txt');
    if (fs.existsSync(st)) {
      const ids = fs.readFileSync(st, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      state.set({ downloaded: Array.from(new Set([...(state.data.downloaded || []), ...ids])) });
    }
    log('ok', 'Eski kurulumdaki ayarlar ve indirme geçmişi aktarıldı.');
    if (process.platform === 'win32') {
      // Eski zamanlanmis gorev ayni dosyalari tekrar indirmesin
      require('child_process').execFile('schtasks', ['/Delete', '/TN', 'Tuhalf Baski Dosyalari', '/F'], (err) => {
        if (err) log('warn', 'Eski "Tuhalf Baski Dosyalari" görevi silinemedi; Görev Zamanlayıcı\'dan elle kaldırın.');
        else log('ok', 'Eski zamanlanmış görev kaldırıldı (artık Tuhalf Print indiriyor).');
      });
    }
    return true;
  } catch (e) { log('error', 'Eski ayarlar okunamadı: ' + e.message); return false; }
}

// ---------------- Log / olaylar ----------------
function log(level, msg) {
  const e = { t: Date.now(), level, msg };
  logs.push(e); if (logs.length > 300) logs.shift();
  try {
    const dir = path.join(app.getPath('userData'), 'log');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, new Date().toISOString().slice(0, 7) + '.log'),
      `${new Date().toLocaleString('tr-TR')}  [${level}] ${msg}\n`);
  } catch { /* */ }
  send('log', e);
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
function pushStatus() { send('status', publicStatus()); }
function publicStatus() { return { ...status, platform: process.platform, version: app.getVersion() }; }
function notify(title, body) { try { if (Notification.isSupported()) new Notification({ title, body, icon: ICON }).show(); } catch { /* */ } }

// ---------------- Odeme durumu (havale bekleyen / iptal siparisler basilmaz) ----------------
function holdOf(no) { return no ? holdReason((state.data.pay || {})[no]) : null; }
function updatePay(list) {
  if (!list || !list.length) return;
  const pay = { ...(state.data.pay || {}) };
  const now = Date.now();
  for (const p of list) {
    if (!p.no) continue;
    const before = holdReason(pay[p.no]);
    pay[p.no] = { cancelled: p.cancelled, financial: p.financial, gateways: p.gateways, shipping: p.shipping, at: now };
    const after = holdReason(pay[p.no]);
    if (before && !after) log('ok', `#${p.no} ödemesi onaylandı, baskı sırasına alındı.`);
  }
  for (const k of Object.keys(pay)) if (now - pay[k].at > 120 * 864e5) delete pay[k];
  state.data.pay = pay; state.save();
}
// Bekletilen siparislerin guncel durumunu Shopify'dan tekrar sor
async function refreshHeld(skip) {
  const root = downloadDir();
  if (!root || !fs.existsSync(root)) return;
  const nos = new Set();
  for (const it of F.pendingItems(root, [], state.data.arranged || {}).items) if (holdOf(it.order) && !(skip && skip.has(it.order))) nos.add(it.order);
  if (nos.size) updatePay(await fetchPayStatuses(config.data, Array.from(nos)));
}

// ---------------- Indirme dongusu ----------------
async function checkNow(opts = {}) {
  if (status.running) return { busy: true };
  status.running = true; status.lastError = null; pushStatus();
  const done = new Set(state.data.downloaded || []);
  try {
    const redo = Number(opts.redownloadFrom) || 0;
    log('info', redo ? `#${redo} ve sonraki siparişler yeniden indiriliyor…` : 'Yeni siparişler kontrol ediliyor…');
    const cfg = redo ? { ...config.data, redownloadFrom: redo, lookbackDays: Math.max(120, config.data.lookbackDays || 0) }
      : { ...config.data, ignoreBefore: state.data.resetAt || 0 };
    const r = await runDownload(cfg, done, log);
    updatePay(r.payments);
    try { await refreshHeld(new Set((r.payments || []).map((p) => p.no))); } catch (e) { log('warn', 'Ödeme durumu kontrol edilemedi: ' + e.message); }
    state.set({ downloaded: Array.from(done).slice(-5000) });
    if (redo) {
      log('ok', `Yeniden indirme bitti: ${r.files.length} dosya indi` + (r.skipped ? `, ${r.skipped} dosya zaten vardı` : '') + (r.files.length ? ` → ${r.folderName}` : '') + '.');
      if (r.files.length) send('refresh');
    } else
    log(r.files.length ? 'ok' : 'info', r.files.length ? `${r.files.length} dosya indi → ${r.folderName}` : 'Yeni baskı dosyası yok.');
    if (r.pending.length) log('info', 'Bekleyen: ' + r.pending.join(', '));
    if (r.files.length) notify('Tuhalf Print', `${r.files.length} yeni baskı dosyası indi`);
    detailCache = null;
    send('refresh');   // odeme durumu degismis olabilir: yeni dosya olmasa da ekranlari yenile
    return r;
  } catch (e) {
    status.lastError = e.message; log('error', e.message);
    return { error: e.message };
  } finally {
    status.running = false; status.lastCheck = Date.now(); schedule(); pushStatus();
  }
}

function schedule() {
  clearTimeout(timer);
  const ms = Math.max(5, config.data.intervalMin) * 60000;
  status.nextCheck = Date.now() + ms;
  timer = setTimeout(checkNow, ms);
}

// ---------------- Yerlesim ----------------
// Ayarlardaki klasor yoksa (or. OneDrive masaustu) gercek masaustundeki BASKI klasorune dus
function downloadDir() {
  const d = config.data.downloadDir;
  if (d && fs.existsSync(d)) return d;
  const alt = path.join(app.getPath('desktop'), 'BASKI');
  return fs.existsSync(alt) ? alt : d;
}
function cardCfg() {
  const c = config.data.card || {};
  if (!c.enabled || !c.file || !fs.existsSync(c.file) || !(c.wMm > 0) || !(c.hMm > 0)) return null;
  return { w: +c.wMm, h: +c.hMm, file: c.file, max: +c.maxPerSheet || 0 };
}
function packCfg() {
  const p = config.data.print;
  return { width: +p.rollWidthMm, maxLength: +p.maxLengthMm, margin: +p.marginMm, gap: Math.max(1, +p.gapMm || 0), card: cardCfg() };
}
function plan(force) {
  const all = F.pendingItems(downloadDir(), config.data.print.portraitLocked, state.data.arranged || {});
  const { bad, newestFolder } = all;
  const held = [], items = [];
  for (const it of all.items) { const h = holdOf(it.order); if (h) held.push({ name: it.name, fileName: it.fileName, order: it.order, reason: h }); else items.push(it); }
  const res = packAll(items, packCfg(), { force: !!force });
  const sheets = res.sheets.map((s) => ({
    widthMm: s.width, lengthMm: s.length, cards: s.cards || 0,
    items: s.items.map((p) => ({ name: p.item.name, file: p.item.file, fileName: p.item.fileName || '', order: p.item.order || '',
      card: !!p.item.isCard, xMm: p.x, yMm: p.y, wMm: p.w, hMm: p.h, rotated: p.rotated,
      sizeLabel: p.item.isCard ? 'Kart' : `${p.item.w / 10}x${p.item.h / 10}` })),
  }));
  return {
    sheets, skipped: res.skipped.map((i) => i.name), waiting: res.waiting.map((i) => i.name), waitingFiles: res.waiting.map((i) => i.fileName), bad, newestFolder,
    held, count: items.length, placed: sheets.reduce((a, s) => a + s.items.filter((i) => !i.card).length, 0), force: !!force,
  };
}

async function buildSheets(force) {
  if (status.job) throw new Error('Başka bir işlem sürüyor.');
  const pl = plan(force);
  if (!pl.sheets.length) return { sheets: [], waiting: pl.waiting.length };
  const outDir = path.join(pl.newestFolder, '_Sayfalar');
  fs.mkdirSync(outDir, { recursive: true });
  let no = F.nextSheetNo(outDir);
  const jobSheets = pl.sheets.map((s) => {
    const title = `Sayfa-${F.pad(no++)}`;
    return { ...s, title, out: path.join(outDir, title + '.psd') };
  });
  status.job = { kind: 'build', done: 0, total: jobSheets.reduce((a, s) => a + s.items.length, 0), label: 'Photoshop başlatılıyor…' };
  pushStatus();
  try {
    const job = {
      dpi: config.data.print.dpi, keepOpen: true,
      sheets: jobSheets.map((s) => ({ title: s.title, out: s.out, widthMm: s.widthMm, lengthMm: s.lengthMm,
        items: s.items.map((i) => ({ src: i.file, name: i.name, xMm: i.xMm, yMm: i.yMm,
          wMm: i.rotated ? i.hMm : i.wMm, hMm: i.rotated ? i.wMm : i.hMm, rotated: i.rotated, card: i.card })) })),
    };
    const res = await PS.runJob(config.data.photoshopPath, JSX('build.jsx'), job, (d, t, l) => {
      status.job = { ...status.job, done: d, total: t, label: l }; pushStatus();
    });
    if (!res.ok) throw new Error('Photoshop hatası: ' + res.error);
    const okTitles = new Set(res.sheets.filter((s) => s.ok).map((s) => s.title));
    // Cok adetli dosyalar: tum kopyalari dizilince _Dizildi klasorune tasinir
    const arranged = { ...(state.data.arranged || {}) };
    const files = new Map();
    for (const s of jobSheets) {
      const r = res.sheets.find((x) => x.title === s.title);
      fs.writeFileSync(s.out.replace(/\.psd$/i, '.json'), JSON.stringify({ title: s.title, widthMm: s.widthMm, lengthMm: s.lengthMm,
        created: Date.now(), items: s.items.map(({ file, ...rest }) => rest), errors: r ? r.errors : ['sonuc yok'] }, null, 2));
      if (okTitles.has(s.title)) for (const it of s.items) {
        if (it.card) continue;
        arranged[it.fileName] = (arranged[it.fileName] || 0) + 1;
        files.set(it.fileName, it.file);
      }
    }
    for (const [name, file] of files) {
      const info = parseName(name);
      if (!info || arranged[name] >= info.qty) { F.moveToArranged(file); delete arranged[name]; }
    }
    state.data.arranged = arranged; state.save();
    for (const s of res.sheets) if (!s.ok) log('error', `${s.title}: ${s.errors.join('; ')}`);
    log('ok', `${okTitles.size} sayfa PSD olarak hazır, Photoshop'ta açık. Kontrol edip Print'e basın.`);
    if (pl.waiting.length) log('info', `Bekleyen ${pl.waiting.length} tasarım sonraki siparişlerle dizilecek: ${pl.waiting.join(', ')}`);
    notify('Tuhalf Print', `${okTitles.size} baskı sayfası hazır`);
    return res;
  } finally { status.job = null; pushStatus(); send('refresh'); }
}

async function printSheets(paths) {
  if (status.job) throw new Error('Başka bir işlem sürüyor.');
  // Sayfa hazirlandiktan sonra iptal edilen / odemesi geri cekilen siparis varsa o sayfa basilmaz
  paths = paths.filter((p) => {
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(p.replace(/\.psd$/i, '.json'), 'utf8')); } catch { return true; }
    const bad = [...new Set((meta.items || []).filter((i) => !i.card && holdOf(Number(i.order))).map((i) => `#${i.order} (${holdOf(Number(i.order))})`))];
    if (bad.length) log('warn', `${path.basename(p)} basılmadı: ${bad.join(', ')}. Sayfayı Photoshop'ta düzeltip elle basabilirsiniz.`);
    return !bad.length;
  });
  if (!paths.length) return { files: [] };
  status.job = { kind: 'print', done: 0, total: paths.length, label: 'Photoshop başlatılıyor…' }; pushStatus();
  try {
    const res = await PS.runJob(config.data.photoshopPath, JSX('print.jsx'), { files: paths }, (d, t, l) => {
      status.job = { ...status.job, done: d, total: t, label: 'Yazdırılıyor: ' + l }; pushStatus();
    });
    const printed = { ...(state.data.printed || {}) };
    for (const f of res.files) {
      if (f.ok) { printed[f.path] = Date.now(); log('ok', 'Yazdırıldı: ' + path.basename(f.path)); }
      else log('error', `${path.basename(f.path)} yazdırılamadı: ${f.error}`);
    }
    state.set({ printed });
    return res;
  } finally { status.job = null; pushStatus(); send('refresh'); }
}

// ---------------- Kucuk resimler ----------------
function thumb(file) {
  try {
    const st = fs.statSync(file);
    const key = crypto.createHash('md5').update(path.basename(file) + st.size).digest('hex');
    const dir = path.join(app.getPath('userData'), 'thumbs');
    const out = path.join(dir, key + '.jpg');
    if (!fs.existsSync(out)) {
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) return null;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(out, img.resize({ width: 360, quality: 'good' }).toJPEG(82));
    }
    return out;
  } catch { return null; }
}

// ---------------- IPC ----------------
function safeConfig() { const c = { ...config.data }; c.clientSecret = c.clientSecret ? '••••••••' : ''; return c; }

ipcMain.handle('init', () => ({ config: safeConfig(), status: publicStatus(), logs, photoshop: PS.findPhotoshop(config.data.photoshopPath), update: updater.status() }));
ipcMain.handle('update-check', () => updater.check(true));
ipcMain.handle('update-install', () => updater.install());
ipcMain.handle('orders', () => {
  const root = downloadDir();
  const exists = !!root && fs.existsSync(root);
  const groups = exists ? F.listOrders(root, 7) : [];
  const idx = F.sheetIndex(root, state.data.printed);
  const arranged = state.data.arranged || {};
  if (!state.data.ordersSeenAt) { state.data.ordersSeenAt = Date.now(); state.save(); }
  const seenAt = state.data.ordersSeenAt;
  let waiting = new Set();
  try { if (exists) waiting = new Set(plan(false).waitingFiles); } catch { /* */ }
  for (const g of groups) for (const f of g.files) {
    f.waiting = f.status === 'pending' && waiting.has(f.name);
    f.thumb = thumb(f.path);
    f.isNew = f.mtime > seenAt;
    f.hold = f.status === 'pending' ? holdOf(f.info && f.info.order) : null;
    const sh = idx.get(f.name) || [];
    const qty = (f.info && f.info.qty) || 1;
    const allPlaced = f.status === 'arranged';
    f.sheets = sh.map((x) => ({ name: x.sheet, printed: !!x.printedAt, path: x.path }));
    f.printed = allPlaced && sh.length > 0 && sh.every((x) => x.printedAt);
    f.printedAt = f.printed ? Math.max(...sh.map((x) => x.printedAt)) : null;
    f.partial = !allPlaced && (arranged[f.name] || 0) > 0 ? `${arranged[f.name]}/${qty} dizildi` : '';
  }
  const newCount = groups.reduce((a, g) => a + g.files.filter((f) => f.isNew).length, 0);
  return { root, exists, groups, newCount };
});
ipcMain.handle('plan', (_e, force) => {
  const p = plan(force);
  for (const s of p.sheets) for (const i of s.items) i.thumb = thumb(i.file);
  return p;
});
ipcMain.handle('sheets', () => {
  const thumbs = new Map();
  for (const g of F.listOrders(downloadDir(), 30)) for (const f of g.files) thumbs.set(f.name, f.path);
  return F.listSheets(downloadDir()).slice(0, 40).map((s) => {
    const cardThumb = config.data.card && config.data.card.file && fs.existsSync(config.data.card.file) ? thumb(config.data.card.file) : null;
    if (s.meta) for (const i of s.meta.items) { if (i.card) { i.thumb = cardThumb; continue; } const p = thumbs.get(i.fileName); i.thumb = p ? thumb(p) : null; }
    return { ...s, printedAt: (state.data.printed || {})[s.path] || null };
  });
});
ipcMain.handle('check-now', () => checkNow());
// ---------- Siparisler sayfasi ----------
let detailCache = null; // { at, data }
ipcMain.handle('orders-seen', () => { state.data.ordersSeenAt = Date.now(); state.save(); return true; });
ipcMain.handle('orders-detail', async (_e, force) => {
  const root = downloadDir();
  // Yerel dosyalar: siparis no -> dosyalar ve baski durumu
  const local = new Map();
  if (root && fs.existsSync(root)) {
    const idx = F.sheetIndex(root, state.data.printed);
    for (const g of F.listOrders(root, 30)) for (const f of g.files) {
      const no = f.info && f.info.order; if (!no) continue;
      const sh = idx.get(f.name) || [];
      const printed = f.status === 'arranged' && sh.length > 0 && sh.every((x) => x.printedAt);
      if (!local.has(no)) local.set(no, { files: [], folder: g.path });
      local.get(no).files.push({ name: f.name, path: f.path, size: f.info.size, color: f.info.color, qty: f.info.qty, printed, sheets: sh.map((x) => x.sheet), isNew: f.mtime > (state.data.ordersSeenAt || Infinity) });
    }
  }
  let remote = null, error = null, pii = true;
  const c = config.data;
  if (c.shop && c.clientId && c.clientSecret) {
    try {
      if (force || !detailCache || Date.now() - detailCache.at > 60000) detailCache = { at: Date.now(), data: await fetchOrderDetails(c, 14) };
      remote = detailCache.data.orders; pii = detailCache.data.pii;
    } catch (e) { error = e.message; }
  } else error = 'Shopify bilgileri girilmemiş; sadece indirilen dosyalar gösteriliyor.';
  const rows = new Map();
  if (remote) updatePay(remote);
  for (const o of remote || []) rows.set(o.no, { ...o, hold: holdReason(o), local: local.get(o.no) || null });
  for (const [no, l] of local) if (!rows.has(no)) rows.set(no, { no, hold: holdOf(no), name: '', createdAt: null, financial: '', fulfillment: '', gateways: [], shipping: '', total: null, currency: '', items: [], local: l, onlyLocal: true });
  const list = Array.from(rows.values()).sort((a, b) => b.no - a.no);
  return { rows: list, error, pii, fetchedAt: detailCache ? detailCache.at : null };
});

// ---------- Sifirlama: programin olusturdugu klasor ve dosyalari kalici sil ----------
ipcMain.handle('reset-files', async () => {
  if (status.job || status.running) return { error: 'Şu an bir işlem sürüyor, bitince tekrar deneyin.' };
  const root = downloadDir();
  const days = root && fs.existsSync(root) ? F.listDayFolders(root) : [];
  let files = 0;
  const count = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) count(p); else files++; } };
  for (const d of days) try { count(d.path); } catch { /* */ }
  const r = await dialog.showMessageBox(win, {
    type: 'warning', title: 'Dosyaları resetle', noLink: true, defaultId: 0, cancelId: 0,
    buttons: ['İptal', 'Kalıcı olarak sil'],
    message: days.length ? `${days.length} sipariş klasörü ve içindeki ${files} dosya kalıcı olarak silinecek.` : 'Silinecek sipariş klasörü yok. İndirme ve baskı geçmişi sıfırlanacak.',
    detail: `Klasör: ${root}\nİndirilen dosyalar, dizilmiş kaynaklar ve hazırlanmış PSD sayfaları silinir; indirme ve baskı geçmişi sıfırlanır. Bu işlem geri alınamaz.\n\nSonra Tercihler > Sıfırlama'dan "Yeniden indir" ile istediğin siparişten itibaren temiz başlayabilirsin. O zamana kadar sadece yeni gelen siparişler otomatik iner.`,
  });
  if (r.response !== 1) return { canceled: true };
  const failed = [];
  for (const d of days) { try { fs.rmSync(d.path, { recursive: true, force: true }); } catch (e) { failed.push(d.name); } }
  try { if (fs.existsSync(root) && !fs.readdirSync(root).length) fs.rmdirSync(root); } catch { /* */ }
  try { fs.rmSync(path.join(app.getPath('userData'), 'thumbs'), { recursive: true, force: true }); } catch { /* */ }
  state.data.downloaded = []; state.data.arranged = {}; state.data.printed = {};
  state.data.resetAt = Date.now(); state.data.ordersSeenAt = Date.now();
  state.save(); detailCache = null;
  if (failed.length) log('warn', `Bazı klasörler silinemedi (açık olabilir): ${failed.join(', ')}`);
  log('ok', `Sıfırlandı: ${days.length - failed.length} klasör, ${files} dosya silindi. İndirme ve baskı geçmişi temizlendi.`);
  send('refresh');
  return { ok: true, folders: days.length - failed.length, files, failed };
});

ipcMain.handle('open-in-ps', (_e, p) => {
  if (!p || !fs.existsSync(p)) return { error: 'Dosya bulunamadı.' };
  const exe = PS.findPhotoshop(config.data.photoshopPath);
  if (!exe) { shell.openPath(p); return { error: 'Photoshop bulunamadı, dosya varsayılan programla açıldı.' }; }
  const { spawn } = require('child_process');
  if (process.platform === 'darwin') spawn('open', ['-a', exe, p], { detached: true, stdio: 'ignore' }).unref();
  else spawn(exe, [p], { detached: true, stdio: 'ignore' }).unref();
  log('info', `${path.basename(p)} Photoshop'ta açılıyor…`);
  return { ok: true };
});
ipcMain.handle('redownload', (_e, from) => {
  const n = parseInt(from, 10);
  if (!(n > 0)) return { error: 'Geçerli bir sipariş numarası girin.' };
  return checkNow({ redownloadFrom: n });
});
ipcMain.handle('build', async (_e, force) => { try { return await buildSheets(force); } catch (e) { log('error', e.message); return { error: e.message }; } });
ipcMain.handle('print', async (_e, paths) => { try { return await printSheets(paths); } catch (e) { log('error', e.message); return { error: e.message }; } });
ipcMain.handle('mark-printed', (_e, p, on) => {
  const printed = { ...(state.data.printed || {}) };
  if (on) printed[p] = Date.now(); else delete printed[p];
  state.data.printed = printed; state.save();
  log('ok', `${path.basename(p)} ${on ? 'basıldı olarak işaretlendi' : 'basılmadı olarak işaretlendi'}.`);
  send('refresh');
  return true;
});
ipcMain.handle('pick-card', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Kart tasarımı', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'psd'] }] });
  if (r.canceled) return null;
  const src = r.filePaths[0];
  const dir = path.join(app.getPath('userData'), 'kart');
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, 'tesekkur-karti' + path.extname(src).toLowerCase());
  for (const f of fs.readdirSync(dir)) if (f.startsWith('tesekkur-karti')) try { fs.unlinkSync(path.join(dir, f)); } catch { /* */ }
  fs.copyFileSync(src, dst);
  const out = { file: dst, name: path.basename(src) };
  const img = nativeImage.createFromPath(dst);
  if (!img.isEmpty()) {
    const { width, height } = img.getSize();
    const dpi = config.data.print.dpi || 300;
    out.wMm = Math.round((width / dpi) * 254) / 10; out.hMm = Math.round((height / dpi) * 254) / 10;
  }
  config.set({ card: { ...config.data.card, file: dst, ...(out.wMm ? { wMm: out.wMm, hMm: out.hMm } : {}) } });
  log('ok', `Teşekkür kartı yüklendi: ${out.name}` + (out.wMm ? ` (${out.wMm} x ${out.hMm} mm @ ${config.data.print.dpi} dpi)` : ''));
  send('refresh');
  return { config: safeConfig(), card: out };
});
ipcMain.handle('card-thumb', () => { const c = config.data.card; return c && c.file && fs.existsSync(c.file) ? thumb(c.file) : null; });
ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('show-item', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('save-config', (_e, patch) => {
  if (patch.clientSecret === '••••••••') delete patch.clientSecret;
  config.set(patch);
  app.setLoginItemSettings({ openAtLogin: !!config.data.openAtLogin, args: ['--hidden'] });
  schedule(); pushStatus(); send('refresh');
  return { config: safeConfig(), photoshop: PS.findPhotoshop(config.data.photoshopPath) };
});
ipcMain.handle('pick', async (_e, kind) => {
  const r = kind === 'folder'
    ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog(win, { properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'Photoshop', extensions: ['exe'] }] : [] });
  return r.canceled ? null : r.filePaths[0];
});

// ---------------- Pencere / tepsi ----------------
function createWindow(show) {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, show: false,
    backgroundColor: '#1e1e1e', title: 'Tuhalf Print', icon: ICON,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#1e1e1e', symbolColor: '#d6d6d6', height: 34 } } : {}),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'renderer', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}
function showWindow() { if (!win) createWindow(true); win.show(); win.focus(); }

function createTray() {
  let img = nativeImage.createFromPath(TRAY_ICON);
  if (process.platform === 'darwin') img = img.resize({ width: 18, height: 18 });
  tray = new Tray(img);
  tray.setToolTip('Tuhalf Print');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Tuhalf Print\'i aç', click: showWindow },
    { label: 'Şimdi kontrol et', click: () => checkNow() },
    { label: 'Güncellemeleri kontrol et', click: () => { showWindow(); updater.check(true); } },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; });
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.tuhalf.print');
  config = new JsonStore(path.join(app.getPath('userData'), 'config.json'), defaults());
  state = new JsonStore(path.join(app.getPath('userData'), 'state.json'), { downloaded: [], printed: {} });
  importLegacy();
  // Ayar gecisi: dosyada kayitli surume bakilir (varsayilanlarla birlesmis veriye degil)
  const savedSchema = Number(config._read().schema) || 1;
  if (savedSchema < 3) {
    const pr = config.data.print;
    config.set({ schema: 3, print: {
      ...pr, rollWidthMm: 609.6, maxLengthMm: 720.01, gapMm: Math.max(1, Number(pr.gapMm) || 0),
      ...(savedSchema < 2 ? { portraitLocked: [] } : {}),
    } });
    log('info', 'Baskı ayarları güncellendi: sayfa 609,6 x 720,01 mm, tasarımlar arası en az 1 mm.');
  }
  updater = createUpdater({
    log, send, notify,
    isBusy: () => !!status.job,
    beforeInstall: () => { quitting = true; clearTimeout(timer); if (tray) tray.destroy(); },
  });
  app.setLoginItemSettings({ openAtLogin: !!config.data.openAtLogin, args: ['--hidden'] });
  createWindow(!process.argv.includes('--hidden'));
  createTray();
  schedule();
  setTimeout(checkNow, 4000);
  updater.start();
});
