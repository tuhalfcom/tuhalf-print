'use strict';
// GitHub Releases uzerinden guncelleme kontrolu (electron-updater).
// Depo adresi package.json > build.publish icinde.
const { app, shell } = require('electron');

const RELEASES_URL = (() => {
  try {
    const p = require('../../package.json').build.publish;
    const g = Array.isArray(p) ? p[0] : p;
    return `https://github.com/${g.owner}/${g.repo}/releases/latest`;
  } catch { return null; }
})();

const AUTO_EVERY_MS = 4 * 60 * 60 * 1000; // 4 saatte bir sessiz kontrol

function createUpdater({ log, send, notify, isBusy, beforeInstall }) {
  // state: idle | checking | none | available | downloading | ready | error | dev
  const st = { state: 'idle', current: app.getVersion(), latest: null, percent: 0, error: null, checkedAt: null, notes: null };
  const push = () => send('update', { ...st });
  const set = (patch) => { Object.assign(st, patch); push(); };

  // Mac surumu imzasiz: kendini guncelleyemez, sadece indirme sayfasini acar.
  const canSelfInstall = process.platform === 'win32';

  if (!app.isPackaged) {
    set({ state: 'dev' });
    return {
      status: () => ({ ...st }),
      check: async () => { set({ state: 'dev' }); return { ...st }; },
      install: () => false,
      start: () => {},
    };
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = canSelfInstall;
  autoUpdater.autoInstallOnAppQuit = canSelfInstall;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = { info: () => {}, warn: (m) => log('warn', 'Güncelleme: ' + m), error: () => {}, debug: () => {} };

  let manual = false;

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => {
    set({ state: 'none', checkedAt: Date.now() });
    if (manual) log('info', `Tuhalf Print güncel (v${st.current}).`);
  });
  autoUpdater.on('update-available', (info) => {
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]+>/g, '').trim().slice(0, 600) : null;
    set({ state: canSelfInstall ? 'downloading' : 'available', latest: info.version, percent: 0, checkedAt: Date.now(), notes });
    log('info', `Yeni sürüm bulundu: v${info.version}` + (canSelfInstall ? ' — indiriliyor…' : ''));
  });
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', latest: info.version, percent: 100 });
    log('ok', `v${info.version} indirildi. "Yeniden başlat ve güncelle" ile kurulur.`);
    notify('Tuhalf Print güncellemesi hazır', `v${info.version} kurulmaya hazır.`);
  });
  autoUpdater.on('error', (e) => {
    const msg = friendly(e);
    set({ state: 'error', error: msg, checkedAt: Date.now() });
    if (manual) log('error', 'Güncelleme kontrolü başarısız: ' + msg);
  });

  async function check(isManual = false) {
    if (['checking', 'downloading', 'ready'].includes(st.state)) return { ...st };
    manual = isManual;
    try { await autoUpdater.checkForUpdates(); } catch (e) { set({ state: 'error', error: friendly(e) }); }
    return { ...st };
  }

  function install() {
    if (!canSelfInstall) { if (RELEASES_URL) shell.openExternal(RELEASES_URL); return true; }
    if (st.state !== 'ready') return false;
    if (isBusy()) { log('warn', 'Photoshop işlemi bitince güncelleyin.'); return false; }
    log('info', `v${st.latest} kuruluyor, program yeniden açılacak…`);
    beforeInstall();
    setImmediate(() => autoUpdater.quitAndInstall(true, true)); // sessiz kur, sonra ac
    return true;
  }

  function start() {
    setTimeout(() => check(false), 15000);
    setInterval(() => check(false), AUTO_EVERY_MS);
  }

  return { status: () => ({ ...st }), check, install, start };
}

function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR/i.test(m)) return 'İnternet bağlantısı yok.';
  if (/404|Unable to find latest version|No published versions/i.test(m)) return 'GitHub\'da yayınlanmış sürüm bulunamadı.';
  if (/latest\.yml/i.test(m)) return 'Sürümde latest.yml dosyası eksik.';
  return m.split('\n')[0].slice(0, 200);
}

module.exports = { createUpdater, RELEASES_URL };
