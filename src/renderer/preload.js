'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  orders: () => ipcRenderer.invoke('orders'),
  plan: (force) => ipcRenderer.invoke('plan', force),
  sheets: () => ipcRenderer.invoke('sheets'),
  checkNow: () => ipcRenderer.invoke('check-now'),
  build: (force) => ipcRenderer.invoke('build', force),
  markPrinted: (p, on) => ipcRenderer.invoke('mark-printed', p, on),
  redownload: (from) => ipcRenderer.invoke('redownload', from),
  resetFiles: () => ipcRenderer.invoke('reset-files'),
  ordersDetail: (force, days) => ipcRenderer.invoke('orders-detail', force, days),
  orderInfo: (no) => ipcRenderer.invoke('order-info', no),
  redownloadOne: (no) => ipcRenderer.invoke('redownload-one', no),
  daySummary: () => ipcRenderer.invoke('day-summary'),
  notify: (t, b) => ipcRenderer.invoke('notify', t, b),
  stations: () => ipcRenderer.invoke('stations'),
  todayStats: (force) => ipcRenderer.invoke('today-stats', force),
  ordersSeen: () => ipcRenderer.invoke('orders-seen'),
  kargo: (force) => ipcRenderer.invoke('kargo', force),
  printers: () => ipcRenderer.invoke('printers'),
  geliverSync: (id) => ipcRenderer.invoke('geliver-sync', id),
  geliverLogin: () => ipcRenderer.invoke('geliver-login'),
  geliverBuyBulk: (ids) => ipcRenderer.invoke('geliver-buy-bulk', ids),
  geliverBuy: (id) => ipcRenderer.invoke('geliver-buy', id),
  labelsOpen: (kind, ids) => ipcRenderer.invoke('labels-open', kind, ids),
  kargoDays: (d) => ipcRenderer.invoke('kargo-days', d),
  labelMark: (keys, on) => ipcRenderer.invoke('label-mark', keys, on),
  openUrl: (u) => ipcRenderer.invoke('open-url', u),
  settingsExport: () => ipcRenderer.invoke('settings-export'),
  phoneLink: () => ipcRenderer.invoke('phone-link'),
  phoneEnable: (on) => ipcRenderer.invoke('phone-enable', on),
  settingsImport: () => ipcRenderer.invoke('settings-import'),
  openInPhotoshop: (p) => ipcRenderer.invoke('open-in-ps', p),
  pickCard: () => ipcRenderer.invoke('pick-card'),
  cardThumb: () => ipcRenderer.invoke('card-thumb'),
  print: (paths) => ipcRenderer.invoke('print', paths),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showItem: (p) => ipcRenderer.invoke('show-item', p),
  saveConfig: (c) => ipcRenderer.invoke('save-config', c),
  pick: (kind) => ipcRenderer.invoke('pick', kind),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  // Sandbox'li preload'da url.pathToFileURL yok: dosya yolunu elle file:// adresine cevir
  fileUrl: (p) => {
    if (!p) return '';
    let s = String(p).replace(/\\/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
  },
  askReply: (id, response) => ipcRenderer.send('ask-reply', id, response),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, d) => fn(d)),
});
