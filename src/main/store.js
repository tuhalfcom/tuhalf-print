'use strict';
const fs = require('fs');
const path = require('path');

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(extra || {})) {
    const v = extra[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else out[k] = v;
  }
  return out;
}

class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = deepMerge(defaults, this._read());
  }
  _read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, '')); } catch { return {}; }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
  set(patch) { this.data = deepMerge(this.data, patch); this.save(); }
}

module.exports = { JsonStore, deepMerge };
