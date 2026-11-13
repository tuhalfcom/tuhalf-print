'use strict';
// Dosya adlandirma: 2266-30x42-Siyah[-Urun-1][-2Adet].png
const TR = { 'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U' };

function toAscii(s) {
  return String(s || '')
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR[c])
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toTitle(key) {
  return key.split('-').filter(Boolean).map((p) => p[0] + p.slice(1).toLowerCase()).join('');
}

const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)/;

function sizeAndColor(variantTitle, colorWords) {
  const opts = String(variantTitle || '').split(/\s*\/\s*/).filter(Boolean);
  let size = null, color = null;
  const rest = [];
  for (const o of opts) {
    const m = !size && o.match(SIZE_RE);
    if (m) size = `${m[1]}x${m[2]}`.replace(/,/g, '.');
    else rest.push(o);
  }
  for (const o of rest) if (toAscii(o).includes('CERCEVESIZ')) color = 'CERCEVESIZ';
  if (!color) {
    const words = (colorWords || []).map(toAscii);
    outer: for (const o of rest) {
      const v = toAscii(o);
      for (const w of words) if (new RegExp(`(^|-)${w}($|-)`).test(v)) { color = v; break outer; }
    }
  }
  if (!color && rest.length) color = toAscii(rest[rest.length - 1]);
  return { size: size || 'EbatYok', color: toTitle(color || 'RENK-YOK') };
}

function buildName(orderNo, item, index, total) {
  let n = `${orderNo}-${item.size}-${item.color}`;
  if (total > 1) n += `-Urun-${index}`;
  if (item.qty > 1) n += `-${item.qty}Adet`;
  return n;
}

// Dosya adini cozer
const NAME_RE = /^(\d+)-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)-(.+?)(?:-Urun-(\d+))?(?:-(\d+)Adet)?(?:-Kopya\d+)?\.(png|jpe?g|tiff?|psd)$/i;
function parseName(fileName) {
  const m = fileName.match(NAME_RE);
  if (!m) return null;
  return {
    order: parseInt(m[1], 10), wCm: parseFloat(m[2]), hCm: parseFloat(m[3]), size: `${m[2]}x${m[3]}`,
    color: m[4], urun: m[5] ? parseInt(m[5], 10) : 0, qty: m[6] ? parseInt(m[6], 10) : 1,
  };
}

module.exports = { toAscii, toTitle, sizeAndColor, buildName, parseName, NAME_RE };
