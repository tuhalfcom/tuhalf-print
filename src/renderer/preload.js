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
  on: (ch, fn) => ipcRenderer.on(ch, (_e, d) => fn(d)),
});
