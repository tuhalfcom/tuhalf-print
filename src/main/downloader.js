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
      id name createdAt cancelledAt displayFinancialStatus paymentGatewayNames shippingLine { title }
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

async function gql(cfg, token, variables, query = QUERY) {
  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${base(cfg)}/admin/api/${cfg.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) { await sleep(2000 * i); continue; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Shopify sipariş sorgusu başarısız (${res.status}).`);
    if (j.errors) {
      const t = JSON.stringify(j.errors);
      if (t.includes('THROTTLED')) { await sleep(2000 * i); continue; }
      const err = new Error('Shopify hatası: ' + t.slice(0, 300));
      err.gqlErrors = t;
      throw err;
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

// Ayni adli dosya (uzanti haric) son gun klasorlerinde ya da _Dizildi altinda var mi
function existsAny(root, baseName) {
  let days = [];
  try { days = fs.readdirSync(root).filter((d) => /SIPARISLER$/i.test(d)).map((d) => path.join(root, d)); } catch { return false; }
  for (const d of days) {
    for (const dir of [d, path.join(d, '_Dizildi')]) {
      try { if (fs.readdirSync(dir).some((f) => f.slice(0, f.length - path.extname(f).length) === baseName)) return true; } catch { /* */ }
    }
  }
  return false;
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

  // Yeniden indirme modu: bu numaradan itibaren daha once indirilmis siparisler de tekrar indirilir
  const redo = Number(cfg.redownloadFrom) > 0 ? Number(cfg.redownloadFrom) : 0;
  result.redo = redo;
  orders.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  result.payments = orders.map(payInfo);   // odeme durumu: havale bekleyen / iptal siparisler basilmaz
  for (const o of orders) {
    const orderNo = parseInt(String(o.name).replace(/\D/g, ''), 10);
    if (o.cancelledAt) continue;
    if (redo) { if (orderNo < redo) continue; }
    else {
      if (done.has(o.id)) continue;
      if (cfg.ignoreBefore && Date.parse(o.createdAt) < cfg.ignoreBefore) continue;   // resetten onceki siparis
      if (cfg.firstOrderNo > 0 && orderNo < cfg.firstOrderNo) continue;
    }
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
        const baseName = buildName(orderNo, it, i, items.length);
        // Yeniden indirmede ayni dosya zaten bu klasorde (veya _Dizildi'de) varsa kopya olusturma
        if (redo && existsAny(cfg.downloadDir, baseName)) { result.skipped = (result.skipped || 0) + 1; continue; }
        const file = await downloadFile(it.url, outDir, baseName);
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

// ---------- Odeme durumu / baski bekletme ----------
const isCodText = (g) => /cash on delivery|\bcod\b|kap[ıi]da/i.test(g || '');
function payInfo(o) {
  return {
    no: parseInt(String(o.name).replace(/\D/g, ''), 10), cancelled: !!o.cancelledAt,
    financial: o.displayFinancialStatus || o.financial || '', gateways: o.paymentGatewayNames || o.gateways || [],
    shipping: (o.shippingLine && o.shippingLine.title) || o.shipping || '',
  };
}
// Basilmamasi gereken siparis icin sebep, yoksa null.
// Odeme "bekleniyor" + kargo "Standart" (kapida odeme degil) = havale: para gelmeden kisiye ozel urun basilmaz.
function holdReason(p) {
  if (!p) return null;
  if (p.cancelled) return 'Sipariş iptal edildi';
  if (['REFUNDED', 'VOIDED'].includes(p.financial)) return 'Ödeme iade edildi';
  const cod = (p.gateways || []).some(isCodText) || isCodText(p.shipping);
  const unpaid = ['PENDING', 'PARTIALLY_PAID', 'EXPIRED'].includes(p.financial);
  const transfer = /standar/i.test(p.shipping) || (p.gateways || []).some((g) => /havale|eft|bank|banka|manual|manuel/i.test(g));
  if (unpaid && !cod && transfer) return 'Ödeme bekleniyor (havale)';
  return null;
}
// Belirli siparislerin guncel odeme durumunu getirir (bekletilenler yeniden kontrol edilir)
const STATUS_QUERY = `query($search: String) {
  orders(first: 100, query: $search) { nodes { name cancelledAt displayFinancialStatus paymentGatewayNames shippingLine { title } } }
}`;
async function fetchPayStatuses(cfg, nos) {
  if (!nos.length || !cfg.shop || !cfg.clientId || !cfg.clientSecret) return [];
  const token = await getToken(cfg);
  const out = [];
  for (let i = 0; i < nos.length; i += 50) {
    const search = nos.slice(i, i + 50).map((n) => `name:#${n}`).join(' OR ');
    const d = await gql(cfg, token, { search }, STATUS_QUERY);
    out.push(...d.orders.nodes.map(payInfo));
  }
  return out;
}

// ---------- Siparisler sayfasi: detayli siparis bilgisi ----------
const DETAIL_FIELDS = (pii) => `
  id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
  totalPriceSet { shopMoney { amount currencyCode } }
  shippingLine { title }
  ${pii ? 'shippingAddress { name city province } billingAddress { name } customer { displayName }' : ''}
  lineItems(first: 50) { nodes { title quantity variantTitle } }`;
const detailQuery = (pii) => `query($cursor: String, $search: String) {
  orders(first: 100, after: $cursor, query: $search, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { ${DETAIL_FIELDS(pii)} }
  }
}`;

// Shopify'dan son N gunun siparislerini ozet bilgileriyle getirir.
// Musteri adi/sehir "korunan musteri verisi" izni ister; izin yoksa bu alanlar olmadan tekrar dener.
async function fetchOrderDetails(cfg, days = 14) {
  if (!cfg.shop || !cfg.clientId || !cfg.clientSecret) throw new Error('Shopify bilgileri eksik.');
  cfg = { apiVersion: '2025-10', ...cfg };
  const token = await getToken(cfg);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  async function all(pii) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 20; page++) {
      const d = await gql(cfg, token, { cursor, search: `created_at:>=${since}` }, detailQuery(pii));
      out.push(...d.orders.nodes);
      if (!d.orders.pageInfo.hasNextPage) break;
      cursor = d.orders.pageInfo.endCursor;
    }
    return out;
  }
  let nodes, pii = true;
  try { nodes = await all(true); }
  catch (e) {
    if (!/ACCESS_DENIED|access denied|not approved|protected customer|Customer object/i.test(e.gqlErrors || e.message)) throw e;
    pii = false; nodes = await all(false);
  }
  return {
    pii,
    orders: nodes.map((o) => {
      const no = parseInt(String(o.name).replace(/\D/g, ''), 10);
      const name = (o.shippingAddress && o.shippingAddress.name) || (o.billingAddress && o.billingAddress.name) || (o.customer && o.customer.displayName) || '';
      return {
        no, name, city: (o.shippingAddress && (o.shippingAddress.city || o.shippingAddress.province)) || '',
        createdAt: o.createdAt, cancelled: !!o.cancelledAt,
        financial: o.displayFinancialStatus || '', fulfillment: o.displayFulfillmentStatus || '',
        gateways: o.paymentGatewayNames || [], shipping: (o.shippingLine && o.shippingLine.title) || '',
        total: o.totalPriceSet ? Number(o.totalPriceSet.shopMoney.amount) : null, currency: o.totalPriceSet ? o.totalPriceSet.shopMoney.currencyCode : '',
        items: (o.lineItems.nodes || []).map((l) => ({ title: l.title, variant: l.variantTitle || '', qty: l.quantity })),
      };
    }),
  };
}

// Siparislerin guncel teslimat adresi (adres hatasi duzeltmesi icin). gids: Shopify Order GID ya da sayisal id
const ADDR_QUERY = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id name phone shippingAddress { name address1 address2 city province provinceCode zip phone } } } }`;
async function fetchOrderAddresses(cfg, gids) {
  if (!gids.length || !cfg.shop || !cfg.clientId || !cfg.clientSecret) return {};
  cfg = { apiVersion: '2025-10', ...cfg };
  const token = await getToken(cfg);
  const ids = gids.map((g) => (String(g).startsWith('gid://') ? String(g) : `gid://shopify/Order/${String(g).replace(/\D/g, '')}`));
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const d = await gql(cfg, token, { ids: ids.slice(i, i + 50) }, ADDR_QUERY);
    for (const o of d.nodes || []) if (o && o.shippingAddress) out[o.id.replace(/\D/g, '')] = { ...o.shippingAddress, phone: o.shippingAddress.phone || o.phone || '' };
  }
  return out;
}

module.exports = { runDownload, shopHost, fetchOrderDetails, fetchPayStatuses, holdReason, payInfo, fetchOrderAddresses };
