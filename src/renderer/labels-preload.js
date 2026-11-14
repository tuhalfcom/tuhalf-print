'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lapi', {
  job: () => ipcRenderer.invoke('labels-job'),
  printers: () => ipcRenderer.invoke('labels-printers'),
  print: (o) => ipcRenderer.invoke('labels-print', o),
});
