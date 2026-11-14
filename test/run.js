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

  console.log('Klasorler');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  await t('Mesai sonrasi ertesi gun', () => {
    assert.strictEqual(F.dayFolderName(new Date(2026, 10, 14, 17, 59), '18:00'), '14-11-26-SIPARISLER');
    assert.strictEqual(F.dayFolderName(new Date(2026, 10, 14, 18, 1), '18:00'), '15-11-26-SIPARISLER');
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
  srv.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${pass} test gecti.`);
})().catch((e) => { console.error('\nTEST HATASI:', e); process.exit(1); });
