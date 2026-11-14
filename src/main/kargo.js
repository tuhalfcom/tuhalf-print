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
const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const PREFERRED = /hepsi\s*-?\s*jet/i;   // daima calistigimiz kargo
function mapOffer(o) {
  return { id: o.id, provider: o.providerCode || '', service: o.providerServiceCode || '', total: pos(o.totalAmount) || pos(o.totalAmountLocal) || pos(o.amount), accepted: !!o.isAccepted };
}
// Gonderinin HepsiJet teklifi (birden fazlaysa en ucuzu)
function preferredOffer(s) {
  const list = ((s.offers && s.offers.list) || []).concat(s.offers && s.offers.cheapest ? [s.offers.cheapest] : []).map(mapOffer)
    .filter((o) => o.id && o.total && PREFERRED.test(o.provider + ' ' + o.service));
  list.sort((a, b) => a.total - b.total);
  return list[0] || null;
}
function mapShipment(s) {
  const o = s.order || {};
  const a = s.recipientAddress || {};
  const no = parseInt(String(o.orderCode || '').replace(/\D/g, ''), 10) || null;
  const cheapest = s.offers && s.offers.cheapest;
  const hj = preferredOffer(s);
  return {
    id: s.id, no, gid: o.orderNumber || null, store: o.sourceIdentifier || '', createdAt: s.createdAt,
    name: a.name || '', city: a.cityName || a.city || '', district: a.districtName || a.district || '', address: [a.address1, a.address2].filter(Boolean).join(' '),
    phone: a.phone || '', status: s.statusCode || '', statusText: STATUS_TR[s.statusCode] || s.statusCode || '',
    provider: s.providerCode || (cheapest && cheapest.providerCode) || '', service: s.providerServiceCode || (cheapest && cheapest.providerServiceCode) || '',
    price: pos(s.totalAmount) || (hj && hj.total) || (cheapest ? pos(cheapest.totalAmount) : null),
    desi: pos(s.desi),
    hepsijet: hj,
    labelUrl: s.responsiveLabelURL || null, pdfUrl: s.labelURL || null,
    tracking: s.trackingNumber || s.barcode || '', trackingUrl: s.trackingUrl || '',
    hasError: !!s.hasError, error: s.lastErrorMessage || '',
  };
}

// Geliver bakiyesi (TL). Yanit bicimi kesin bilinmedigi icin esnek okunur; olmazsa organizasyon bilgisine bakilir.
function pickBalance(d) {
  if (d == null) return null;
  if (typeof d === 'number' || (typeof d === 'string' && d.trim() !== '' && Number.isFinite(Number(d)))) return Number(d);
  if (typeof d !== 'object') return null;
  for (const key of ['balance', 'availableBalance', 'totalBalance', 'creditBalance', 'amount', 'value']) {
    if (d[key] != null && Number.isFinite(Number(d[key]))) return Number(d[key]) - (key === 'creditBalance' && Number.isFinite(Number(d.debitBalance)) ? Number(d.debitBalance) : 0);
  }
  for (const v of Object.values(d)) if (v && typeof v === 'object') { const n = pickBalance(v); if (n != null) return n; }
  return null;
}
async function geliverBalance(token, fetchFn = fetch) {
  const H = { Authorization: 'Bearer ' + token };
  let first = null;
  try {
    const j = await getJson(`${GELIVER_API}/user/balance`, H, fetchFn);
    const n = pickBalance(j.data !== undefined ? j.data : j);
    if (n != null) return n;
    first = 'yanıt: ' + JSON.stringify(j).slice(0, 120);
  } catch (e) { first = e.message; }
  try {
    const j = await getJson(`${GELIVER_API}/organizations`, H, fetchFn);
    const org = Array.isArray(j.data) ? j.data[0] : j.data;
    const n = org ? pickBalance({ creditBalance: org.creditBalance, debitBalance: org.debitBalance, balance: org.balance }) : null;
    if (n != null) return n;
  } catch { /* */ }
  throw new Error('Bakiye okunamadı (' + first + ')');
}
async function geliverShipment(token, id, fetchFn = fetch) {
  const j = await getJson(`${GELIVER_API}/shipments/${encodeURIComponent(id)}`, { Authorization: 'Bearer ' + token }, fetchFn);
  return mapShipment(j.data || {});
}
// Teklifi kabul et = etiketi satin al (bakiyeden duser)
async function geliverBuy(token, offerID, fetchFn = fetch) {
  const r = await fetchFn(`${GELIVER_API}/transactions`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ offerID }), signal: AbortSignal.timeout(120000),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* */ }
  if (r.status === 402) throw new Error('Geliver bakiyesi yetersiz. Bakiye ekleyip tekrar deneyin.');
  if (!r.ok || (j && j.result === false)) throw new Error((j && (j.additionalMessage || j.message)) || `Geliver HTTP ${r.status}`);
  return j && j.data && j.data.id ? mapShipment(j.data) : null;
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

// Etiket sunucusu uzerinden siparis adresleri (Tuhalf Print'in Shopify izni yetmezse)
async function codAddresses(cfg, gids, fetchFn = fetch) {
  if (!gids.length || !cfg.codUrl || !cfg.codKey) return {};
  const ids = gids.map((g) => (String(g).startsWith('gid://') ? g : `gid://shopify/Order/${String(g).replace(/\D/g, '')}`));
  const j = await getJson(`${codBase(cfg.codUrl)}/api/adres?ids=${encodeURIComponent(ids.join(','))}`, { Authorization: 'Bearer ' + cfg.codKey }, fetchFn);
  return j.adresler || {};
}

// ---------- Adres hatasi duzeltme: Shopify adresini Geliver gonderisine aktar ----------
const IL = ['Adana','Adıyaman','Afyonkarahisar','Ağrı','Amasya','Ankara','Antalya','Artvin','Aydın','Balıkesir','Bilecik','Bingöl','Bitlis','Bolu','Burdur','Bursa','Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Edirne','Elazığ','Erzincan','Erzurum','Eskişehir','Gaziantep','Giresun','Gümüşhane','Hakkari','Hatay','Isparta','Mersin','İstanbul','İzmir','Kars','Kastamonu','Kayseri','Kırklareli','Kırşehir','Kocaeli','Konya','Kütahya','Malatya','Manisa','Kahramanmaraş','Mardin','Muğla','Muş','Nevşehir','Niğde','Ordu','Rize','Sakarya','Samsun','Siirt','Sinop','Sivas','Tekirdağ','Tokat','Trabzon','Tunceli','Şanlıurfa','Uşak','Van','Yozgat','Zonguldak','Aksaray','Bayburt','Karaman','Kırıkkale','Batman','Şırnak','Bartın','Ardahan','Iğdır','Yalova','Karabük','Kilis','Osmaniye','Düzce'];
const TRMAP = { 'ı': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };
function norm(x) {
  let t = String(x == null ? '' : x).replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  t = t.replace(/[ıüşöçğâîû]/g, (h) => TRMAP[h]);
  return t.replace(/[^a-z0-9]+/g, ' ').trim();
}
const IL_KOD = Object.fromEntries(IL.map((n, i) => [norm(n), String(i + 1).padStart(2, '0')]));
IL_KOD[norm('Icel')] = '33'; IL_KOD[norm('Afyon')] = '03'; IL_KOD[norm('Maras')] = '46'; IL_KOD[norm('Urfa')] = '63'; IL_KOD[norm('Antep')] = '27';

// Il adayi listesi: once musterinin yazdigi sehir/adres, sonra Shopify'da secilen il.
// (Musteri ili yanlis secip adrese dogrusunu yazabiliyor: or. Il=Afyon, Sehir=Istanbul)
function cityCandidates(a) {
  const out = [];
  const add = (k) => { if (k && !out.includes(k)) out.push(k); };
  add(IL_KOD[norm(a.city)]);
  const text = ` ${norm([a.city, a.address1, a.address2].join(' '))} `;
  for (const [n, k] of Object.entries(IL_KOD)) if (text.includes(` ${n} `)) add(k);
  const pc = String(a.provinceCode || '').toUpperCase();
  if (/^TR-\d{1,2}$/.test(pc)) add(pc.slice(3).padStart(2, '0'));
  add(IL_KOD[norm(a.province)]);
  return out;
}
function cityCodeOf(a) {
  const pc = String(a.provinceCode || '').toUpperCase();
  if (/^TR-\d{1,2}$/.test(pc)) return pc.slice(3).padStart(2, '0');
  for (const f of [a.province, a.city]) { const k = IL_KOD[norm(f)]; if (k) return k; }
  return cityCandidates(a)[0] || null;
}
function shopifyIlOf(a) {
  const pc = String(a.provinceCode || '').toUpperCase();
  const k = /^TR-\d{1,2}$/.test(pc) ? pc.slice(3).padStart(2, '0') : IL_KOD[norm(a.province)];
  return k ? IL[Number(k) - 1] : '';
}

const districtCache = new Map();
async function geliverDistricts(token, cityCode, fetchFn = fetch) {
  if (!districtCache.has(cityCode)) {
    const j = await getJson(`${GELIVER_API}/districts?cityCode=${encodeURIComponent(cityCode)}&countryCode=TR`, { Authorization: 'Bearer ' + token }, fetchFn);
    districtCache.set(cityCode, j.data || []);
  }
  return districtCache.get(cityCode);
}

// Shopify adresini Geliver adres bicimine cevirir. { address } ya da { error }
function findDistrict(ds, ilAdi, a) {
  for (const field of [a.city, a.address2, a.address1]) {
    const t = ` ${norm(field)} `;
    const hits = ds.filter((x) => norm(x.name) && norm(x.name) !== norm(ilAdi) && t.includes(` ${norm(x.name)} `));
    if (hits.length) return hits.sort((x, y) => y.name.length - x.name.length)[0];
  }
  return null;
}
async function toGeliverAddress(token, a, fetchFn = fetch) {
  if (!a) return { error: 'Shopify adresi okunamadı' };
  const cands = cityCandidates(a);
  if (!cands.length) return { error: 'Shopify adresinde il bulunamadı — Shopify\'da “İl” alanını seçin' };
  let cityCode = null, d = null;
  for (const c of cands) {
    const found = findDistrict(await geliverDistricts(token, c, fetchFn), IL[Number(c) - 1] || '', a);
    if (found) { cityCode = c; d = found; break; }
  }
  if (!d) {
    // Ilce yazilmamis: sehir alani il adinin kendisiyse Merkez ilcesi
    for (const c of cands) {
      if (IL_KOD[norm(a.city)] !== c) continue;
      const m = (await geliverDistricts(token, c, fetchFn)).find((x) => norm(x.name) === 'merkez');
      if (m) { cityCode = c; d = m; break; }
    }
  }
  const iller = cands.map((c) => IL[Number(c) - 1]).join(' / ');
  if (!d) return { error: `Adreste ilçe bulunamadı (${iller}). Shopify'da adres satırına ya da “Şehir” alanına ilçeyi yazın, sonra Yenile.` };
  const ilAdi = IL[Number(cityCode) - 1];
  const sIl = shopifyIlOf(a);
  const name = a.name || [a.firstName, a.lastName].filter(Boolean).join(' ');
  return {
    address: {
      name, phone: a.phone || '', address1: a.address1 || '', address2: a.address2 || '',
      zip: /^\d{5}$/.test(String(a.zip || '').trim()) ? String(a.zip).trim() : '',
      countryCode: 'TR', cityCode, cityName: ilAdi, districtID: d.districtID, districtName: d.name, isRecipientAddress: true,
    },
    note: sIl && norm(sIl) !== norm(ilAdi) ? `Shopify'da il “${sIl}” seçili, ama adreste ${ilAdi} / ${d.name} yazıyor — ${ilAdi} kullanıldı.` : '',
  };
}

// Geliver'deki adres Shopify'dakinden farkli mi (duzeltilmis mi)
function addressChanged(s, a) {
  if (!a) return false;
  return norm(s.address) !== norm([a.address1, a.address2].filter(Boolean).join(' ')) || norm(s.city) !== norm(IL[Number(cityCodeOf(a) || 0) - 1] || a.province || '') || !s.district || /BULUNAMADI/i.test(s.district);
}

async function updateGeliverAddress(token, shipmentId, address, fetchFn = fetch) {
  const r = await fetchFn(`${GELIVER_API}/shipments/${encodeURIComponent(shipmentId)}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ recipientAddress: address }),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* */ }
  if (!r.ok || (j && j.result === false)) throw new Error((j && (j.additionalMessage || j.message)) || `Geliver HTTP ${r.status}`);
  return j && j.data ? mapShipment(j.data) : null;
}

module.exports = { geliverBalance, geliverShipment, geliverBuy, preferredOffer, geliverShipments, geliverKind, geliverAddressError, mapShipment, codOrders, codLabels, STATUS_TR, toGeliverAddress, updateGeliverAddress, addressChanged, cityCodeOf, cityCandidates, norm, codAddresses };
