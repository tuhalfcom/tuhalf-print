'use strict';
// Electron olmadan calisan testler: adlandirma, yerlesim, klasor tarama, Shopify indirme (sahte sunucu)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const N = require('../src/main/naming');
const F = require('../src/main/folders');
const { packAll } = require('../src/main/packer');
const { runDownload, fetchOrderDetails, holdReason } = require('../src/main/downloader');

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('  ✓ ' + name); };

(async () => {
  console.log('Adlandirma');
  await t('Siyah (Turkce I sorunu yok)', () => assert.deepStrictEqual(N.sizeAndColor('Çerçeveli Poster / Siyah / 30x42 cm', ['Siyah']), { size: '30x42', color: 'Siyah' }));
  await t('Cercevesiz', () => assert.strictEqual(N.sizeAndColor('Çerçevesiz Poster / 50x70 cm').color, 'Cercevesiz'));
  await t('Iki kelimeli renk', () => assert.strictEqual(N.sizeAndColor('Çerçeveli / Ahşap Ceviz / 21x30', ['Ceviz']).color, 'AhsapCeviz'));
  await t('Dosya adi', () => assert.strictEqual(N.buildName(2270, { size: '30x42', color: 'Siyah', qty: 2 }, 1, 2), '2270-30x42-Siyah-Urun-1-2Adet'));
  await t('Ad cozumleme', () => assert.deepStrictEqual(N.parseName('2270-30x42-Siyah-Urun-1-2Adet.png'),
    { order: 2270, wCm: 30, hCm: 42, size: '30x42', color: 'Siyah', urun: 1, qty: 2 }));

  console.log('Yerlesim');
  const cfg = { width: 609.6, maxLength: 720.01, margin: 3, gap: 1 };
  const mk = (l) => l.map((x, i) => { const [w, h] = x.split('x').map(Number); return { name: `${2266 + i}-${x}`, w: w * 10, h: h * 10 }; });
  const noOverlap = (s, g) => {
    for (let a = 0; a < s.items.length; a++) for (let b = a + 1; b < s.items.length; b++) {
      const A = s.items[a], B = s.items[b];
      assert.ok(A.x + A.w + g <= B.x + 1e-6 || B.x + B.w + g <= A.x + 1e-6 || A.y + A.h + g <= B.y + 1e-6 || B.y + B.h + g <= A.y + 1e-6, 'cakisma / 1 mm bosluk yok');
    }
    for (const p of s.items) assert.ok(p.x >= 3 - 1e-6 && p.y >= 3 - 1e-6 && p.x + p.w <= 606.6 + 1e-6 && p.y + p.h <= 717.01 + 1e-6, 'sayfa disi');
  };
  await t('Sayfa hep 609,6 x 720,01', () => {
    const r = packAll(mk(['30x42', '30x42', '21x30', '21x30']), cfg);
    r.sheets.forEach((s) => { assert.strictEqual(s.width, 609.6); assert.strictEqual(s.length, 720.01); });
  });
  await t('30x42 + 2 x 15x21 + yatay 21x30 (ornek dizilim), fazla 15x21 bekler', () => {
    const r = packAll(mk(['30x42', '15x21', '15x21', '21x30', '15x21']), cfg);
    assert.strictEqual(r.sheets.length, 1);
    const s = r.sheets[0], by = (n) => s.items.find((p) => p.item.name === n);
    assert.ok(!by('2266-30x42').rotated && by('2269-21x30').rotated);
    assert.ok(by('2267-15x21').x > 300 && by('2268-15x21').x > 300 && by('2269-21x30').x > 300, 'hepsi 30x42 nin saginda');
    assert.deepStrictEqual(r.waiting.map((i) => i.name), ['2270-15x21']);
    noOverlap(s, 1);
  });
  await t('Tek 30x42 bekler; "bekleyenleri de diz" ile yatay basilir', () => {
    assert.strictEqual(packAll(mk(['30x42']), cfg).sheets.length, 0);
    const r = packAll(mk(['30x42']), cfg, { force: true });
    assert.ok(r.sheets[0].items[0].rotated && r.sheets[0].items[0].w === 420);
  });
  await t('2 x 30x42 yan yana, 3. 21x30 bekler', () => {
    const r = packAll(mk(['30x42', '30x42', '21x30', '21x30', '21x30']), cfg);
    assert.strictEqual(r.sheets.length, 1); assert.strictEqual(r.waiting.length, 1);
    assert.ok(r.sheets[0].items.filter((p) => p.item.w === 300).every((p) => !p.rotated));
  });
  await t('Ara bosluk ayari 0 olsa bile tasarimlar arasi en az 1 mm', () => {
    const r = packAll(mk(['30x42', '15x21', '15x21', '21x30', '30x42', '30x42']), { ...cfg, gap: 0, card: { w: 90, h: 140, file: 'k' } });
    r.sheets.forEach((s) => noOverlap(s, 1));
  });
  await t('50x70 yanina ve bosluklara tesekkur karti', () => {
    const r = packAll(mk(['50x70']), { ...cfg, card: { w: 100, h: 200, file: 'k.png' } });
    const cards = r.sheets[0].items.filter((p) => p.item.isCard);
    assert.ok(cards.length >= 3 && cards.every((c) => c.x > 500)); noOverlap(r.sheets[0], 1);
  });
  await t('Karisik 60 siparis: cakisma yok, sayfa disina tasma yok', () => {
    const r = packAll(mk(Array.from({ length: 60 }, (_, i) => ['30x42', '21x30', '15x21', '50x70', '15x21'][(i * 7) % 5])), { ...cfg, card: { w: 90, h: 140, file: 'k' } });
    assert.ok(r.sheets.length > 5); r.sheets.forEach((s) => noOverlap(s, 1));
  });

  console.log('Odeme durumu');
  await t('Havale: odeme bekleniyor + Standart kargo -> basilmaz', () =>
    assert.strictEqual(holdReason({ financial: 'PENDING', gateways: ['manual'], shipping: 'Standart' }), 'Ödeme bekleniyor (havale)'));
  await t('Kapida odeme beklemede olsa da basilir', () => {
    assert.strictEqual(holdReason({ financial: 'PENDING', gateways: ['Cash on Delivery (COD)'], shipping: 'Kapıda Ödeme' }), null);
    assert.strictEqual(holdReason({ financial: 'PENDING', gateways: ['Kapıda Ödeme'], shipping: 'Standart' }), null);
  });
  await t('Havale odemesi gelince (Odendi) basilir', () =>
    assert.strictEqual(holdReason({ financial: 'PAID', gateways: ['manual'], shipping: 'Standart' }), null));
  await t('Iptal / iade edilen siparis basilmaz', () => {
    assert.ok(holdReason({ cancelled: true, financial: 'PAID' }));
    assert.ok(holdReason({ financial: 'REFUNDED', shipping: 'Standart' }));
  });
  await t('Durumu bilinmeyen siparis engellenmez', () => assert.strictEqual(holdReason(undefined), null));

  console.log('Kargo fisleri');
  const K = require('../src/main/kargo');
  const now = Date.now(), ago = (h) => new Date(now - h * 3600e3).toISOString();
  const SH = (id, st, h, ek = {}) => ({ id, statusCode: st, createdAt: ago(h), order: { orderCode: '#' + id, orderNumber: '78' + id, sourceIdentifier: 'x.myshopify.com' },
    recipientAddress: { name: 'Ad ' + id, cityName: 'İzmir', districtName: 'Urla', address1: 'Sokak 1' }, responsiveLabelURL: LABEL_READY_URL(st, id), labelURL: null, trackingNumber: 'GLV' + id, ...ek });
  const LABEL_READY_URL = (st, id) => (['TRACKING_CODE_CREATED', 'OFFER_ACCEPTED', 'LABEL_PRINTED', 'SHIPPED'].includes(st) ? 'https://api.geliver.io/api/v1/responsivelabels/' + id + '/600d' : null);
  const pages = [[SH(2270, 'TRACKING_CODE_CREATED', 1), SH(2269, 'GOT_OFFERS', 2, { recipientAddress: { name: 'X', cityName: 'İzmir', districtName: null } }), SH(2268, 'SHIPPED', 3)],
    [SH(2267, 'GOT_OFFERS', 5, { hasError: true, lastErrorMessage: 'Alıcı ilçesi bulunamadı' }), SH(2200, 'DELIVERED', 24 * 30)]];
  const calls = [];
  const gf = async (url, o) => { calls.push([url, o.headers.Authorization]); const p = Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify({ result: true, totalPages: 2, data: pages[p - 1] || [] }), { status: 200 }); };
  const gl = await K.geliverShipments('tok', 14, gf);
  await t('Geliver: anahtarla sayfa sayfa ceker, eski gonderide durur', () => {
    assert.strictEqual(calls[0][1], 'Bearer tok'); assert.deepStrictEqual(gl.map((s) => s.no), [2270, 2269, 2268, 2267]);
  });
  await t('Geliver: basilacak / teklif bekleyen / bitmis ayrimi', () =>
    assert.deepStrictEqual(gl.map(K.geliverKind), ['ready', 'offer', 'done', 'offer']));
  await t('Geliver: adres hatalari (hata mesaji ve eksik ilce)', () =>
    assert.deepStrictEqual(gl.map(K.geliverAddressError), [null, 'İlçe bilgisi eksik', null, 'Alıcı ilçesi bulunamadı']));
  await t('Geliver: anahtar yanlissa anlasilir hata', async () => {
    await assert.rejects(K.geliverShipments('kotu', 14, async () => new Response('{}', { status: 401 })), /Yetkisiz/);
    await assert.rejects(K.geliverShipments('', 14, gf), /anahtarı girilmemiş/);
  });
  let codCall;
  const cf = async (url, o) => { codCall = [url, o.headers.Authorization];
    return new Response(JSON.stringify(url.includes('/api/kapida') ? { siparisler: [{ id: 'gid://shopify/Order/1', no: '2271', sorun: 'ilçe bulunamadı' }], deneme: false }
      : { html: '<section>x</section>', etiketler: ['2271'], hatalar: [['#2272', 'Telefon yok']] }), { status: 200 }); };
  const co = await K.codOrders({ codUrl: 'https://w.dev/', codKey: 'k' }, 14, cf);
  await t('Kapida odeme: sunucudan liste ve adres sorunu', () => { assert.strictEqual(codCall[0], 'https://w.dev/api/kapida?gun=14'); assert.strictEqual(codCall[1], 'Bearer k'); assert.strictEqual(co.orders[0].sorun, 'ilçe bulunamadı'); });
  const cl = await K.codLabels({ codUrl: 'https://w.dev', codKey: 'k' }, ['gid://shopify/Order/1', 'gid://shopify/Order/2'], cf);
  await t('Kapida odeme: secilen siparislerin etiketi + hatalar', () => { assert.match(codCall[0], /\/api\/etiket\?ids=gid%3A%2F%2Fshopify%2FOrder%2F1%2Cgid/); assert.deepStrictEqual(cl.etiketler, ['2271']); assert.strictEqual(cl.hatalar.length, 1); });
  await t('Kapida odeme: sunucu ayarlanmamissa anlasilir hata', () => assert.rejects(K.codOrders({}, 14, cf), /ayarlanmamış/));

  const dist = async (url, o = {}) => {
    if ((o.method || 'GET') === 'PATCH') { global.PATCHED = JSON.parse(o.body); return new Response(JSON.stringify({ result: true, data: { id: 'sh1', statusCode: 'GOT_OFFERS', order: { orderCode: '#2187' }, recipientAddress: { name: 'M K', cityName: 'İstanbul', districtName: 'Fatih' } } }), { status: 200 }); }
    const cc = new URL(url).searchParams.get('cityCode');
    const list = { '34': ['Adalar', 'Fatih', 'Eyüpsultan', 'Beyoğlu'], '35': ['Urla', 'Konak'], '03': ['Merkez', 'Sandıklı', 'Dinar'] }[cc] || [];
    return new Response(JSON.stringify({ result: true, data: list.map((n, i) => ({ cityCode: cc, districtID: 1000 + i, name: n })) }), { status: 200 });
  };
  const A = (x) => K.toGeliverAddress('tok', x, dist);
  await t('Adres duzeltme: Shopify adresi Geliver bicimine (il kodu + ilce kodu)', async () => {
    const r = await A({ name: 'M K', address1: 'Nişanca mahallesi alişan sokak No5 daire7', city: 'Fatih', province: 'İstanbul', provinceCode: 'TR-34', phone: '+905370630447' });
    assert.strictEqual(r.address.cityCode, '34'); assert.strictEqual(r.address.districtID, 1001); assert.strictEqual(r.address.districtName, 'Fatih');
    const r2 = await A({ address1: 'turkuaz sokak no 9', address2: 'Urla', city: 'İzmir' });
    assert.strictEqual(r2.address.cityCode, '35'); assert.strictEqual(r2.address.districtName, 'Urla');
  });
  await t('Geliver: HepsiJet teklifi secilir, sifir tutar yok sayilir, bakiye okunur', async () => {
    const m = K.mapShipment({ id: 's1', statusCode: 'GOT_OFFERS', totalAmount: '0', desi: '0', order: { orderCode: '#2269' },
      offers: { cheapest: { id: 'o1', providerCode: 'SURAT', totalAmount: '150' }, list: [
        { id: 'o1', providerCode: 'SURAT', totalAmount: '150' }, { id: 'o2', providerCode: 'HEPSIJET', providerServiceCode: 'HEPSIJET_STANDART', totalAmount: '167.19' },
        { id: 'o3', providerCode: 'HEPSIJET', totalAmount: '0' }] } });
    assert.strictEqual(m.hepsijet.id, 'o2'); assert.strictEqual(m.hepsijet.total, 167.19);
    assert.strictEqual(m.price, 167.19); assert.strictEqual(m.desi, null);
    assert.strictEqual(K.mapShipment({ id: 's2', offers: { list: [{ id: 'x', providerCode: 'ARAS', totalAmount: '99' }] } }).hepsijet, null);
    const f = async (u) => ({ ok: true, status: 200, text: async () => JSON.stringify(/organizations$/.test(u) ? { data: [{ id: 'org1' }] } : /org1\/balance/.test(u) ? { result: true, data: { balance: '1795.47', debt: 0 } } : {}) });
    assert.strictEqual(await K.geliverBalance('t', f), 1795.47);
    const fb = async (u) => ({ ok: true, status: 200, text: async () => JSON.stringify(/organizations$/.test(u) ? { data: [{ id: 'org1' }] } : /org1\/balance/.test(u) ? { data: { debitBalance: 0, totalBalance: 1795.47 } } : {}) });
    assert.strictEqual(await K.geliverBalance('t', fb), 1795.47);
    const f2 = async (u) => ({ ok: true, status: 200, text: async () => JSON.stringify(/user\/balance/.test(u) ? { result: true, data: { balance: '512.30' } } : {}) });
    assert.strictEqual(await K.geliverBalance('t', f2), 512.3);
    const f3 = async (u) => ({ ok: !/balance/.test(u), status: /balance/.test(u) ? 404 : 200, text: async () => JSON.stringify(/balance/.test(u) ? {} : { data: [{ id: 'o', creditBalance: 900, debitBalance: 100 }] }) });
    assert.strictEqual(await K.geliverBalance('t', f3), 800);
  });
  await t('Geliver adres: dogrudan yazma reddedilirse yeni adres olusturup baglar', async () => {
    const calls = [];
    const f = async (u, o) => { calls.push(o.method + ' ' + u.replace(/^.*v1/, '') + ' ' + o.body);
      if (o.method === 'PATCH' && /recipientAddress"/.test(o.body)) return { ok: false, status: 400, text: async () => JSON.stringify({ result: false, message: 'Recipient address' }) };
      if (o.method === 'POST') return { ok: true, status: 201, text: async () => JSON.stringify({ result: true, data: { id: 'adr9' } }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ result: true, data: { id: 'sh1', statusCode: 'GOT_OFFERS' } }) }; };
    const u = await K.updateGeliverAddress('tok', 'sh1', { name: 'Ali', cityCode: '34' }, f);
    assert.strictEqual(u.id, 'sh1'); assert.strictEqual(calls.length, 3); assert.match(calls[2], /recipientAddressID":"adr9/);
    const bad = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ result: false, message: 'Recipient address', additionalMessage: 'districtID invalid' }) });
    await assert.rejects(K.updateGeliverAddress('tok', 'sh1', { name: 'Ali' }, bad), /Recipient address — districtID invalid/);
  });
  await t('Ortak durum: iki bilgisayar basildi/fis/indirme bilgisini paylasir, en son degisiklik kazanir', async () => {
    const Sh = require('../src/main/shared');
    const rootA = path.join('X:', 'BASKI'), rootB = path.join('/mnt', 'paylasim', 'BASKI');
    const pA = path.join(rootA, '15-11-26-SIPARISLER', '_Sayfalar', 'Sayfa-01.psd');
    let S = {};
    let r = Sh.merge(S, { downloaded: ['o1'], printed: { [pA]: 1000 }, labels: { 'cod:1': 1000 }, arranged: { a: 1 }, arrangedAt: 1000 }, { root: rootA, station: 'A', now: 2000 });
    S = r.S;
    assert.strictEqual(S.printed['15-11-26-SIPARISLER/_Sayfalar/Sayfa-01.psd'].by, 'A');
    // B baska yoldan ayni klasoru goruyor
    r = Sh.merge(S, { downloaded: ['o2'], printed: {}, labels: {}, arranged: {}, arrangedAt: 0 }, { root: rootB, station: 'B', now: 3000 });
    const pB = path.join(rootB, '15-11-26-SIPARISLER', '_Sayfalar', 'Sayfa-01.psd');
    assert.strictEqual(r.L.printed[pB], 1000); assert.strictEqual(r.L.printedBy[pB], 'A');
    assert.deepStrictEqual(r.L.downloaded.sort(), ['o1', 'o2']); assert.strictEqual(r.L.labels['cod:1'], 1000);
    assert.deepStrictEqual(r.L.arranged, { a: 1 });
    S = r.S;
    // B "basilmadi" isaretler (daha yeni) -> A'da da kalkar
    r = Sh.merge(S, { printed: {}, printedOff: { [pB]: 4000 } }, { root: rootB, station: 'B', now: 4000 }); S = r.S;
    r = Sh.merge(S, { printed: { [pA]: 1000 } }, { root: rootA, station: 'A', now: 5000 });
    assert.strictEqual(r.L.printed[pA], undefined); assert.ok(Object.keys(r.S.stations).includes('B'));
  });
  await t('Ortak durum: sayfa hazirlama kilidi ayni anda tek bilgisayara verilir', async () => {
    const Sh = require('../src/main/shared');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-kilit-'));
    assert.ok(Sh.lock(dir, 'x', 'A').ok);
    const b = Sh.lock(dir, 'x', 'B'); assert.strictEqual(b.ok, false); assert.strictEqual(b.by, 'A');
    Sh.unlock(dir, 'x', 'A'); assert.ok(Sh.lock(dir, 'x', 'B').ok);
    Sh.write(dir, { v: 1 }); assert.strictEqual(Sh.read(dir).v, 1);
  });
  await t('Adres duzeltme (#2187): il yanlis secilmis (Afyon), adreste Fatih Istanbul yaziyor', async () => {
    const r = await A({ name: 'Mustafa Kapçak', address1: 'Alişan Sokak Nişanca Mahallesi Fatih İstanbul', address2: 'No5 daire7', city: 'İstanbul', zip: '034', province: 'Afyonkarahisar', provinceCode: 'TR-03' });
    assert.strictEqual(r.address.cityCode, '34'); assert.strictEqual(r.address.districtName, 'Fatih');
    assert.strictEqual(r.address.zip, ''); assert.match(r.note, /Afyonkarahisar/);
  });
  await t('Adres duzeltme: sadece il yazilmissa Merkez ilcesi', async () => {
    const r = await A({ address1: 'Cumhuriyet mah 5', city: 'Afyon', provinceCode: 'TR-03' });
    assert.strictEqual(r.address.cityCode, '03'); assert.strictEqual(r.address.districtName, 'Merkez');
  });
  await t('Adres duzeltme: il/ilce bulunamazsa anlasilir hata', async () => {
    assert.match((await A({ address1: 'x', city: 'Şehir' })).error, /il bulunamadı/);
    assert.match((await A({ address1: 'Nişanca mah', city: 'İstanbul', provinceCode: 'TR-34' })).error, /ilçe bulunamadı/);
  });
  await t('Adres duzeltme: Geliver adresi Shopify ile karsilastirilir', () => {
    const geliver = { address: 'Nişanca mahallesi alişan sokak No5 daire7', city: 'Şehir', district: 'İLÇE_BULUNAMADI' };
    assert.ok(K.addressChanged(geliver, { address1: 'Nişanca mahallesi alişan sokak No5 daire7', city: 'Fatih', provinceCode: 'TR-34' }));
    assert.ok(!K.addressChanged({ address: 'A sok 1', city: 'İstanbul', district: 'Fatih' }, { address1: 'A sok 1', city: 'Fatih', provinceCode: 'TR-34' }));
  });
  await t('Adres duzeltme: Geliver gonderisine PATCH ile yazilir', async () => {
    const r = await A({ name: 'M K', address1: 'Nişanca mah.', city: 'Fatih', provinceCode: 'TR-34', phone: '+90537' });
    const u = await K.updateGeliverAddress('tok', 'sh1', r.address, dist);
    assert.strictEqual(global.PATCHED.recipientAddress.districtID, 1001); assert.strictEqual(u.district, 'Fatih');
  });

  console.log('Klasorler');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  await t('Mesai sonrasi ertesi gun', () => {
    assert.strictEqual(F.dayFolderName(new Date(2026, 10, 14, 17, 59), '18:00'), '14-11-26-SIPARISLER');
    assert.strictEqual(F.dayFolderName(new Date(2026, 10, 14, 18, 1), '18:00'), '15-11-26-SIPARISLER');
    assert.strictEqual(F.orderDayFolderName(new Date(2026, 10, 15, 23, 50)), '15-11-26-SIPARISLER');
    assert.strictEqual(F.orderDayFolderName(new Date(2026, 10, 15, 0, 5)), '15-11-26-SIPARISLER');
  });
  const d1 = path.join(root, '13-11-26-SIPARISLER'), d2 = path.join(root, '14-11-26-SIPARISLER');
  fs.mkdirSync(d1); fs.mkdirSync(d2);
  fs.writeFileSync(path.join(d2, '2270-21x30-Beyaz.png'), 'x');
  fs.writeFileSync(path.join(d1, '2266-30x42-Siyah-2Adet.png'), 'x');
  fs.writeFileSync(path.join(d1, 'rastgele.png'), 'x');
  await t('Bekleyenler eskiden yeniye + adet', () => {
    const p = F.pendingItems(root, ['30x42']);
    assert.deepStrictEqual(p.items.map((i) => i.order), [2266, 2266, 2270]);
    assert.deepStrictEqual(p.bad, ['rastgele.png']);
    assert.ok(p.items[0].lockPortrait && !p.items[2].lockPortrait);
  });
  await t('Dizilmis kopyalar tekrar gelmez', () => {
    const p = F.pendingItems(root, [], { '2266-30x42-Siyah-2Adet.png': 1 });
    assert.deepStrictEqual(p.items.map((i) => `${i.order}/${i.copy}`), ['2266/2', '2270/1']);
  });
  await t('Dizildi klasorune tasima', () => {
    F.moveToArranged(path.join(d2, '2270-21x30-Beyaz.png'));
    assert.ok(fs.existsSync(path.join(d2, '_Dizildi', '2270-21x30-Beyaz.png')));
    const o = F.listOrders(root); assert.strictEqual(o[0].files[0].status, 'arranged');
  });

  console.log('Shopify indirme (sahte sunucu)');
  const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
  const old = new Date(Date.now() - 3600e3).toISOString();
  const fresh = new Date().toISOString();
  const orders = [
    { id: 'gid://1', name: '#2266', createdAt: old, cancelledAt: null, displayFinancialStatus: 'PENDING', paymentGatewayNames: ['Cash on Delivery (COD)'], shippingLine: { title: 'DHL eCommerce' }, shippingAddress: { name: 'Ali Veli', city: 'İstanbul' }, totalPriceSet: { shopMoney: { amount: '749.90', currencyCode: 'TRY' } }, lineItems: { nodes: [
      { id: 'l1', title: 'Forma Tablo', quantity: 1, variantTitle: 'Çerçeveli Poster / Siyah / 30x42 cm',
        customAttributes: [{ key: '_customization_id', value: 'a' }, { key: '_tib_design_link_1', value: 'URL/a.png' }] }] } },
    { id: 'gid://2', name: '#2267', createdAt: old, cancelledAt: null, lineItems: { nodes: [
      { id: 'l2', title: 'A', quantity: 2, variantTitle: 'Çerçeveli Poster / Beyaz / 21x30 cm', customAttributes: [{ key: '_tib_design_link_1', value: 'URL/b.png' }] },
      { id: 'l3', title: 'B', quantity: 1, variantTitle: 'Çerçevesiz Poster / 15x21 cm', customAttributes: [{ key: '_tib_design_link_1', value: 'URL/c.png' }] }] } },
    { id: 'gid://3', name: '#2268', createdAt: old, cancelledAt: null, lineItems: { nodes: [
      { id: 'l4', title: 'C', quantity: 1, variantTitle: 'Çerçeveli Poster / Siyah / 50x70 cm', customAttributes: [{ key: '_customization_id', value: 'x' }] }] } },
    { id: 'gid://4', name: '#2269', createdAt: fresh, cancelledAt: null, lineItems: { nodes: [] } },
    { id: 'gid://5', name: '#2265', createdAt: old, cancelledAt: null, lineItems: { nodes: [] } },
    { id: 'gid://6', name: '#2270', createdAt: old, cancelledAt: old, lineItems: { nodes: [] } },
  ];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      if (req.url === '/admin/oauth/access_token') { res.end(JSON.stringify({ access_token: 'tok' })); return; }
      if (req.url.endsWith('/graphql.json')) {
        assert.strictEqual(req.headers['x-shopify-access-token'], 'tok');
        if (global.DENY_PII && body.includes('shippingAddress')) { res.end(JSON.stringify({ errors: [{ message: 'This app is not approved to access the Customer object.', extensions: { code: 'ACCESS_DENIED' } }] })); return; }
        const host = `http://127.0.0.1:${srv.address().port}`;
        const data = JSON.parse(JSON.stringify(orders).replace(/URL/g, host + '/f'));
        if (!body.includes('shippingAddress')) data.forEach((o) => delete o.shippingAddress);
        res.end(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: data } } })); return;
      }
      if (req.url.startsWith('/f/')) { res.setHeader('content-type', 'image/png'); res.end(PNG); return; }
      res.statusCode = 404; res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dl = path.join(root, 'dl');
  const done = new Set();
  const conf = { _baseUrl: `http://127.0.0.1:${srv.address().port}`, shop: 'x', clientId: 'a', clientSecret: 'b', apiVersion: '2026-10',
    downloadDir: dl, firstOrderNo: 2266, lookbackDays: 10, renderWaitMin: 5, missingWarnMin: 120, dayEnd: '23:59', colorWords: ['Siyah', 'Beyaz'] };
  const r = await runDownload(conf, done, () => {});
  await t('Dosyalar dogru adlarla indi', () => assert.deepStrictEqual(r.files.sort(),
    ['2266-30x42-Siyah.png', '2267-15x21-Cercevesiz-Urun-2.png', '2267-21x30-Beyaz-Urun-1-2Adet.png'].sort()));
  await t('Link yok / yeni / iptal / eski numara atlandi', () => {
    assert.ok(r.pending.some((p) => p.includes('#2268'))); assert.ok(r.pending.some((p) => p.includes('#2269')));
    assert.ok(!done.has('gid://6') && !done.has('gid://5') && !done.has('gid://3'));
  });
  const r2 = await runDownload(conf, done, () => {});
  await t('Ikinci calismada tekrar indirmez', () => assert.strictEqual(r2.files.length, 0));
  const det = await fetchOrderDetails(conf, 14);
  await t('Siparisler sayfasi: musteri, kapida odeme, kargo, tutar', () => {
    const o = det.orders.find((x) => x.no === 2266);
    assert.ok(det.pii); assert.strictEqual(o.name, 'Ali Veli'); assert.strictEqual(o.city, 'İstanbul');
    assert.strictEqual(o.financial, 'PENDING'); assert.deepStrictEqual(o.gateways, ['Cash on Delivery (COD)']);
    assert.strictEqual(o.shipping, 'DHL eCommerce'); assert.strictEqual(o.total, 749.9);
  });
  global.DENY_PII = true;
  const det2 = await fetchOrderDetails(conf, 14);
  global.DENY_PII = false;
  await t('Musteri verisi izni yoksa adsiz ama calisir', () => { assert.strictEqual(det2.pii, false); assert.strictEqual(det2.orders.find((x) => x.no === 2266).name, ''); });
  const r0 = await runDownload({ ...conf, ignoreBefore: Date.now() + 1000 }, new Set(), () => {});
  await t('Resetten sonra eski siparisler otomatik inmez', () => assert.strictEqual(r0.files.length, 0));
  const r3 = await runDownload({ ...conf, redownloadFrom: 2267 }, done, () => {});
  await t('Yeniden indir: dosya zaten varsa kopya olusturmaz', () => { assert.strictEqual(r3.files.length, 0); assert.strictEqual(r3.skipped, 2); });
  for (const f of fs.readdirSync(r.folder)) if (f.startsWith('2267')) fs.rmSync(path.join(r.folder, f));
  const r4 = await runDownload({ ...conf, redownloadFrom: 2267 }, done, () => {});
  await t('Yeniden indir: #2267 ve sonrasi tekrar iner, oncekiler inmez (yeni bilgisayar)', () =>
    assert.deepStrictEqual(r4.files.sort(), ['2267-15x21-Cercevesiz-Urun-2.png', '2267-21x30-Beyaz-Urun-1-2Adet.png']));
  await t('musteri notu: not + sepet ozellikleri, sistem alanlari haric', () => {
    const { orderNote } = require('../src/main/downloader');
    assert.strictEqual(orderNote({ note: ' Hediye paketi olsun ', customAttributes: [{ key: '_teeinblue', value: 'x' }, { key: 'Hediye notu', value: 'İyi ki doğdun' }, { key: 'utm_source', value: 'ig' }, { key: 'Bos', value: ' ' }] }), 'Hediye paketi olsun');
    assert.strictEqual(orderNote({ note: null, customAttributes: [] }), '');
    assert.strictEqual(orderNote({ note: 'https://app.teeinblue.com/preview/abc\nhttps://cdn.shopify.com/x.png', customAttributes: [{ key: 'Personalization', value: 'https://teeinblue.com/p/1' }, { key: 'Design link', value: 'abc' }] }), '');
  });
  await t('duzenlenen siparis: kaldirilan urun basilmaz, tasarim yeni olcuye tasinir', () => {
    const { printItems } = require('../src/main/downloader');
    const L = (k) => [{ key: '_customization_id', value: 'c' }, { key: '_tib_design_link_1', value: 'https://x/' + k + '.png' }];
    const r = printItems([
      { title: 'Forma', variantTitle: 'Çerçeveli Poster / Siyah / 30x42 cm', quantity: 1, currentQuantity: 0, customAttributes: L('a') },
      { title: 'Forma', variantTitle: 'Çerçeveli Poster / Siyah / 50x70 cm', quantity: 1, currentQuantity: 1, customAttributes: [] },
      { title: 'Baska', variantTitle: 'Çerçeveli Poster / Beyaz / 30x42 cm', quantity: 2, currentQuantity: 1, customAttributes: L('b') },
      { title: 'Kaldirildi', variantTitle: 'Çerçeveli Poster / Beyaz / 30x42 cm', quantity: 1, currentQuantity: 0, customAttributes: L('c') },
    ], ['Siyah', 'Beyaz']);
    assert.strictEqual(r.items.length, 2);
    assert.strictEqual(r.items[0].url, 'https://x/a.png'); assert.strictEqual(r.items[0].size, '50x70'); assert.strictEqual(r.items[0].moved, true);
    assert.strictEqual(r.items[1].qty, 1);
    assert.strictEqual(r.missing, false);
  });
  srv.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${pass} test gecti.`);
})().catch((e) => { console.error('\nTEST HATASI:', e); process.exit(1); });
