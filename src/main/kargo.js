'use strict';
// Kargo fisleri: Geliver gonderileri + tuhalf DHL kapida odeme etiket sunucusu.
// Elektron'a bagimli degildir (test edilebilir); baski main.js'te yapilir.

const GELIVER_API = 'https://api.geliver.io/api/v1';
const LABEL_READY = ['OFFER_ACCEPTED', 'TRACKING_CODE_CREATED', 'LABEL_PRINTED'];
const NEEDS_OFFER = ['CREATED', 'GOT_OFFERS'];
const STATUS_TR = {
  CREATED: 'Oluşturuldu', GOT_OFFERS: 'Teklif alındı', OFFER_ACCEPTED: 'Teklif kabul edildi', TRACKING_CODE_CREATED: 'Kod alındı',
  LABEL_PRINTED: 'Etiket basıldı', SHIPPED: 'Yolda', DELIVERED: 'Teslim edildi', CANCELED: 'İptal', RETURNED: 'İade',
  RETURN_SHIPPED: 'İade yolda', FAILED: 'Hatalı',
};

async function getJson(url, headers, fetchFn = fetch) {
  const r = await fetchFn(url, { headers: { Accept: 'application/json', ...headers } });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* */ }
  if (r.status === 401 || r.status === 403) { const e = new Error('Yetkisiz: erişim anahtarı yanlış ya da iptal edilmiş.'); e.status = r.status; throw e; }
  if (!r.ok) throw new Error(`HTTP ${r.status}${j && (j.additionalMessage || j.hata) ? ': ' + (j.additionalMessage || j.hata) : ''}`);
  if (!j) throw new Error('Sunucudan beklenmeyen yanıt.');
  return j;
}

// ---------- Geliver ----------
function mapShipment(s) {
  const o = s.order || {};
  const a = s.recipientAddress || {};
  const no = parseInt(String(o.orderCode || '').replace(/\D/g, ''), 10) || null;
  const cheapest = s.offers && s.offers.cheapest;
  return {
    id: s.id, no, gid: o.orderNumber || null, store: o.sourceIdentifier || '', createdAt: s.createdAt,
    name: a.name || '', city: a.cityName || a.city || '', district: a.districtName || a.district || '', address: [a.address1, a.address2].filter(Boolean).join(' '),
    phone: a.phone || '', status: s.statusCode || '', statusText: STATUS_TR[s.statusCode] || s.statusCode || '',
    provider: s.providerCode || (cheapest && cheapest.providerCode) || '', service: s.providerServiceCode || (cheapest && cheapest.providerServiceCode) || '',
    price: s.totalAmount ? Number(s.totalAmount) : cheapest ? Number(cheapest.totalAmount) : null,
    desi: s.desi != null ? Number(s.desi) : null,
    labelUrl: s.responsiveLabelURL || null, pdfUrl: s.labelURL || null,
    tracking: s.trackingNumber || s.barcode || '', trackingUrl: s.trackingUrl || '',
    hasError: !!s.hasError, error: s.lastErrorMessage || '',
  };
}

// Son N gunun Geliver gonderileri (en yeniden eskiye)
async function geliverShipments(token, days = 14, fetchFn = fetch) {
  if (!token) throw new Error('Geliver erişim anahtarı girilmemiş (Tercihler > Kargo).');
  const since = Date.now() - days * 864e5;
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const j = await getJson(`${GELIVER_API}/shipments?page=${page}&limit=100`, { Authorization: 'Bearer ' + token }, fetchFn);
    const rows = j.data || [];
    let older = false;
    for (const s of rows) { if (Date.parse(s.createdAt) < since) { older = true; continue; } out.push(mapShipment(s)); }
    if (older || !rows.length || page >= (j.totalPages || 1)) break;
  }
  return out;
}

// Gonderiyi siniflandir: ready (etiket basilabilir) | offer (teklif bekliyor) | done (yolda/teslim/iptal)
function geliverKind(s) {
  if (LABEL_READY.includes(s.status) && s.labelUrl) return 'ready';
  if (NEEDS_OFFER.includes(s.status)) return 'offer';
  if (s.status === 'FAILED') return 'offer';
  return 'done';
}

// Adres hatasi: Geliver hata bildirdi ya da il/ilce bos (etiket alinamaz)
function geliverAddressError(s) {
  if (s.hasError && s.error) return s.error;
  if (s.hasError) return 'Geliver gönderide hata bildirdi';
  if (['CREATED', 'GOT_OFFERS', 'FAILED'].includes(s.status) && (!s.city || !s.district)) return !s.city ? 'İl bilgisi eksik' : 'İlçe bilgisi eksik';
  return null;
}

// ---------- Kapida odeme (tuhalf etiket sunucusu) ----------
function codBase(url) { return String(url || '').trim().replace(/\/+$/, ''); }

async function codOrders(cfg, days = 14, fetchFn = fetch) {
  if (!cfg.codUrl || !cfg.codKey) throw new Error('Kapıda ödeme etiket sunucusu ayarlanmamış (Tercihler > Kargo).');
  const j = await getJson(`${codBase(cfg.codUrl)}/api/kapida?gun=${days}`, { Authorization: 'Bearer ' + cfg.codKey }, fetchFn);
  return { orders: j.siparisler || [], test: !!j.deneme };
}

// Secilen siparislerin etiketlerini hazirlar (DHL'e kaydeder). { html, etiketler: [no], hatalar: [[ad, mesaj]], deneme }
async function codLabels(cfg, ids, fetchFn = fetch) {
  if (!ids.length) return { html: '', etiketler: [], hatalar: [] };
  return getJson(`${codBase(cfg.codUrl)}/api/etiket?ids=${encodeURIComponent(ids.join(','))}`, { Authorization: 'Bearer ' + cfg.codKey }, fetchFn);
}

module.exports = { geliverShipments, geliverKind, geliverAddressError, mapShipment, codOrders, codLabels, STATUS_TR };
