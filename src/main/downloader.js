'use strict';
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { sizeAndColor, buildName } = require('./naming');
const { dayFolderName } = require('./folders');

const QUERY = `query($cursor: String, $search: String) {
  orders(first: 50, after: $cursor, query: $search, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt
      lineItems(first: 50) { nodes { id title quantity variantTitle customAttributes { key value } } }
    }
  }
}`;

function shopHost(s) { return String(s || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
function base(cfg) { return cfg._baseUrl || `https://${shopHost(cfg.shop)}`; }

async function getToken(cfg) {
  const res = await fetch(`${base(cfg)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify erisim anahtari alinamadi (${res.status}). Mağaza adresi / Client ID / Secret kontrol edin.`);
  const j = JSON.parse(text);
  if (!j.access_token) throw new Error('Shopify erişim anahtarı boş döndü.');
  return j.access_token;
}

async function gql(cfg, token, variables) {
  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${base(cfg)}/admin/api/${cfg.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: QUERY, variables }),
    });
    if (res.status === 429) { await sleep(2000 * i); continue; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Shopify sipariş sorgusu başarısız (${res.status}).`);
    if (j.errors) {
      const t = JSON.stringify(j.errors);
      if (t.includes('THROTTLED')) { await sleep(2000 * i); continue; }
      throw new Error('Shopify hatası: ' + t.slice(0, 300));
    }
    return j.data;
  }
  throw new Error('Shopify istek limiti aşıldı.');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function downloadFile(url, dir, baseName) {
  let ext = path.extname(new URL(url).pathname).toLowerCase();
  const tmp = path.join(dir, `.indiriliyor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!ext) {
        const ct = res.headers.get('content-type') || '';
        ext = /jpe?g/.test(ct) ? '.jpg' : /pdf/.test(ct) ? '.pdf' : '.png';
      }
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      let target = path.join(dir, baseName + ext);
      for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${baseName}-Kopya${n}${ext}`);
      fs.renameSync(tmp, target);
      return path.basename(target);
    } catch (e) {
      lastErr = e;
      try { fs.rmSync(tmp, { force: true }); } catch { /* */ }
      await sleep(3000 * i);
    }
  }
  throw lastErr;
}

/**
 * Yeni siparislerin baski dosyalarini indirir.
 * @param cfg  ayarlar
 * @param done Set<string> daha once indirilen siparis id'leri (yerinde guncellenir)
 * @param log  (level, msg) => void
 */
async function runDownload(cfg, done, log) {
  if (!cfg.shop || !cfg.clientId || !cfg.clientSecret) throw new Error('Ayarlar eksik: mağaza adresini ve Shopify bilgilerini girin.');
  const token = await getToken(cfg);
  const since = new Date(Date.now() - cfg.lookbackDays * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
  const orders = [];
  let cursor = null, page;
  do {
    page = await gql(cfg, token, { cursor, search: `created_at:>='${since}'` });
    orders.push(...page.orders.nodes);
    cursor = page.orders.pageInfo.endCursor;
  } while (page.orders.pageInfo.hasNextPage);

  const folderName = dayFolderName(new Date(), cfg.dayEnd);
  const outDir = path.join(cfg.downloadDir, folderName);
  const result = { checked: orders.length, files: [], pending: [], errors: [], folder: outDir, folderName };

  for (const o of orders) {
    if (o.cancelledAt || done.has(o.id)) continue;
    const orderNo = parseInt(String(o.name).replace(/\D/g, ''), 10);
    if (cfg.firstOrderNo > 0 && orderNo < cfg.firstOrderNo) continue;
    const ageMin = (Date.now() - Date.parse(o.createdAt)) / 60000;
    if (ageMin < cfg.renderWaitMin) { result.pending.push(`#${orderNo} (render bekleniyor)`); continue; }

    const items = [];
    let missing = false;
    for (const li of o.lineItems.nodes) {
      const attrs = li.customAttributes || [];
      const links = attrs.filter((a) => /^_tib_design_link_\d+$/.test(a.key) && a.value)
        .sort((a, b) => parseInt(a.key.replace(/\D/g, ''), 10) - parseInt(b.key.replace(/\D/g, ''), 10));
      const custom = attrs.some((a) => a.key === '_customization_id' && a.value);
      if (!links.length) { if (custom) missing = true; continue; }
      const sc = sizeAndColor(li.variantTitle, cfg.colorWords);
      for (const l of links) items.push({ url: l.value, size: sc.size, color: sc.color, qty: li.quantity, title: li.title });
    }
    if (missing) {
      result.pending.push(`#${orderNo} (baskı linki henüz yok)`);
      if (ageMin >= cfg.missingWarnMin) log('warn', `#${orderNo} siparişinde baskı linki ${Math.round(ageMin)} dakikadır oluşmadı.`);
      continue;
    }
    if (!items.length) { done.add(o.id); continue; }   // baski urunu yok
    fs.mkdirSync(outDir, { recursive: true });
    try {
      let i = 0;
      for (const it of items) {
        i++;
        const file = await downloadFile(it.url, outDir, buildName(orderNo, it, i, items.length));
        result.files.push(file);
        log('ok', `İndirildi: ${file}`);
      }
      done.add(o.id);
    } catch (e) {
      result.errors.push(`#${orderNo}: ${e.message}`);
      log('error', `#${orderNo} indirilemedi, sonra tekrar denenecek (${e.message})`);
    }
  }
  return result;
}

module.exports = { runDownload, shopHost };
