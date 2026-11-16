'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, Notification, nativeImage, powerMonitor } = require('electron');
// Ag istekleri asla sonsuza kadar beklemesin (bilgisayar uykudan donunce ya da internet kopunca
// asili kalan bir istek otomatik kontrolu durduruyordu). Kendi suresi verilmeyen istekler 60 sn'de kesilir.
{
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, opts = {}) => nativeFetch(url, opts.signal ? opts : { ...opts, signal: AbortSignal.timeout(60000) });
}
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { JsonStore } = require('./store');
const { runDownload, fetchOrderDetails, fetchPayStatuses, holdReason, fetchOrderAddresses } = require('./downloader');
const F = require('./folders');
const { packAll } = require('./packer');
const PS = require('./photoshop');
const { createUpdater } = require('./updater');
const { parseName } = require('./naming');
const K = require('./kargo');
const Shared = require('./shared');

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
    dayEnd: '18:00', intervalMin: 5, openAtLogin: true,
    colorWords: ['Siyah', 'Beyaz', 'Ahsap', 'Naturel', 'Ceviz', 'Gold', 'Altin', 'Gumus', 'Silver', 'Mese'],
    print: { rollWidthMm: 609.6, maxLengthMm: 720.01, marginMm: 3, gapMm: 1, dpi: 300, portraitLocked: [] },
    card: { enabled: true, file: '', wMm: 0, hMm: 0, maxPerSheet: 0 },
    kargo: { geliverToken: '', codUrl: 'https://tuhalf-etiket.tuhalfcom.workers.dev', codKey: '', printer: '', days: 14 },
    photoshopPath: '', schema: 4,
    station: '', roles: { download: true }, sound: true,
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

// ---------------- Uygulama ici onay penceresi (Windows kutusu yerine kendi tasarimimiz) ----------------
let askSeq = 0;
const askWait = new Map();
function ask(o) {
  if (!win || win.isDestroyed()) return dialog.showMessageBox(o);
  const id = ++askSeq;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  return new Promise((resolve) => {
    askWait.set(id, resolve);
    win.webContents.send('ask', { id, type: o.type || 'info', title: o.title || '', message: o.message || '', detail: o.detail || '', buttons: o.buttons || ['Tamam'], defaultId: o.defaultId ?? 0, cancelId: o.cancelId ?? 0, danger: !!o.danger });
  });
}
ipcMain.on('ask-reply', (_e, id, response) => { const r = askWait.get(id); if (r) { askWait.delete(id); r({ response }); } });

// ---------------- Indirme dongusu ----------------
const RUN_LIMIT_MS = 15 * 60000;
let retryIn = 0;   // bir kontrol bundan uzun surerse takilmis sayilir
async function checkNow(opts = {}) {
  if (status.running && Date.now() - (status.runStart || 0) < RUN_LIMIT_MS) return { busy: true };
  if (status.running) log('warn', 'Önceki kontrol yanıt vermedi; yeniden başlatılıyor.');
  const runId = (status.runId || 0) + 1;
  status.running = true; status.runId = runId; status.runStart = Date.now(); status.lastError = null; pushStatus();
  syncShared();
  const done = new Set(state.data.downloaded || []);
  try {
    const redo = Number(opts.redownloadFrom) || 0;
    if (!redo && config.data.roles && config.data.roles.download === false) {
      // Bu bilgisayar indirme yapmiyor (indirmeyi ana bilgisayar yapar); ortak klasordeki dosyalari kullanir
      try { await refreshHeld(); } catch { /* */ }
      log('info', 'Bu bilgisayar indirme yapmıyor; ortak klasördeki dosyalar kullanılıyor.');
      send('refresh');
      return { files: [], pending: [], skippedRole: true };
    }
    log('info', redo ? `#${redo} ve sonraki siparişler yeniden indiriliyor…` : 'Yeni siparişler kontrol ediliyor…');
    const cfg = redo ? { ...config.data, redownloadFrom: redo, redownloadOnly: opts.only || 0, lookbackDays: Math.max(120, config.data.lookbackDays || 0) }
      : { ...config.data, ignoreBefore: state.data.resetAt || 0 };
    const r = await runDownload(cfg, done, log);
    retryIn = r.retryInMs || 0;   // yeni siparisin dosyasi hazir olunca beklemeden tekrar bak
    updatePay(r.payments);
    try { await refreshHeld(new Set((r.payments || []).map((p) => p.no))); } catch (e) { log('warn', 'Ödeme durumu kontrol edilemedi: ' + e.message); }
    state.set({ downloaded: Array.from(done).slice(-8000) });
    syncShared();
    if (redo) {
      log('ok', `Yeniden indirme bitti: ${r.files.length} dosya indi` + (r.skipped ? `, ${r.skipped} dosya zaten vardı` : '') + (r.files.length ? ` → ${r.folderName}` : '') + '.');
      if (r.files.length) send('refresh');
    } else
    log(r.files.length ? 'ok' : 'info', r.files.length ? `${r.files.length} dosya indi → ${r.folderName}` : 'Yeni baskı dosyası yok.');
    if (r.pending.length) log('info', 'Bekleyen: ' + r.pending.join(', '));
    if (r.files.length) notify('Tuhalf Print', `${r.files.length} yeni baskı dosyası indi`);
    detailCache = null;
    send('refresh');   // odeme durumu degismis olabilir: yeni dosya olmasa da ekranlari yenile
    const kk = config.data.kargo || {};
    if (kk.geliverToken || kk.codKey) loadKargo(true).then(() => send('kargo-updated')).catch(() => {});
    return r;
  } catch (e) {
    status.lastError = e.message; log('error', e.message);
    return { error: e.message };
  } finally {
    if (status.runId === runId) { status.running = false; status.lastCheck = Date.now(); schedule(); pushStatus(); }
  }
}

function schedule() {
  clearTimeout(timer);
  let ms = Math.max(5, config.data.intervalMin) * 60000;
  if (retryIn > 0) { ms = Math.min(ms, Math.max(30000, retryIn)); retryIn = 0; }
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
// ---------- Ortak durum (cok bilgisayar) ----------
const stationName = () => (config.data.station || os.hostname() || 'Bilgisayar').trim();
let sharedCache = null, sharedMtime = 0, sharedWarnAt = 0;
function syncShared() {
  const root = downloadDir();
  if (!root || !fs.existsSync(root)) return false;
  const sig = () => JSON.stringify([state.data.printed, state.data.labelsPrinted, state.data.arranged, (state.data.downloaded || []).length]);
  try {
    const before = sig();
    const L = { downloaded: state.data.downloaded || [], printed: state.data.printed || {}, printedOff: state.data.printedOff || {},
      labels: state.data.labelsPrinted || {}, labelsOff: state.data.labelsOff || {}, arranged: state.data.arranged || {}, arrangedAt: state.data.arrangedAt || 0 };
    const { S, L: out } = Shared.merge(Shared.read(root), L, { root, station: stationName(), roles: config.data.roles || {}, version: app.getVersion() });
    Shared.write(root, S);
    sharedMtime = Shared.mtime(root); sharedCache = S;
    Object.assign(state.data, { downloaded: out.downloaded.slice(-8000), printed: out.printed, printedOff: out.printedOff, printedBy: out.printedBy,
      labelsPrinted: out.labels, labelsOff: out.labelsOff, labelsBy: out.labelsBy, arranged: out.arranged, arrangedAt: out.arrangedAt });
    state.save();
    return before !== sig();
  } catch (e) {
    if (Date.now() - sharedWarnAt > 30 * 60000) { sharedWarnAt = Date.now(); log('warn', 'Ortak durum dosyası güncellenemedi: ' + e.message); }
    return false;
  }
}
// Diger bilgisayarlarin degisikliklerini yakala (ortak dosya degistiyse)
setInterval(() => {
  const root = downloadDir();
  if (!root || !fs.existsSync(root)) return;
  const m = Shared.mtime(root);
  if (m && m !== sharedMtime && syncShared()) { kargoCache = null; send('refresh'); send('kargo-updated'); }
}, 20000);

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
  const root = downloadDir();
  const lk = Shared.lock(root, 'sayfa-hazirlama', stationName());
  if (!lk.ok) throw new Error(`Şu an “${lk.by}” bilgisayarı sayfa hazırlıyor. Bitince tekrar deneyin (aynı tasarım iki kez dizilmesin diye).`);
  try { syncShared(); return await buildSheetsInner(force); } finally { Shared.unlock(root, 'sayfa-hazirlama', stationName()); }
}
async function buildSheetsInner(force) {
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
    state.data.arranged = arranged; state.data.arrangedAt = Date.now(); state.save();
    syncShared();
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
    syncShared();
    const printed = { ...(state.data.printed || {}) };
    const off = { ...(state.data.printedOff || {}) };
    for (const f of res.files) {
      if (f.ok) { printed[f.path] = Date.now(); delete off[f.path]; log('ok', 'Yazdırıldı: ' + path.basename(f.path)); }
      else log('error', `${path.basename(f.path)} yazdırılamadı: ${f.error}`);
    }
    state.data.printed = printed; state.data.printedOff = off; state.save();
    syncShared();
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
const MASK = '••••••••';
function safeConfig() {
  const c = { ...config.data, kargo: { ...(config.data.kargo || {}) } };
  c.clientSecret = c.clientSecret ? MASK : '';
  c.kargo.geliverToken = c.kargo.geliverToken ? MASK : '';
  c.kargo.codKey = c.kargo.codKey ? MASK : '';
  return c;
}

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
    return { ...s, printedAt: (state.data.printed || {})[s.path] || null, printedBy: (state.data.printedBy || {})[s.path] || '' };
  });
});
ipcMain.handle('check-now', () => checkNow());
// Siparis detay paneli: tek sipariste dosyalar, sayfalar, odeme, kargo ve adres bir arada
ipcMain.handle('order-info', async (_e, no) => {
  no = Number(no);
  const root = downloadDir();
  const out = { no, files: [], sheets: [], pay: (state.data.pay || {})[no] || null, hold: holdOf(no), order: null, cod: null, geliver: null, addrError: null, admin: '' };
  try {
    if (root && fs.existsSync(root)) {
      const idx = F.sheetIndex(root, state.data.printed);
      const seen = new Set();
      for (const g of F.listOrders(root, 90)) for (const f of g.files) {
        if (!f.info || f.info.order !== no) continue;
        out.files.push({ name: f.name, path: f.path, folder: g.name, size: f.info.size, color: f.info.color, qty: f.info.qty, status: f.status, thumb: thumb(f.path) });
        for (const sh of idx.get(f.name) || []) if (!seen.has(sh.path)) { seen.add(sh.path); out.sheets.push({ ...sh, printedBy: (state.data.printedBy || {})[sh.path] || '' }); }
      }
    }
  } catch (e) { out.fileError = e.message; }
  if (detailCache) out.order = (detailCache.data.orders || []).find((o) => o.no === no) || null;
  if (out.order) out.admin = shopAdminOrder(out.order.gid);
  // Gonderim adresi (Shopify'daki guncel hali)
  if (out.order && out.order.gid) { try { const a = await fetchOrderAddresses(config.data, [out.order.gid]); out.address = Object.values(a)[0] || null; } catch { /* */ } }
  try {
    const k = await loadKargo(false);
    out.cod = (k.cod || []).find((r) => Number(r.no) === no) || null;
    out.geliver = (k.geliver || []).find((r) => Number(r.no) === no) || null;
    out.addrError = (k.errors || []).find((r) => Number(r.no) === no) || null;
    if (!out.admin) out.admin = (out.cod && out.cod.admin) || (out.geliver && out.geliver.admin) || '';
  } catch { /* kargo yok */ }
  return out;
});
ipcMain.handle('redownload-one', (_e, no) => {
  const n = parseInt(no, 10);
  if (!(n > 0)) return { error: 'Geçersiz sipariş no' };
  return checkNow({ redownloadFrom: n, only: n });
});
// Gun ozeti (Bugun sayfasi)
ipcMain.handle('day-summary', () => {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t0 = d0.getTime();
  const root = downloadDir();
  let files = 0;
  try { if (root && fs.existsSync(root)) for (const g of F.listOrders(root, 3)) for (const f of g.files) if (f.mtime >= t0) files++; } catch { /* */ }
  const sheets = Object.values(state.data.printed || {}).filter((t) => t >= t0).length;
  const labels = Object.values(state.data.labelsPrinted || {}).filter((t) => t >= t0).length;
  const buys = (state.data.purchases || []).filter((x) => x.at >= t0);
  return { files, sheets, labels, spent: buys.reduce((a, x) => a + (Number(x.total) || 0), 0), bought: buys.length };
});
ipcMain.handle('notify', (_e, t, b) => { if (!win || !win.isFocused()) notify(t, b); return true; });
ipcMain.handle('stations', () => {
  syncShared();
  const root = downloadDir();
  const list = Object.entries((sharedCache && sharedCache.stations) || {}).map(([name, v]) => ({ name, ...v, me: name === stationName() })).sort((a, b) => b.seen - a.seen);
  return { me: stationName(), host: os.hostname(), list, file: root ? Shared.fileOf(root) : '' };
});
// ---------- Siparisler sayfasi ----------
let detailCache = null; // { at, data }
ipcMain.handle('orders-seen', () => { state.data.ordersSeenAt = Date.now(); state.save(); return true; });
ipcMain.handle('orders-detail', async (_e, force, daysArg) => {
  const days = Math.min(90, Math.max(1, Number(daysArg) || 14));
  const root = downloadDir();
  // Yerel dosyalar: siparis no -> dosyalar ve baski durumu
  const local = new Map();
  if (root && fs.existsSync(root)) {
    const idx = F.sheetIndex(root, state.data.printed);
    for (const g of F.listOrders(root, Math.max(30, days + 2))) for (const f of g.files) {
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
      if (force || !detailCache || detailCache.days < days || Date.now() - detailCache.at > 60000) detailCache = { at: Date.now(), days, data: await fetchOrderDetails(c, days) };
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

// ---------- Gunun siparis sayisi (Bugun / Siparisler / Kargo fisleri basliklarinda) ----------
let statsCache = null;
ipcMain.handle('today-stats', async (_e, force) => {
  const c = config.data;
  if (!(c.shop && c.clientId && c.clientSecret)) return { error: 'Shopify bağlı değil' };
  try {
    let orders;
    if (detailCache && Date.now() - detailCache.at < 3 * 60000 && detailCache.days >= 2) orders = detailCache.data.orders;
    else {
      if (force || !statsCache || Date.now() - statsCache.at > 3 * 60000) statsCache = { at: Date.now(), data: await fetchOrderDetails(c, 2) };
      orders = statsCache.data.orders;
    }
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const t0 = d0.getTime(), y0 = t0 - 864e5, nowOfDay = Date.now() - t0;
    const live = orders.filter((o) => !o.cancelled && o.createdAt);
    const today = live.filter((o) => Date.parse(o.createdAt) >= t0);
    const yest = live.filter((o) => { const x = Date.parse(o.createdAt); return x >= y0 && x < t0; });
    const yestSoFar = yest.filter((o) => Date.parse(o.createdAt) - y0 <= nowOfDay).length;
    return { today: today.length, revenue: today.reduce((a, o) => a + (Number(o.total) || 0), 0), yesterday: yest.length, yesterdaySoFar: yestSoFar, at: Date.now() };
  } catch (e) { return { error: e.message }; }
});

// ---------- Kargo fisleri ----------
let kargoCache = null; // { at, data }
const shopAdminOrder = (gid) => {
  const id = String(gid || '').replace(/\D/g, '');
  const store = String(config.data.shop || '').replace(/\.myshopify\.com.*$/, '').replace(/^https?:\/\//, '');
  return id && store ? `https://admin.shopify.com/store/${store}/orders/${id}` : null;
};
// ---------- Geliver bakiyesi: Geliver panelinden (Ödemeler sayfasi) ----------
// Geliver'in API anahtari bakiye okumaya izin vermiyor; panelde gorunen bakiyeyi programin kendi
// Geliver oturumuyla (bir kez giris yapilir, hatirlanir) gizli pencerede okuruz.
const GELIVER_PART = 'persist:geliver';
let gelWeb = { at: 0, value: null, busy: null };
function parseTL(t) {
  let x = String(t).replace(/\s/g, '');
  if (x.includes(',') && x.includes('.')) x = x.replace(/\./g, '').replace(',', '.');
  else if (x.includes(',')) x = x.replace(',', '.');
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
const BAL_JS = `(() => { const t = document.body ? document.body.innerText : ''; const m = t.match(/Bakiye\s*\n?\s*(-?[\d.,]+)\s*₺/); return { url: location.href, m: m ? m[1] : null }; })()`;
const isLoginUrl = (u) => /login|giris|signin|register|auth/i.test(new URL(u || 'https://x/').pathname);
function geliverWebBalance(force) {
  if (!force && gelWeb.value != null && Date.now() - gelWeb.at < 3 * 60000) return Promise.resolve(gelWeb.value);
  if (gelWeb.busy) return gelWeb.busy;
  gelWeb.busy = (async () => {
    const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: GELIVER_PART, sandbox: true } });
    try {
      w.loadURL('https://app.geliver.io/payment').catch(() => {});
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const r = await w.webContents.executeJavaScript(BAL_JS).catch(() => null);
        if (r && r.m != null) { const n = parseTL(r.m); if (n != null) { gelWeb = { at: Date.now(), value: n, busy: null }; return n; } }
        if (r && i > 3 && isLoginUrl(r.url)) { const e = new Error('Bakiyeyi görmek için programda bir kez Geliver\'e giriş yapın.'); e.login = true; throw e; }
      }
      throw new Error('Geliver ödeme sayfasında bakiye bulunamadı');
    } finally { if (!w.isDestroyed()) w.destroy(); gelWeb.busy = null; }
  })();
  return gelWeb.busy;
}
// Geliver'e giris penceresi (oturum programda saklanir); giris yapilinca bakiye okunur ve pencere kapanir
let gelLoginWin = null;
ipcMain.handle('geliver-login', () => {
  if (gelLoginWin && !gelLoginWin.isDestroyed()) { gelLoginWin.focus(); return true; }
  gelLoginWin = new BrowserWindow({ width: 1100, height: 820, parent: win, title: 'Geliver\'e giriş — Tuhalf Print', icon: ICON, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { partition: GELIVER_PART, sandbox: true } });
  gelLoginWin.loadURL('https://app.geliver.io/payment').catch(() => {});
  const timer = setInterval(async () => {
    if (!gelLoginWin || gelLoginWin.isDestroyed()) return clearInterval(timer);
    const r = await gelLoginWin.webContents.executeJavaScript(BAL_JS).catch(() => null);
    if (r && r.m != null && !isLoginUrl(r.url)) {
      clearInterval(timer);
      const n = parseTL(r.m);
      if (n != null) gelWeb = { at: Date.now(), value: n, busy: null };
      log('ok', `Geliver oturumu açıldı; bakiye ${n != null ? n.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺' : 'okundu'}.`);
      setTimeout(() => { if (gelLoginWin && !gelLoginWin.isDestroyed()) gelLoginWin.close(); }, 800);
    }
  }, 1500);
  gelLoginWin.on('closed', () => { clearInterval(timer); gelLoginWin = null; kargoCache = null; send('kargo-updated'); });
  return true;
});
let lastBalErr = 0;
const GELIVER_ORG = '60cdea33-45e2-4715-a87f-7ecd3b57bc0d';   // tuhalf Geliver organizasyonu
async function loadKargo(force) {
  if (!force && kargoCache && Date.now() - kargoCache.at < 60000) return kargoCache.data;
  const k = config.data.kargo || {};
  const printed = state.data.labelsPrinted || {};
  const pay = state.data.pay || {};
  const out = { cod: [], geliver: [], errors: [], codError: null, geliverError: null, codTest: false, at: Date.now() };
  const [g, c] = await Promise.allSettled([K.geliverShipments(k.geliverToken, k.days || 14), K.codOrders(k, k.days || 14)]);
  // Bakiye: Geliver panelinin kullandigi organizasyon bakiyesi (organizasyon kimligi gonderilerden ya da ayardan)
  const orgId = (g.status === 'fulfilled' && (g.value.find((x) => x.owner) || {}).owner) || k.geliverOrgId || GELIVER_ORG;
  out.balance = null; out.balanceError = null; out.balanceLogin = false;
  if (k.geliverToken) {
    try { out.balance = await K.geliverBalance(k.geliverToken, fetch, orgId); }
    catch (apiErr) {
      // API anahtari bakiyeye izin vermiyor: Geliver panelinden (programin kendi Geliver oturumuyla) oku
      try { out.balance = await geliverWebBalance(); }
      catch (e) { out.balanceError = e.message; out.balanceLogin = !!e.login; }
    }
    out.balanceAt = Date.now();
  }
  if (out.balanceError && !out.balanceLogin && (!lastBalErr || Date.now() - lastBalErr > 30 * 60000)) { lastBalErr = Date.now(); log('warn', 'Geliver bakiyesi okunamadı: ' + out.balanceError); }
  out.avgCost = Number(k.avgCost) || 167.19;   // HepsiJet ortalama kargo (KDV dahil)
  out.lowBalance = Number(k.lowBalance) || 500;
  // Kapida odeme
  const codNos = new Set();
  if (c.status === 'fulfilled') {
    out.codTest = c.value.test;
    for (const o of c.value.orders) {
      codNos.add(Number(o.no));
      const row = { ...o, printedAt: printed['cod:' + o.no] || null, printedBy: (state.data.labelsBy || {})['cod:' + o.no] || '', admin: shopAdminOrder(o.id) };
      out.cod.push(row);
      if (o.sorun && !o.etiketli) out.errors.push({ source: 'cod', no: o.no, name: o.ad, address: o.adres, city: [o.sehir, o.il].filter(Boolean).join(' / '), error: o.sorun, link: row.admin, at: o.tarih });
    }
  } else out.codError = c.reason.message;
  // Geliver (kapida odeme siparisleri DHL'e gider, burada gosterilmez)
  if (g.status === 'fulfilled') {
    for (const s of g.value) {
      const p = s.no ? pay[s.no] : null;
      const cod = codNos.has(s.no) || (p && (p.gateways || []).concat(p.shipping || '').some((x) => /cash on delivery|\bcod\b|kap[ıi]da/i.test(x))) || /KAPIDA/i.test(s.service || '');
      if (cod) continue;
      const row = { ...s, kind: K.geliverKind(s), printedAt: printed['geliver:' + s.id] || null, printedBy: (state.data.labelsBy || {})['geliver:' + s.id] || '', admin: shopAdminOrder(s.gid) };
      out.geliver.push(row);
      const err = K.geliverAddressError(s);
      if (err && row.kind !== 'done') out.errors.push({ source: 'geliver', id: s.id, gid: s.gid, no: s.no, name: s.name, address: s.address, city: [s.district, s.city].filter(Boolean).join(' / '), error: err, link: row.admin, geliver: true, at: s.createdAt, row: s });
    }
  } else out.geliverError = g.reason.message;
  // Teklif bekleyen Geliver gonderileri: odeme durumu (havalesi gelmemis siparise kargo alinmasin)
  const offerRows = out.geliver.filter((r) => r.kind === 'offer' && r.no);
  const noPay = offerRows.filter((r) => !pay[r.no] || Date.now() - pay[r.no].at > 10 * 60000).map((r) => r.no);
  if (noPay.length) { try { updatePay(await fetchPayStatuses(config.data, noPay)); } catch { /* */ } }
  // Liste cevabinda teklifler eksik gelebilir: odemesi alinmis olanlarin tekliflerini tek tek oku
  const needOffer = offerRows.filter((r) => !r.hepsijet).slice(0, 25);
  await Promise.all(needOffer.map(async (r) => {
    try { const d = await K.geliverShipment(k.geliverToken, r.id); if (d.hepsijet) { r.hepsijet = d.hepsijet; r.price = r.price || d.hepsijet.total; r.provider = r.provider || d.hepsijet.provider; } } catch { /* */ }
  }));
  const pay2 = state.data.pay || {};
  for (const r of out.geliver) {
    const p = r.no ? pay2[r.no] : null;
    r.pay = p ? { financial: p.financial || '', paid: p.financial === 'PAID', hold: holdReason(p), gateways: p.gateways || [] } : null;
  }
  // Geliver adres hatalari: Shopify'daki guncel adres duzeltilmis mi? (Geliver adresi kendiliginden guncellemez)
  const gErr = out.errors.filter((e) => e.geliver && e.gid);
  if (gErr.length) {
    let addrs = {};
    try { addrs = await fetchOrderAddresses(config.data, gErr.map((e) => e.gid)); } catch { addrs = {}; }
    const missing = gErr.filter((e) => !addrs[String(e.gid).replace(/\D/g, '')]).map((e) => e.gid);
    if (missing.length) { try { Object.assign(addrs, await K.codAddresses(k, missing)); } catch { /* */ } }
    for (const e of gErr) {
      const a = addrs[String(e.gid).replace(/\D/g, '')];
      if (!a) { e.shopNote = 'Shopify adresi okunamadı'; continue; }
      e.shopAddr = a;
      e.shopText = [[a.address1, a.address2].filter(Boolean).join(' '), [a.city, a.province].filter(Boolean).join(' / ')].filter(Boolean).join(' — ');
      e.canSync = K.addressChanged(e.row, a);
    }
  }
  for (const e of out.errors) delete e.row;
  out.errors.sort((a, b) => (b.no || 0) - (a.no || 0));
  kargoCache = { at: Date.now(), data: out };
  return out;
}

// 100x100 etiketi secili yaziciya sessizce basar. src: { html } ya da { url }
// Bir HTML'i yaziciya gonderir (gizli pencere). silent=false: Windows yazdirma penceresi acilir.
async function printHtml(html, { printer, wMm = 100, hMm = 100, silent = true }) {
  const w = new BrowserWindow({ show: false, width: 500, height: 500, useContentSize: true, webPreferences: { sandbox: true, javascript: true } });
  const tmp = path.join(app.getPath('temp'), `tuhalf-etiket-${Date.now()}.html`);
  try {
    fs.writeFileSync(tmp, html);
    await w.loadFile(tmp);
    await w.webContents.executeJavaScript(`Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; }))).then(() => document.fonts ? document.fonts.ready : 1).then(() => true)`).catch(() => true);
    await new Promise((r) => setTimeout(r, 300));
    await new Promise((resolve, reject) => {
      w.webContents.print({
        silent, printBackground: true, deviceName: printer || undefined,
        pageSize: { width: Math.round(wMm * 1000), height: Math.round(hMm * 1000) }, margins: { marginType: 'none' },
      }, (ok, reason) => (ok ? resolve() : reject(new Error(reason === 'cancelled' ? 'İptal edildi' : reason || 'Yazdırılamadı'))));
    });
  } finally { if (!w.isDestroyed()) w.destroy(); setTimeout(() => fs.rm(tmp, () => {}), 60000); }
}
function markLabels(keys) {
  syncShared();
  const printed = { ...(state.data.labelsPrinted || {}) };
  const off = { ...(state.data.labelsOff || {}) };
  const now = Date.now();
  for (const k of keys) { printed[k] = now; delete off[k]; }
  state.data.labelsOff = off;
  for (const k of Object.keys(printed)) if (now - printed[k] > 90 * 864e5) delete printed[k];
  state.data.labelsPrinted = printed; state.save();
  syncShared();
  if (kargoCache) for (const r of [...kargoCache.data.cod, ...kargoCache.data.geliver]) { const key = r.id && r.provider !== undefined ? 'geliver:' + r.id : 'cod:' + r.no; if (keys.includes(key)) r.printedAt = now; }
}

// Shopify'da duzeltilen adresi Geliver gonderisine aktar
ipcMain.handle('geliver-sync', async (_e, shipmentId) => {
  const k = config.data.kargo || {};
  try {
    const data = await loadKargo(false);
    const e = data.errors.find((x) => x.id === shipmentId);
    if (!e || !e.shopAddr) return { error: 'Shopify adresi bulunamadı; Yenile deyip tekrar deneyin.' };
    const r = await K.toGeliverAddress(k.geliverToken, e.shopAddr);
    if (r.error) return { error: r.error };
    const A = r.address;
    const ok = await ask({
      type: r.note ? 'warning' : 'question', title: `#${e.no} adresini Geliver'e aktar`, noLink: true, defaultId: 1, cancelId: 0,
      buttons: ['İptal', 'Geliver\'e aktar'],
      message: `Geliver'deki gönderiye şu adres yazılacak:`,
      detail: `${A.name}\n${[A.address1, A.address2].filter(Boolean).join(' ')}\n${A.districtName} / ${A.cityName}${A.zip ? '  ' + A.zip : ''}\n${A.phone}${r.note ? '\n\n⚠ ' + r.note : ''}`,
    });
    if (ok.response !== 1) return { canceled: true };
    const upd = await K.updateGeliverAddress(k.geliverToken, shipmentId, r.address);
    log('ok', `#${e.no} adresi Geliver'e aktarıldı: ${r.address.districtName} / ${r.address.cityName}`);
    kargoCache = null;
    return { ok: true, address: r.address, after: upd };
  } catch (err) { log('error', `Geliver adresi güncellenemedi: ${err.message}`); return { error: err.message }; }
});
ipcMain.handle('kargo', async (_e, force) => {
  try { return await loadKargo(force); } catch (e) { return { error: e.message }; }
});
ipcMain.handle('printers', async () => {
  try { return (await win.webContents.getPrintersAsync()).map((p) => ({ name: p.name, label: p.displayName || p.name, isDefault: p.isDefault })); } catch { return []; }
});
const tl = (n) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
// ---------- Kargo fisleri: once onizleme penceresi, sonra secilen yaziciya baski ----------
function testLabelHtml() {
  const bars = Array.from({ length: 46 }, (_, i) => `<i style="width:${[1, 2, 3, 1, 2][i % 5] * 0.35}mm"></i>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:100mm 100mm;margin:0}*{box-sizing:border-box;margin:0}html,body{width:100mm;height:100mm}
body{font-family:Arial,sans-serif;padding:4mm;border:0.6mm solid #000;display:flex;flex-direction:column;gap:2.5mm}
h1{font-size:9mm;text-align:center;border:0.8mm solid #000;padding:1.5mm}.r{display:flex;justify-content:space-between;font-size:3.6mm}
.box{border:0.4mm solid #000;padding:2mm;font-size:3.8mm;line-height:1.35}.bc{display:flex;gap:0.35mm;height:16mm;justify-content:center}
.bc i{display:block;background:#000;height:100%}.s{font-size:3mm;text-align:center}.c{display:flex;justify-content:space-between;font-size:2.6mm}
</style></head><body><h1>DENEME FİŞİ</h1>
<div class="r"><b>Tuhalf Print</b><span>${new Date().toLocaleString('tr-TR')}</span></div>
<div class="box"><b>ALICI:</b> Örnek Müşteri<br>Örnek Mah. Deneme Sok. No:1<br>Kadıköy / İstanbul</div>
<div class="bc">${bars}</div><div class="s">Yazıcı: ${'${YAZICI}'}</div>
<div class="c"><span>◤ sol üst</span><span>100 × 100 mm</span><span>sağ üst ◥</span></div></body></html>`;
  return html;
}
let labelWin = null, labelJob = null;
function openLabelWindow(job) {
  labelJob = job;
  if (labelWin && !labelWin.isDestroyed()) { labelWin.webContents.reload(); labelWin.show(); labelWin.focus(); return; }
  labelWin = new BrowserWindow({
    width: 1000, height: 820, minWidth: 760, minHeight: 560, backgroundColor: '#16171b', title: 'Kargo fişleri — önizleme', icon: ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'renderer', 'labels-preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  labelWin.loadFile(path.join(__dirname, '..', 'renderer', 'labels.html'));
  labelWin.on('closed', () => { labelWin = null; labelJob = null; });
}
async function fetchPdf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`etiket indirilemedi (HTTP ${r.status})`);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}
ipcMain.handle('labels-open', async (_e, kind, ids = []) => {
  const k = config.data.kargo || {};
  try {
    if (kind === 'test') { openLabelWindow({ kind, title: 'Deneme fişi', items: [{ key: null, title: 'Deneme fişi', html: testLabelHtml() }], errors: [], note: 'Kargo firmasına hiçbir şey gönderilmedi.' }); return { ok: true }; }
    const data = await loadKargo(false);
    if (kind === 'geliver') {
      const rows = data.geliver.filter((r) => ids.includes(r.id));
      const items = [], errors = [];
      await Promise.all(rows.map(async (r) => {
        const title = `#${r.no || '?'} ${r.name || ''}`.trim();
        if (!r.pdfUrl) { errors.push(`${title}: Geliver bu gönderi için etiket vermedi (etiket satın alınmamış olabilir)`); return; }
        try { items.push({ key: 'geliver:' + r.id, title, pdf: await fetchPdf(r.pdfUrl) }); } catch (e) { errors.push(`${title}: ${e.message}`); }
      }));
      items.sort((a, b) => a.title.localeCompare(b.title, 'tr', { numeric: true }));
      if (!items.length) return { error: errors[0] || 'Seçili gönderilerin etiketi yok.' };
      openLabelWindow({ kind, title: `Geliver · ${items.length} fiş`, items, errors });
      return { ok: true };
    }
    if (kind === 'cod') {
      const rows = data.cod.filter((r) => ids.includes(r.id));
      const yeni = rows.filter((r) => !r.etiketli);
      if (yeni.length && !data.codTest) {
        const c = await ask({
          type: 'question', title: 'DHL kaydı', noLink: true, defaultId: 1, cancelId: 0, buttons: ['İptal', 'Kaydet ve fişleri göster'],
          message: `${yeni.length} sipariş DHL'e yeni kargo olarak kaydedilecek.`,
          detail: `${yeni.map((r) => '#' + r.no).join(', ')}\n\nDHL'e daha önce kaydedilmiş siparişlerin fişi yeni kayıt açmadan tekrar gösterilir.`,
        });
        if (c.response !== 1) return { canceled: true };
      }
      const r = await K.codLabels(k, ids);
      kargoCache = null;
      for (const [n, m] of r.hatalar || []) log('warn', `${n} etiketi hazırlanamadı: ${m}`);
      const errors = (r.hatalar || []).map(([n, m]) => `${n}: ${m}`);
      if (!r.html || !(r.etiketler || []).length) return { error: errors[0] || 'Etiket hazırlanamadı.' };
      openLabelWindow({ kind, title: `Kapıda ödeme (DHL) · ${r.etiketler.length} fiş`, items: [{ keys: r.etiketler.map((no) => 'cod:' + no), title: r.etiketler.map((n) => '#' + n).join(', '), html: r.html, count: r.etiketler.length }], errors, note: r.deneme ? 'DENEME modu: fişler “ÖRNEK” yazılı, DHL\'e kaydedilmedi.' : '' });
      send('kargo-updated');
      return { ok: true };
    }
    return { error: 'Bilinmeyen fiş türü' };
  } catch (e) { log('error', 'Kargo fişleri hazırlanamadı: ' + e.message); return { error: e.message }; }
});
// Geliver: HepsiJet teklifini kabul edip etiketi satin al (bakiyeden duser) — her seferinde onay sorulur
// Satin alma oncesi kontrol (tek ve toplu alimda ortak): durum, Shopify odemesi, HepsiJet teklifi
async function buyCheck(k, id, payFresh) {
  const s = await K.geliverShipment(k.geliverToken, id);
  const title = `#${s.no || '?'} ${s.name || ''}`.trim();
  if (!['CREATED', 'GOT_OFFERS', 'FAILED'].includes(s.status)) return { title, error: `etiket zaten alınmış ya da gönderi kapanmış (${s.statusText})` };
  const p = s.no ? (payFresh || state.data.pay || {})[s.no] : null;
  if (!p) return { title, error: 'Shopify ödeme durumu okunamadı' };
  const hold = holdReason(p);
  if (hold) return { title, error: hold };
  if (p.financial !== 'PAID') return { title, error: `ödeme “Ödendi” değil (${p.financial || 'bilinmiyor'})` };
  if (!s.hepsijet) return { title, error: 'HepsiJet teklifi yok' };
  return { title, s, o: s.hepsijet };
}
// Toplu: odemesi alinmis tum secili gonderileri tek onayla HepsiJet ile al
ipcMain.handle('geliver-buy-bulk', async (_e, ids) => {
  const k = config.data.kargo || {};
  try {
    const nos = [];
    const pre = await Promise.all((ids || []).map((id) => K.geliverShipment(k.geliverToken, id).then((s) => { if (s.no) nos.push(s.no); return null; }).catch(() => null)));
    void pre;
    if (nos.length) { try { updatePay(await fetchPayStatuses(config.data, nos)); } catch { /* */ } }
    const checks = [];
    for (const id of ids || []) { try { checks.push({ id, ...(await buyCheck(k, id)) }); } catch (e) { checks.push({ id, title: id, error: e.message }); } }
    const ok = checks.filter((c) => !c.error), bad = checks.filter((c) => c.error);
    if (!ok.length) return { error: 'Satın alınabilecek gönderi yok: ' + bad.map((b) => `${b.title} (${b.error})`).join(', ') };
    const total = ok.reduce((a, c) => a + c.o.total, 0);
    let bal = null; try { bal = await K.geliverBalance(k.geliverToken); } catch { try { bal = await geliverWebBalance(true); } catch { /* */ } }
    if (bal != null && bal < total) return { error: `Geliver bakiyesi yetersiz: ${tl(bal)} (gereken ${tl(total)}). Bakiye ekleyin.` };
    const c = await ask({
      type: 'question', title: 'Toplu HepsiJet alımı', noLink: true, defaultId: 1, cancelId: 0, buttons: ['İptal', `${ok.length} etiketi satın al · ${tl(total)}`],
      message: `${ok.length} gönderi için HepsiJet kargo etiketi satın alınacak.`,
      detail: ok.map((x) => `${x.title} — ${tl(x.o.total)}`).join('\n') + `\n\nToplam: ${tl(total)} (Geliver bakiyesinden düşer)` + (bal != null ? `\nBakiye: ${tl(bal)} → ${tl(bal - total)}` : '') + (bad.length ? `\n\nAlınmayacak (${bad.length}):\n` + bad.map((b) => `${b.title} — ${b.error}`).join('\n') : ''),
    });
    if (c.response !== 1) return { canceled: true };
    const bought = [], failed = [];
    for (const x of ok) {
      try {
        await K.geliverBuy(k.geliverToken, x.o.id);
        bought.push(x.s.id);
        state.data.purchases = (state.data.purchases || []).filter((y) => Date.now() - y.at < 40 * 864e5).concat([{ at: Date.now(), no: x.s.no, total: x.o.total }]);
        log('ok', `${x.title} HepsiJet etiketi satın alındı (${tl(x.o.total)}).`);
      } catch (e) { failed.push(`${x.title}: ${e.message}`); log('error', `${x.title} satın alınamadı: ${e.message}`); }
    }
    state.save(); kargoCache = null; gelWeb.at = 0; send('kargo-updated');
    return { ok: true, bought, failed, total: ok.filter((x) => bought.includes(x.s.id)).reduce((a, x) => a + x.o.total, 0), skipped: bad.map((b) => `${b.title} (${b.error})`) };
  } catch (e) { log('error', 'Toplu satın alma: ' + e.message); return { error: e.message }; }
});
ipcMain.handle('geliver-buy', async (_e, id) => {
  const k = config.data.kargo || {};
  try {
    const s = await K.geliverShipment(k.geliverToken, id);
    const title = `#${s.no || '?'} ${s.name || ''}`.trim();
    if (!['CREATED', 'GOT_OFFERS', 'FAILED'].includes(s.status)) return { error: `${title}: bu gönderi için etiket zaten alınmış ya da gönderi kapanmış (${s.statusText}).` };
    if (s.no) { try { updatePay(await fetchPayStatuses(config.data, [s.no])); } catch { /* */ } }
    const p = s.no ? (state.data.pay || {})[s.no] : null;
    if (!p) return { error: `${title}: Shopify ödeme durumu okunamadı; satın alma yapılmadı.` };
    const hold = holdReason(p);
    if (hold) return { error: `${title}: ${hold}. Ödeme gelmeden kargo satın alınmaz.` };
    if (p.financial !== 'PAID') return { error: `${title}: Shopify'da ödeme “Ödendi” değil (${p.financial || 'bilinmiyor'}). Kargo satın alınmadı.` };
    const o = s.hepsijet;
    if (!o) return { error: `${title}: Geliver'de HepsiJet teklifi yok. Gönderiyi Geliver'de açıp teklif alın.` };
    let bal = null; try { bal = await K.geliverBalance(k.geliverToken); } catch { try { bal = await geliverWebBalance(true); } catch { /* */ } }
    if (bal != null && bal < o.total) return { error: `Geliver bakiyesi yetersiz: ${tl(bal)} (gereken ${tl(o.total)}). Bakiye ekleyin.` };
    const c = await ask({
      type: 'question', title: 'HepsiJet ile satın al', noLink: true, defaultId: 1, cancelId: 0, buttons: ['İptal', `Satın al · ${tl(o.total)}`],
      message: `${title} için HepsiJet kargo etiketi satın alınacak.`,
      detail: `Tutar: ${tl(o.total)} (Geliver bakiyesinden düşer)${bal != null ? `\nBakiye: ${tl(bal)} → ${tl(bal - o.total)}` : ''}\nAlıcı: ${s.name} — ${[s.district, s.city].filter(Boolean).join(' / ')}\nÖdeme: Shopify'da ödendi ✓`,
    });
    if (c.response !== 1) return { canceled: true };
    const after = await K.geliverBuy(k.geliverToken, o.id);
    kargoCache = null; gelWeb.at = 0;
    state.data.purchases = (state.data.purchases || []).filter((x) => Date.now() - x.at < 40 * 864e5).concat([{ at: Date.now(), no: s.no, total: o.total }]); state.save();
    log('ok', `${title} HepsiJet etiketi satın alındı (${tl(o.total)}).`);
    send('kargo-updated');
    return { ok: true, id: s.id, pdfUrl: after && after.pdfUrl, total: o.total };
  } catch (e) { log('error', 'Geliver satın alma: ' + e.message); return { error: e.message }; }
});
ipcMain.handle('labels-job', () => labelJob);
ipcMain.handle('labels-printers', async (e) => {
  let list = [];
  try { list = await e.sender.getPrintersAsync(); } catch { /* */ }
  const k = config.data.kargo || {};
  const names = list.map((p) => p.name);
  const pick = (k.printer && names.includes(k.printer) && k.printer)
    || (list.find((p) => /zj|9210|zjiang|termal|thermal|etiket|label|xprinter|barkod/i.test(p.name + ' ' + (p.displayName || ''))) || {}).name
    || (list.find((p) => p.isDefault) || {}).name || '';
  return { list: list.map((p) => ({ name: p.name, label: p.displayName || p.name, isDefault: p.isDefault })), selected: pick, paper: k.paper || '100' };
});
ipcMain.handle('labels-print', async (_e, o) => {
  const printer = o.printer || '';
  const html = String(o.html || '').replace(/\$\{YAZICI\}/g, printer.replace(/[<>&]/g, '') || 'Varsayılan yazıcı');
  try {
    await printHtml(html, { printer, wMm: o.wMm || 100, hMm: o.hMm || 100, silent: o.silent !== false });
    config.set({ kargo: { ...(config.data.kargo || {}), printer, ...(o.paper ? { paper: o.paper } : {}) } });
    if (o.keys && o.keys.length) markLabels(o.keys);
    log('ok', `${o.count || 1} kargo fişi yazıcıya gönderildi (${printer || 'varsayılan yazıcı'})`);
    send('kargo-updated');
    return { ok: true };
  } catch (e) { log('error', `Kargo fişi yazdırılamadı (${printer || 'varsayılan'}): ${e.message}`); return { error: e.message }; }
});
// Tarih araligi: today | yesterday | 3 | 7 | 14 | 30 | 60 | 90 (sunucudan cekilecek gun sayisi buna gore)
const RANGE_DAYS = { today: 1, yesterday: 2 };
ipcMain.handle('kargo-days', (_e, d) => {
  const range = String(d || '14');
  config.set({ kargo: { ...(config.data.kargo || {}), range, days: RANGE_DAYS[range] || Number(range) || 14 } });
  kargoCache = null; return true;
});
ipcMain.handle('label-mark', (_e, keys, on) => {
  if (on) markLabels(keys);
  else { syncShared(); const p = { ...(state.data.labelsPrinted || {}) }; const off = { ...(state.data.labelsOff || {}) }; for (const k of keys) { delete p[k]; off[k] = Date.now(); } state.data.labelsPrinted = p; state.data.labelsOff = off; state.save(); syncShared(); kargoCache = null; }
  return true;
});
ipcMain.handle('open-url', (_e, u) => { if (/^https:\/\//.test(String(u))) shell.openExternal(u); return true; });

// Ayarlari disa/ice aktar (ofisteki diger bilgisayarlar icin; gizli anahtarlar dahil)
ipcMain.handle('settings-export', async () => {
  const r = await dialog.showSaveDialog(win, { title: 'Ayarları dışa aktar', defaultPath: path.join(app.getPath('documents'), 'tuhalf-print-ayarlar.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return { canceled: true };
  const { photoshopPath, downloadDir: _d, card, ...rest } = config.data;
  fs.writeFileSync(r.filePath, JSON.stringify({ tuhalfPrintAyarlari: 1, ...rest }, null, 2));
  log('ok', 'Ayarlar dışa aktarıldı: ' + r.filePath);
  return { ok: true, file: r.filePath };
});
ipcMain.handle('settings-import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Ayarları içe aktar', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return { canceled: true };
  let j;
  try { j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch (e) { return { error: 'Dosya okunamadı: ' + e.message }; }
  if (!j || !j.tuhalfPrintAyarlari) return { error: 'Bu bir Tuhalf Print ayar dosyası değil.' };
  const allowed = ['shop', 'clientId', 'clientSecret', 'apiVersion', 'firstOrderNo', 'intervalMin', 'lookbackDays', 'dayEnd', 'print', 'kargo'];
  const patch = {};
  for (const key of allowed) if (j[key] !== undefined) patch[key] = j[key];
  if (patch.kargo) { const cur = config.data.kargo || {}; patch.kargo = { ...cur, ...patch.kargo, printer: cur.printer || patch.kargo.printer || '' }; }
  config.set(patch); kargoCache = null;
  log('ok', 'Ayarlar içe aktarıldı: ' + Object.keys(patch).join(', '));
  schedule(); pushStatus(); send('refresh');
  return { ok: true, config: safeConfig() };
});

// ---------- Sifirlama: programin olusturdugu klasor ve dosyalari kalici sil ----------
ipcMain.handle('reset-files', async () => {
  if (status.job || status.running) return { error: 'Şu an bir işlem sürüyor, bitince tekrar deneyin.' };
  const root = downloadDir();
  const days = root && fs.existsSync(root) ? F.listDayFolders(root) : [];
  let files = 0;
  const count = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) count(p); else files++; } };
  for (const d of days) try { count(d.path); } catch { /* */ }
  const r = await ask({
    type: 'warning', title: 'Dosyaları resetle', noLink: true, defaultId: 0, cancelId: 0, danger: true,
    buttons: ['İptal', 'Kalıcı olarak sil'],
    message: days.length ? `${days.length} sipariş klasörü ve içindeki ${files} dosya kalıcı olarak silinecek.` : 'Silinecek sipariş klasörü yok. İndirme ve baskı geçmişi sıfırlanacak.',
    detail: `Klasör: ${root}\n${path.basename(root)} klasörünün kendisi silinmez; sadece içindeki sipariş klasörleri (gün-ay-yıl-SIPARISLER) silinir.\nİndirilen dosyalar, dizilmiş kaynaklar ve hazırlanmış PSD sayfaları silinir; indirme ve baskı geçmişi sıfırlanır. Bu işlem geri alınamaz.\n\nSonra Tercihler > Sıfırlama'dan "Yeniden indir" ile istediğin siparişten itibaren temiz başlayabilirsin. O zamana kadar sadece yeni gelen siparişler otomatik iner.`,
  });
  if (r.response !== 1) return { canceled: true };
  const failed = [];
  for (const d of days) { try { fs.rmSync(d.path, { recursive: true, force: true }); } catch (e) { failed.push(d.name); } }
  try { fs.rmSync(path.join(app.getPath('userData'), 'thumbs'), { recursive: true, force: true }); } catch { /* */ }
  state.data.downloaded = []; state.data.arranged = {}; state.data.printed = {}; state.data.printedOff = {}; state.data.arrangedAt = Date.now();
  try { fs.rmSync(Shared.fileOf(root), { force: true }); } catch { /* */ }
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
  syncShared();
  const printed = { ...(state.data.printed || {}) };
  const off = { ...(state.data.printedOff || {}) };
  if (on) { printed[p] = Date.now(); delete off[p]; } else { delete printed[p]; off[p] = Date.now(); }
  state.data.printed = printed; state.data.printedOff = off; state.save();
  syncShared();
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
  if (patch.clientSecret === MASK) delete patch.clientSecret;
  if (patch.kargo) { if (patch.kargo.geliverToken === MASK) delete patch.kargo.geliverToken; if (patch.kargo.codKey === MASK) delete patch.kargo.codKey; kargoCache = null; }
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
  if (savedSchema < 4) {
    // Yeni siparisler daha cabuk insin: 30 dk -> 5 dk (elle baska bir deger secildiyse dokunma)
    const im = Number(config.data.intervalMin) || 30;
    config.set({ schema: 4, intervalMin: im >= 30 ? 5 : im });
    if (im >= 30) log('info', 'Sipariş kontrol sıklığı 5 dakikaya indirildi.');
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
  // Uykudan donunce hemen kontrol et; zamanlayici bir sekilde durmussa her dakika toparla
  powerMonitor.on('resume', () => { log('info', 'Bilgisayar uykudan döndü, siparişler kontrol ediliyor…'); setTimeout(checkNow, 15000); });
  setInterval(() => {
    if (status.running && Date.now() - (status.runStart || 0) > RUN_LIMIT_MS) checkNow();
    else if (!status.running && status.nextCheck && Date.now() > status.nextCheck + 2 * 60000) checkNow();
  }, 60000);
  updater.start();
});
