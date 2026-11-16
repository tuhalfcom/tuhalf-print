'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—');
let CFG = null, STATUS = {}, SHEETS = [], PLAN = null, ORDR = null, PSFOUND = null;

const ICON_EMPTY = '<svg viewBox="0 0 24 24"><path d="M3 7h18M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>';

function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' error' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ---------- Uygulama ici onay penceresi ----------
const ASK_ICON = {
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>',
  question: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
  warning: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
};
const ASKQ = [];
function showAsk(a) {
  if (!$('#askBg').classList.contains('hidden')) { ASKQ.push(a); return; }
  $('#askBox').className = 'ask ' + (a.danger ? 'danger' : a.type);
  $('#askIco').innerHTML = ASK_ICON[a.type] || ASK_ICON.info;
  $('#askTitle').textContent = a.title; $('#askMsg').textContent = a.message;
  $('#askDetail').textContent = a.detail; $('#askDetail').classList.toggle('hidden', !a.detail);
  const order = a.buttons.map((t, i) => i);
  $('#askBtns').innerHTML = order.map((i) => `<button class="btn ${i === a.cancelId ? 'ghost' : a.danger ? 'danger' : 'primary'}" data-ask="${i}">${esc(a.buttons[i])}</button>`).join('');
  $('#askBg').classList.remove('hidden');
  const reply = (i) => {
    $('#askBg').classList.add('hidden'); document.removeEventListener('keydown', key, true);
    window.api.askReply(a.id, i);
    if (ASKQ.length) setTimeout(() => showAsk(ASKQ.shift()), 120);
  };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); reply(a.cancelId); } else if (e.key === 'Enter' && !a.danger) { e.preventDefault(); reply(a.defaultId); } };
  document.addEventListener('keydown', key, true);
  $('#askBtns').onclick = (e) => { const b = e.target.closest('[data-ask]'); if (b) reply(Number(b.dataset.ask)); };
  $('#askBg').onclick = (e) => { if (e.target.id === 'askBg') reply(a.cancelId); };
  setTimeout(() => { const d = $(`#askBtns [data-ask="${a.danger ? a.cancelId : a.defaultId}"]`); if (d) d.focus(); }, 30);
}
window.api.on('ask', showAsk);

function dayLabel(name) {
  const m = name.match(/^(\d\d)-(\d\d)-(\d\d)/); if (!m) return name;
  const d = new Date(2000 + +m[3], +m[2] - 1, +m[1]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 864e5);
  const base = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  return diff === 0 ? `Bugün · ${base}` : diff === 1 ? `Yarın · ${base}` : diff === -1 ? `Dün · ${base}` : base;
}

// ---------- Durum ----------
function renderStatus() {
  const el = $('#topStatus');
  el.className = 'top-status' + (STATUS.running ? ' busy' : STATUS.lastError ? ' error' : '');
  $('#statusText').textContent = STATUS.running ? 'Siparişler kontrol ediliyor…'
    : STATUS.lastError ? 'Hata: ' + STATUS.lastError
    : `Son kontrol ${fmtTime(STATUS.lastCheck)} · Sonraki ${fmtTime(STATUS.nextCheck)}`;
  $('#btnCheck').disabled = false;
  $('#btnCheck').classList.toggle('busy', !!STATUS.running);

  const job = STATUS.job;
  $('#jobOverlay').classList.toggle('hidden', !job);
  if (job) {
    $('#jobTitle').textContent = job.kind === 'print' ? 'Yazdırılıyor' : 'Sayfalar hazırlanıyor';
    $('#jobLabel').textContent = job.label || '';
    $('#jobBar').style.width = (job.total ? Math.round((job.done / job.total) * 100) : 5) + '%';
  }
}

// ---------- Siparisler ----------
function orderRow(f) {
  const i = f.info || {};
  const img = f.thumb ? `style="background-image:url('${window.api.fileUrl(f.thumb)}')"` : '';
  const where = f.sheets && f.sheets.length ? f.sheets.map((x) => x.name).join(', ')
    : f.hold ? f.hold : f.partial ? f.partial : f.waiting ? 'Bekliyor · sonraki dizilimde' : f.status === 'pending' ? 'Sırada' : 'Dizildi';
  const chip = f.printed
    ? `<span class="chip printed">Basıldı${f.printedAt ? ' ' + fmtTime(f.printedAt) : ''}</span>`
    : f.hold ? `<span class="chip hold" title="${esc(f.hold)}">${/iptal|iade/i.test(f.hold) ? 'Basılmayacak' : 'Ödeme bekleniyor'}</span>`
    : '<span class="chip unprinted">Basılmadı</span>';
  return `<div class="order ${f.status}${f.printed ? ' is-printed' : ''}" data-path="${esc(f.path)}" title="Klasörde göster">
    <div class="thumb" ${img}></div>
    <div>
      <div class="order-file">${f.isNew ? '<span class="new-dot" title="Yeni"></span>' : ''}${esc(f.name)}</div>
      <div class="order-meta">${i.size ? `<span class="tag">${esc(i.size)}</span>` : ''}${i.color ? `<span class="tag">${esc(i.color)}</span>` : ''}${i.qty > 1 ? `<span class="tag">${i.qty} adet</span>` : ''}</div>
    </div>
    <div class="order-right">${chip}<span class="muted small">${esc(where)}</span></div>
  </div>`;
}

async function loadOrders() {
  const r = await window.api.orders();
  ORDR = r;
  if (!r.exists) {
    $('#orders').innerHTML = `<div class="empty">${ICON_EMPTY}<div>İndirme klasörü bulunamadı</div><code>${esc(r.root || '—')}</code><div class="small" style="margin-top:10px">Ayarlar &gt; Klasörler bölümünden doğru klasörü seçin.</div></div>`;
    $('#ordersSummary').textContent = 'Klasör bulunamadı';
    return;
  }
  let unprinted = 0, total = 0;
  const html = r.groups.map((g) => {
    unprinted += g.files.filter((f) => !f.printed).length; total += g.files.length;
    const rows = g.files.map(orderRow).join('');
    return `<div class="day"><div class="day-head"><b>${esc(dayLabel(g.name))}</b><button data-open="${esc(g.path)}">Klasörü aç ↗</button></div>${rows || '<p class="muted small">Dosya yok</p>'}</div>`;
  }).join('');
  $('#orders').innerHTML = html || `<div class="empty">${ICON_EMPTY}<div>Henüz indirilen sipariş yok</div><code>${esc(r.root)}</code></div>`;
  $('#ordersSummary').textContent = total ? `${total} dosya · ${unprinted} basılmadı` + (r.newCount ? ` · ${r.newCount} yeni` : '') + ' · son 7 gün' : 'Yeni siparişler otomatik iner';
  setNewDots(r.newCount || 0);
}

// ---------- Yerlesim ----------
function paperHtml(sheet, items) {
  const w = sheet.widthMm, h = sheet.lengthMm;
  const slots = items.map((i) => {
    const bg = i.thumb ? `background-image:url('${window.api.fileUrl(i.thumb)}');` : '';
    const box = `left:${(i.xMm / w) * 100}%;top:${(i.yMm / h) * 100}%;width:${(i.wMm / w) * 100}%;height:${(i.hMm / h) * 100}%;`;
    // 90 derece cevrik baskida gorseli de cevir
    const inner = i.rotated
      ? `<div class="img" style="${bg}width:${(i.hMm / i.wMm) * 100}%;height:${(i.wMm / i.hMm) * 100}%;transform:translate(-50%,-50%) rotate(90deg)"></div>`
      : `<div class="img" style="${bg}width:100%;height:100%;left:0;top:0"></div>`;
    return `<div class="slot${i.card ? ' card' : ''}" style="${box}" title="${esc(i.name)}">${inner}<span>${i.card ? 'Kart' : '#' + esc(i.order)}</span></div>`;
  }).join('');
  return `<div class="paper" style="aspect-ratio:${w}/${h}">${slots}</div>`;
}

let FORCE = false;
async function loadPlan() {
  const p = await window.api.plan(FORCE);
  PLAN = p;
  for (const el of document.querySelectorAll('[data-count="plan"]')) { el.textContent = p.sheets.length; el.classList.toggle('hidden', !p.sheets.length); }
  const heldTxt = p.held && p.held.length ? ` · ${p.held.length} ödeme bekliyor` : '';
  $('#planSummary').textContent = p.count
    ? `${p.placed} baskı → ${p.sheets.length} sayfa` + (p.waiting.length ? ` · ${p.waiting.length} bekliyor` : '') + heldTxt
    : 'Dizilecek dosya yok' + heldTxt;
  $('#heldBox').classList.toggle('hidden', !(p.held && p.held.length));
  $('#heldTitle').textContent = `Ödeme bekleniyor (${(p.held || []).length})`;
  $('#heldList').innerHTML = (p.held || []).map((h) => `<span class="tag hold" title="${esc(h.reason)}">${esc(h.name)} · ${esc(h.reason)}</span>`).join('');
  $('#btnBuild').disabled = !p.sheets.length || !!STATUS.job;
  $('#btnBuild').lastChild.textContent = p.sheets.length ? `Sayfaları hazırla (${p.sheets.length})` : 'Sayfaları hazırla';
  const fmt = (n) => String(n).replace('.', ',');
  $('#rollInfo').textContent = CFG ? `${fmt(CFG.print.rollWidthMm)} × ${fmt(CFG.print.maxLengthMm)} mm · ara ${fmt(Math.max(1, CFG.print.gapMm))} mm` : '';
  const wb = $('#waitingBox');
  const showWait = p.waiting.length || FORCE;
  wb.classList.toggle('hidden', !showWait);
  $('#forceAll').checked = FORCE;
  $('#waitingTitle').textContent = FORCE ? 'Bekleyenler de diziliyor' : `Bekleyen (${p.waiting.length})`;
  $('#waitingList').innerHTML = p.waiting.map((n) => `<span class="tag">${esc(n)}</span>`).join('') || (FORCE ? '<span class="muted small">Tüm tasarımlar sayfalara yerleşti.</span>' : '');
  let html = p.sheets.map((s, n) => {
    const designs = s.items.filter((i) => !i.card).length;
    return `<div class="artboard">
      <div class="artboard-title"><b>Sayfa ${n + 1}</b><span>${designs} baskı${s.cards ? ` · ${s.cards} kart` : ''}</span></div>
      ${paperHtml(s, s.items)}
    </div>`;
  }).join('');
  if (p.skipped.length) html += `<div class="artboard"><div class="waiting"><b>Ruloya sığmayan</b><div class="muted small">${p.skipped.map(esc).join('<br>')}</div></div></div>`;
  if (p.bad.length) html += `<div class="artboard"><div class="waiting"><b>Adı okunamayan</b><div class="muted small">${p.bad.map(esc).join('<br>')}</div></div></div>`;
  $('#plan').innerHTML = html || `<p class="muted small">${p.waiting.length ? 'Tam satır oluşturacak kadar tasarım yok. Yeni siparişler geldikçe dizilir.' : 'Yeni dosyalar indikçe yerleşim burada oluşur.'}</p>`;
}

// ---------- Hazir sayfalar ----------
async function loadSheets() {
  SHEETS = await window.api.sheets();
  const unprinted = SHEETS.filter((s) => !s.printedAt);
  $('#btnPrintAll').disabled = !unprinted.length || !!STATUS.job;
  $('#btnPrintAll').lastChild.textContent = unprinted.length ? `Basılmamışları bas (${unprinted.length})` : 'Basılmamışları bas';
  $('#sheetsCount').textContent = unprinted.length;
  $('#sheetsCount').classList.toggle('hidden', !unprinted.length);
  $('#sheets').innerHTML = SHEETS.map((s) => {
    const m = s.meta;
    const preview = m ? paperHtml(m, m.items) : '<div class="paper" style="aspect-ratio:610/420"></div>';
    const chip = s.printedAt ? `<span class="chip printed">Basıldı ${fmtTime(s.printedAt)}</span>` : '<span class="chip ready">Baskıya hazır</span>';
    return `<div class="sheet-card">
      ${preview}
      <div class="sheet-info"><b>${esc(s.name)}</b>${chip}</div>
      <div class="muted small">${esc(dayLabel(s.folder))}${m ? ` · ${m.items.filter((i) => !i.card).length} baskı` : ''}${m && m.items.some((i) => i.card) ? ` · ${m.items.filter((i) => i.card).length} kart` : ''}</div>
      <div class="sheet-actions">
        <button class="btn print small${s.printedAt ? ' done' : ''}" data-print="${esc(s.path)}"><svg viewBox="0 0 24 24"><path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/></svg>${s.printedAt ? 'Tekrar bas' : 'Print'}</button>
        <button class="btn small ps" data-ps="${esc(s.path)}" title="PSD dosyasını Photoshop'ta aç">Photoshop'ta aç</button>
        <button class="btn ghost small" data-show="${esc(s.path)}" title="Klasörde göster">Klasörde göster</button>
        <button class="btn ghost small${s.printedAt ? ' done' : ''}" data-mark="${esc(s.path)}" data-on="${s.printedAt ? '' : '1'}" title="${s.printedAt ? 'Basılmadı olarak işaretle' : 'Photoshop\'tan elle bastıysanız işaretleyin'}">${s.printedAt ? '✓ Basıldı' : 'Basıldı işaretle'}</button>
      </div>
    </div>`;
  }).join('') || `<div class="empty">${ICON_EMPTY}<div>Hazır sayfa yok</div></div>`;
}

const refreshAll = () => Promise.all([loadOrders(), loadPlan(), loadSheets(), VIEW === 'orders' ? loadOrdersPage(false, true) : null]).then(() => renderHome()).catch((e) => toast(e.message, true));

// ---------- Etkinlik ----------
function addLog(e) {
  const row = document.createElement('div');
  row.className = 'log ' + e.level;
  row.innerHTML = `<time>${new Date(e.t).toLocaleTimeString('tr-TR')}</time><span>${esc(e.msg)}</span>`;
  const list = $('#logList'); list.prepend(row);
  while (list.children.length > 300) list.lastChild.remove();
  $('#lastLog').textContent = e.msg;
}

// ---------- Ayarlar ----------
function fillSettings(c) {
  for (const el of $('#settingsForm').elements) {
    if (!el.name) continue;
    const v = el.name.split('.').reduce((o, k) => (o ? o[k] : undefined), c);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = Array.isArray(v) ? v.join(', ') : (v ?? '');
  }
}
function readSettings() {
  const out = { print: {}, card: {}, kargo: {} };
  for (const el of $('#settingsForm').elements) {
    if (!el.name) continue;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
    if (el.name === 'print.portraitLocked') v = v.split(',').map((x) => x.trim()).filter(Boolean);
    const [a, b] = el.name.split('.');
    if (b) out[a][b] = v; else out[a] = v;
  }
  return out;
}
async function renderCard() {
  const c = (CFG && CFG.card) || {};
  const th = await window.api.cardThumb();
  $('#cardThumb').style.backgroundImage = th ? `url('${window.api.fileUrl(th)}')` : '';
  $('#cardName').textContent = c.file ? c.file.split(/[\\/]/).pop() : 'Kart yüklenmedi';
  const p = CFG.print, uw = p.rollWidthMm - 2 * p.marginMm, ul = p.maxLengthMm - 2 * p.marginMm;
  const side = (uw - 500 - p.gapMm).toFixed(1), tall = ul.toFixed(1);
  $('#cardHint').textContent = `50x70 yanındaki boşluk: ${side} x ${tall} mm. Kart en fazla ${side} mm genişlikte olursa oraya da sığar.`;
}
$('#btnPickCard').onclick = async () => {
  const r = await window.api.pickCard();
  if (!r) return;
  CFG = r.config; fillSettings(CFG); renderCard();
  toast(r.card.wMm ? `Kart yüklendi · ${r.card.wMm} x ${r.card.hMm} mm` : 'Kart yüklendi · ölçüsünü mm olarak girin');
};
function setPsFound(p) { PSFOUND = p || null; $('#psFound').textContent = p ? `Bulundu: ${p}` : 'Photoshop bulunamadı — konumunu seçin.'; }
function openDrawer(open) { $('#drawer').classList.toggle('open', open); $('#drawerBg').classList.toggle('hidden', !open); }

// ---------- Olaylar ----------
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-open],[data-print],[data-show],[data-pick],[data-mark],[data-ps],[data-view],[data-goto],[data-scroll],[data-url],[data-kprint],[data-kunmark],[data-import],[data-prefs],[data-gsync],[data-gbuy],[data-glogin],.order,.ord-file');
  if (!t) return;
  if (t.dataset.import) return doImport();
  if (t.dataset.gsync) {
    t.disabled = true; t.textContent = 'Aktarılıyor…';
    const r = await window.api.geliverSync(t.dataset.gsync);
    if (r.canceled || r.error) { if (r.error) toast(r.error, true); t.disabled = false; t.textContent = "Geliver'e aktar"; return; }
    toast(`Adres Geliver'e aktarıldı: ${r.address.districtName} / ${r.address.cityName}`);
    return loadKargo(true);
  }
  if (t.dataset.prefs) { openDrawer(true); setTimeout(() => gotoPref('set-' + t.dataset.prefs), 150); return; }
  if (t.dataset.url) return window.api.openUrl(t.dataset.url);
  if (t.dataset.kprint) return printKargo([t.dataset.kprint]);
  if (t.dataset.glogin) { ev.stopPropagation(); toast('Geliver penceresinde giriş yapın; bakiye görünce pencere kendiliğinden kapanır.'); await window.api.geliverLogin(); return; }
  if (t.dataset.gbuy) {
    const id = t.dataset.gbuy, label = t.textContent;
    t.disabled = true; t.textContent = 'Satın alınıyor…';
    const r = await window.api.geliverBuy(id);
    if (r.canceled || r.error) { if (r.error) toast(r.error, true); t.disabled = false; t.textContent = label; return; }
    toast(`HepsiJet etiketi satın alındı (${money(r.total)}). Fiş hazırlanıyor…`);
    for (let i = 0; i < 4; i++) {   // etiketin olusmasi birkac saniye surebilir
      await new Promise((ok) => setTimeout(ok, 2500));
      const k2 = await window.api.kargo(true);
      if (!k2.error) { KG = k2; renderKargo(); }
      const row = KG && (KG.geliver || []).find((x) => x.id === id);
      if (row && row.pdfUrl) { const o = await window.api.labelsOpen('geliver', [id]); if (o && o.error) toast(o.error, true); return; }
    }
    toast('Etiket birazdan hazır olur; “Yazdırılacaklar”dan yazdırın.');
    return;
  }
  if (t.id === 'btnKargoTest' || t.closest('#btnKargoTest')) { const r = await window.api.labelsOpen('test'); if (r && r.error) toast(r.error, true); return; }
  if (t.dataset.kunmark) { await window.api.labelMark([t.dataset.kunmark], false); return loadKargo(false); }
  if (t.dataset.view) return setView(t.dataset.view);
  if (t.dataset.goto) return gotoPref(t.dataset.goto);
  if (t.dataset.scroll) { $('#orders').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (t.dataset.ps) { const r = await window.api.openInPhotoshop(t.dataset.ps); if (r && r.error) toast(r.error, true); else toast('Photoshop\'ta açılıyor…'); return; }
  if (t.dataset.mark) { await window.api.markPrinted(t.dataset.mark, !!t.dataset.on); return refreshAll(); }
  if (t.dataset.open) return window.api.openPath(t.dataset.open);
  if (t.dataset.show) return window.api.showItem(t.dataset.show);
  if (t.dataset.pick) {
    const p = await window.api.pick(t.dataset.pick);
    if (p) $(`[name="${t.dataset.target}"]`).value = p;
    return;
  }
  if (t.dataset.print) return doPrint([t.dataset.print]);
  if (t.classList.contains('order') || t.classList.contains('ord-file')) return window.api.showItem(t.dataset.path);
});

async function doPrint(paths) {
  const r = await window.api.print(paths);
  if (r.error) return toast(r.error, true);
  const ok = r.files.filter((f) => f.ok).length;
  toast(ok === paths.length ? `${ok} sayfa yazıcıya gönderildi` : `${ok}/${paths.length} sayfa gönderildi, hatalar etkinlikte`, ok !== paths.length);
}

$('#btnCheck').onclick = async () => {
  toast('Shopify kontrol ediliyor…');
  const r = await window.api.checkNow();
  if (!r) return;
  if (r.busy) toast('Kontrol zaten sürüyor, birazdan biter.');
  else if (r.error) toast(r.error, true);
  else toast(r.files && r.files.length ? `${r.files.length} yeni baskı dosyası indi` : `Yeni baskı dosyası yok${r.pending && r.pending.length ? ' · bekleyen: ' + r.pending.join(', ') : ''}`);
};
$('#btnBuild').onclick = async () => {
  const r = await window.api.build(FORCE);
  if (r.error) toast(r.error, true);
  else { toast(`${(r.sheets || []).filter((s) => s.ok).length} sayfa hazır · Photoshop'ta kontrol edip Print'e basın`); setView('sheets'); }
  FORCE = false;
};

// ---------- Gorunum (Yerlesim / Sayfalar / Siparisler) ----------
let VIEW = 'home';
function setView(v) {
  VIEW = v;
  for (const el of document.querySelectorAll('.view')) el.classList.toggle('hidden', el.id !== 'view-' + v);
  for (const el of document.querySelectorAll('.nav-item[data-view]')) el.classList.toggle('active', el.dataset.view === v);
  document.querySelector('.main').scrollTop = 0;
  if (v === 'home') renderHome();
  if (v === 'orders') loadOrdersPage(false, true);
  if (v === 'kargo' || v === 'adres') loadKargo(false);
}
function setNewDots(n) {
  for (const el of document.querySelectorAll('.new-dot[title="Yeni sipariş"]')) el.classList.toggle('hidden', !n);
}

// ---------- Siparisler sayfasi ----------
let ORD = { rows: [] }, ORD_FILTER = 'all';
const FIN = { PAID: 'Ödendi', PENDING: 'Ödenmedi', AUTHORIZED: 'Onaylandı', PARTIALLY_PAID: 'Kısmen ödendi', REFUNDED: 'İade edildi', PARTIALLY_REFUNDED: 'Kısmen iade', VOIDED: 'İptal', EXPIRED: 'Süresi doldu' };
const FUL = { FULFILLED: 'Gönderildi', UNFULFILLED: 'Gönderilmedi', PARTIALLY_FULFILLED: 'Kısmen gönderildi', IN_PROGRESS: 'Hazırlanıyor', ON_HOLD: 'Beklemede', SCHEDULED: 'Planlandı', OPEN: 'Açık', PENDING_FULFILLMENT: 'Bekliyor', RESTOCKED: 'Stoğa döndü' };
const isCod = (g) => (g || []).some((x) => /cash on delivery|cod\b|kap[ıi]da/i.test(x));
// Odeme yontemi grubu (filtre icin)
function payCat(o) {
  const g = (o.gateways || []).join(' ');
  if (isCod(o.gateways)) return 'cod';
  if (/paytr|kredi|kart|card|iyzico|stripe|shopify.?payments|param/i.test(g)) return 'card';   // "Banka Kartı" karttir
  if (/havale|eft|banka|bank|transfer|manual|elden/i.test(g)) return 'havale';
  return 'other';
}
let ORD_PAY = 'all', ORD_RANGE = '14', OPAGE = 1, OSIZE = 25;
try { OSIZE = Number(localStorage.getItem('ordPageSize')) || 25; ORD_RANGE = localStorage.getItem('ordRange') || '14'; } catch { /* */ }
const RANGE_FETCH = { today: 2, yesterday: 2 };
function inOrdRange(t) {
  if (!t) return ORD_RANGE !== 'today' && ORD_RANGE !== 'yesterday';
  const x = Date.parse(t); const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  if (ORD_RANGE === 'today') return x >= d0.getTime();
  if (ORD_RANGE === 'yesterday') return x >= d0.getTime() - 864e5 && x < d0.getTime();
  return x >= Date.now() - (Number(ORD_RANGE) || 14) * 864e5;
}
function payCell(o) {
  if (!o.financial) return '<span class="muted">—</span>';
  const cod = isCod(o.gateways), st = FIN[o.financial] || o.financial;
  const cls = /REFUND|VOID/.test(o.financial) ? 'refund' : o.financial === 'PAID' ? 'paid' : cod ? 'cod' : 'pending';
  const label = cod && o.financial === 'PENDING' ? 'Kapıda ödeme' : st;
  const sub = cod ? (o.financial === 'PENDING' ? 'Teslimatta tahsil' : 'Kapıda ödeme') : (o.gateways || []).join(', ');
  return `<span class="chip ${cls}">${esc(label)}</span>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`;
}
function printState(o) {
  const l = o.local;
  if (!l || !l.files.length) return { key: 'nofile', html: '<span class="muted small">Dosya yok</span>' };
  const n = l.files.filter((f) => f.printed).length;
  if (n === l.files.length) return { key: 'printed', html: '<span class="chip printed">Basıldı</span>' };
  if (o.hold) return { key: 'hold', html: `<span class="chip hold">${/iptal|iade/i.test(o.hold) ? 'Basılmayacak' : 'Ödeme bekleniyor'}</span><div class="sub">${esc(o.hold)}</div>` };
  const sheets = [...new Set(l.files.flatMap((f) => f.sheets))];
  return { key: 'unprinted', html: `<span class="chip ${n ? 'partial' : 'unprinted'}">${n ? `Kısmen (${n}/${l.files.length})` : 'Basılmadı'}</span><div class="sub">${sheets.length ? esc(sheets.join(', ')) : 'Sırada'}</div>` };
}
function renderOrdersPage() {
  const q = ($('#ordSearch').value || '').trim().toLocaleLowerCase('tr');
  const fmtDate = (t) => { if (!t) return '—'; const d = new Date(t); return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); };
  const money = (o) => (o.total == null ? '—' : o.total.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (o.currency === 'TRY' ? ' ₺' : ' ' + o.currency));
  const rows = ORD.rows.filter((o) => {
    const ps = printState(o).key;
    if (ORD_FILTER !== 'all' && ps !== ORD_FILTER) return false;
    if (!inOrdRange(o.createdAt)) return false;
    if (ORD_PAY !== 'all' && payCat(o) !== ORD_PAY) return false;
    if (!q) return true;
    return [String(o.no), o.name, o.city, o.shipping, ...(o.local ? o.local.files.map((f) => f.name) : [])].join(' ').toLocaleLowerCase('tr').includes(q);
  });
  const pages = Math.max(1, Math.ceil(rows.length / OSIZE));
  if (OPAGE > pages) OPAGE = pages;
  $('#ordPager').innerHTML = pagerHtml({ total: rows.length, pages }, OPAGE, OSIZE);
  $('#ordRows').innerHTML = rows.slice((OPAGE - 1) * OSIZE, OPAGE * OSIZE).map((o) => {
    const ps = printState(o);
    const files = o.local ? o.local.files.map((f) => `<div class="ord-file" data-path="${esc(f.path)}" title="Klasörde göster">${f.isNew ? '<span class="new-dot" title="Yeni"></span>' : ''}<span class="tag">${esc(f.size || '?')}</span><span class="fname">${esc(f.name)}</span></div>`).join('') : '';
    const items = !files && o.items && o.items.length ? `<div class="sub">${o.items.map((i) => esc(`${i.qty}× ${i.title}${i.variant ? ' / ' + i.variant : ''}`)).join('<br>')}</div>` : '';
    return `<tr class="${o.cancelled ? 'cancelled' : ''}">
      <td class="no">#${o.no}${o.cancelled ? '<div class="sub">İptal</div>' : ''}</td>
      <td>${fmtDate(o.createdAt)}</td>
      <td>${o.name ? esc(o.name) : '<span class="muted">—</span>'}${o.city ? `<div class="sub">${esc(o.city)}</div>` : ''}</td>
      <td>${payCell(o)}</td>
      <td>${o.shipping ? esc(o.shipping) : '<span class="muted">—</span>'}${o.fulfillment ? `<div class="sub">${esc(FUL[o.fulfillment] || o.fulfillment)}</div>` : ''}</td>
      <td class="num">${money(o)}</td>
      <td><div class="ord-files">${files || items || '<span class="muted small">—</span>'}</div></td>
      <td>${ps.html}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="muted">Gösterilecek sipariş yok.</td></tr>';
  const inR = ORD.rows.filter((o) => inOrdRange(o.createdAt));
  const cnt = (k) => inR.filter((o) => printState(o).key === k).length;
  $('#ordInfo').textContent = `${inR.length} sipariş · ${cnt('unprinted')} basılmadı · ${cnt('hold')} ödeme bekliyor` + (ORD.fetchedAt ? ` · Shopify ${fmtTime(ORD.fetchedAt)}` : '');
}
async function loadOrdersPage(force, markSeen) {
  if (!ORD.rows.length) $('#ordRows').innerHTML = '<tr><td colspan="8" class="muted">Siparişler yükleniyor…</td></tr>';
  const r = await window.api.ordersDetail(force, RANGE_FETCH[ORD_RANGE] || Number(ORD_RANGE) || 14);
  ORD = r;
  const notes = [];
  if (r.error) notes.push(r.error);
  if (r.rows.length && !r.pii) notes.push('Müşteri adı ve şehir için Shopify uygulamasında “korunan müşteri verisi” (ad, adres) izni gerekiyor. İzin verilene kadar bu sütunlar boş kalır.');
  $('#ordNote').classList.toggle('hidden', !notes.length);
  $('#ordNote').textContent = notes.join(' ');
  renderOrdersPage();
  if (markSeen) { await window.api.ordersSeen(); loadOrders(); }
}
$('#ordSearch').oninput = () => { OPAGE = 1; renderOrdersPage(); };
$('#ordRange').value = ORD_RANGE;
$('#ordRange').onchange = (e) => { ORD_RANGE = e.target.value; OPAGE = 1; try { localStorage.setItem('ordRange', ORD_RANGE); } catch { /* */ } renderOrdersPage(); loadOrdersPage(false); };
$('#ordPay').onchange = (e) => { ORD_PAY = e.target.value; OPAGE = 1; renderOrdersPage(); };
$('#ordPager').onclick = (e) => { const b = e.target.closest('[data-pg]'); if (!b || b.disabled) return; OPAGE = Number(b.dataset.pg); renderOrdersPage(); document.querySelector('#view-orders .ord-table').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
$('#ordPager').onchange = (e) => { if (!e.target.matches('[data-pgsize]')) return; OSIZE = Number(e.target.value) || 25; OPAGE = 1; try { localStorage.setItem('ordPageSize', String(OSIZE)); } catch { /* */ } renderOrdersPage(); };
// ---------- Gunun siparis sayisi (Bugun, Siparisler, Kargo fisleri basliklarinda) ----------
let TODAY = null;
async function loadToday(force) {
  try { const r = await window.api.todayStats(force); if (r && !r.error) TODAY = r; renderToday(r && r.error); } catch { /* */ }
}
function renderToday(err) {
  for (const el of document.querySelectorAll('[data-today]')) {
    if (!TODAY) { el.querySelector('.tp-num').textContent = '–'; el.querySelector('small').textContent = err ? 'Shopify bağlı değil' : 'yükleniyor…'; continue; }
    const d = TODAY.today - TODAY.yesterdaySoFar;
    el.querySelector('.tp-num').textContent = TODAY.today;
    el.classList.toggle('up', d > 0); el.classList.toggle('down', d < 0);
    el.querySelector('small').innerHTML = `${money(TODAY.revenue)} <span class="tp-sep">·</span> <span class="tp-delta">${d > 0 ? '▲ ' + d : d < 0 ? '▼ ' + Math.abs(d) : '='}</span> dün bu saate göre`;
    el.title = `Bugün ${TODAY.today} sipariş · dün bu saate kadar ${TODAY.yesterdaySoFar}, dün toplam ${TODAY.yesterday} (iptaller hariç) · ${fmtTime(TODAY.at)}`;
  }
}
loadToday();
setInterval(() => loadToday(), 3 * 60000);
$('#ordFilter').onclick = (e) => {
  const b = e.target.closest('button[data-f]'); if (!b) return;
  ORD_FILTER = b.dataset.f;
  for (const x of $('#ordFilter').children) x.classList.toggle('active', x === b);
  renderOrdersPage();
};
// Siparisler > Yenile: once yeni siparislerin dosyalarini indir, sonra listeyi Shopify'dan tazele
$('#btnOrdRefresh').onclick = async () => {
  const b = $('#btnOrdRefresh'); const label = b.lastChild.textContent;
  b.disabled = true; b.classList.add('busy'); b.lastChild.textContent = 'Yenileniyor…';
  try {
    const r = await window.api.checkNow();
    await loadOrdersPage(true, true);
    if (r && r.error) toast(r.error, true);
    else if (r && r.busy) toast('Liste yenilendi · dosya kontrolü zaten sürüyor, bitince inecek');
    else if (r && r.files && r.files.length) toast(`Liste yenilendi · ${r.files.length} yeni baskı dosyası indi`);
    else toast('Liste yenilendi · yeni baskı dosyası yok' + (r && r.pending && r.pending.length ? ' · bekleyen: ' + r.pending.join(', ') : ''));
  } finally { b.disabled = false; b.classList.remove('busy'); b.lastChild.textContent = label; }
};
// ---------- Kargo fisleri ----------
let KG = null, KTAB = 'cod', KFILTER = 'todo';
// Sayfalama: sayfa basina 10/25/50/100 siparis (secim hatirlanir)
let KPAGE = 1, KSIZE = 25;
try { KSIZE = Number(localStorage.getItem('kargoPageSize')) || 25; } catch { /* */ }
function pageRows(rows) {
  const pages = Math.max(1, Math.ceil(rows.length / KSIZE));
  if (KPAGE > pages) KPAGE = pages;
  if (KPAGE < 1) KPAGE = 1;
  return { list: rows.slice((KPAGE - 1) * KSIZE, KPAGE * KSIZE), pages, total: rows.length };
}
function pagerHtml(pg, page, size) {
  if (!pg.total) return '';
  const from = (page - 1) * size + 1, to = Math.min(pg.total, page * size);
  const nums = [];
  for (let i = 1; i <= pg.pages; i++) if (i === 1 || i === pg.pages || Math.abs(i - page) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return `<div class="pg-info">${from}–${to} / ${pg.total} sipariş</div>
    <div class="pg-nav">${pg.pages > 1 ? `<button class="pg-btn" data-pg="${page - 1}" ${page === 1 ? 'disabled' : ''} title="Önceki sayfa">‹</button>${nums.map((n) => (n === '…' ? '<span class="pg-gap">…</span>' : `<button class="pg-btn ${n === page ? 'active' : ''}" data-pg="${n}">${n}</button>`)).join('')}<button class="pg-btn" data-pg="${page + 1}" ${page === pg.pages ? 'disabled' : ''} title="Sonraki sayfa">›</button>` : ''}</div>
    <label class="pg-size">Sayfada <select data-pgsize>${[10, 25, 50, 100].map((n) => `<option value="${n}" ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select> sipariş</label>`;
}
function renderPager(pg) { $('#kargoPager').innerHTML = pagerHtml(pg, KPAGE, KSIZE); }
const KSEL = new Set();
const money = (n) => (n == null ? '—' : Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺');
const fmtD = (t) => { if (!t) return '—'; const d = new Date(t); return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); };
// Secilebilir satir: fisi basilabilen (Geliver: PDF etiketi var; DHL: kayitli ya da henuz gonderilmemis)
function kSelectable(r) { return KTAB === 'cod' ? !r.sorun && (r.etiketli || r.gonderim !== 'FULFILLED') : !!r.pdfUrl; }
// Tarih araligi filtresi (Bugun / Dun / Son N gun)
function inRange(t) {
  const r = String(((CFG && CFG.kargo) || {}).range || ((CFG && CFG.kargo && CFG.kargo.days) || 14));
  const x = Date.parse(t); if (!x) return true;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  if (r === 'today') return x >= d0.getTime();
  if (r === 'yesterday') return x >= d0.getTime() - 864e5 && x < d0.getTime();
  return x >= Date.now() - (Number(r) || 14) * 864e5;
}
function codRows() {
  const rows = (KG.cod || []).filter((o) => inRange(o.tarih) && (o.gonderim !== 'FULFILLED' || KFILTER === 'all'));
  if (KFILTER === 'todo') return rows.filter((o) => !o.sorun && !o.printedAt);
  if (KFILTER === 'offer') return [];
  return rows;
}
function gelRows() {
  const rows = (KG.geliver || []).filter((r) => inRange(r.createdAt));
  if (KFILTER === 'todo') return rows.filter((s) => s.kind === 'ready' && !s.printedAt && s.status !== 'LABEL_PRINTED');
  if (KFILTER === 'offer') return rows.filter((s) => s.kind === 'offer');
  return rows;
}
function setCounts() {
  const todoCod = (KG.cod || []).filter((o) => inRange(o.tarih) && o.gonderim !== 'FULFILLED' && !o.sorun && !o.printedAt).length;
  const todoGel = (KG.geliver || []).filter((s) => inRange(s.createdAt) && s.kind === 'ready' && !s.printedAt && s.status !== 'LABEL_PRINTED').length;
  $('#kcCod').textContent = todoCod; $('#kcGel').textContent = todoGel;
  const errs = (KG.errors || []).length;
  for (const el of document.querySelectorAll('[data-count="labels"]')) { el.textContent = todoCod + todoGel; el.classList.toggle('hidden', !(todoCod + todoGel)); }
  for (const el of document.querySelectorAll('[data-count="errors"]')) { el.textContent = errs; el.classList.toggle('hidden', !errs); }
}
// Teklif bekleyen Geliver gonderisi: odeme durumu personel icin net olsun
function offerStatus(r) {
  const p = r.pay;
  if (p && p.hold) {
    const why = /iptal/i.test(p.hold) ? 'Sipariş iptal — kargo ALMAYIN, Geliver\'deki gönderiyi iptal edin'
      : /iade/i.test(p.hold) ? 'Ödeme iade edildi — kargo ALMAYIN'
      : 'Havale gelmeden kargo SATIN ALMAYIN';
    return `<span class="chip err">⚠ ${esc(p.hold)}</span><div class="sub warn-text">${why}</div>`;
  }
  if (!p) return `<span class="chip cod">${esc(r.statusText)}</span><div class="sub">Ödeme durumu okunamadı — Shopify'dan kontrol edin</div>`;
  if (!p.paid) return `<span class="chip cod">Ödeme alınmadı</span><div class="sub">Shopify: ${esc(p.financial || '—')} · kargo almayın</div>`;
  return `<span class="chip paid">Ödendi</span><div class="sub">${r.hepsijet ? 'Kargo satın alınabilir' : 'HepsiJet teklifi yok — Geliver\'de açın'}</div>`;
}
// Geliver bakiyesi: kartta goster, azalinca uyar
// Geliver bakiyesi: Geliver kartinin icinde, sade bir satir; 500 TL ve altinda kirmizi + "Bakiye ekle"
function renderBalance() {
  const el = $('#gelBal');
  const card = document.querySelector('.carrier.gel');
  if (!KG || !(CFG && CFG.kargo && CFG.kargo.geliverToken)) { el.innerHTML = ''; card.classList.remove('low'); return; }
  const avg = KG.avgCost || 167.19, lim = KG.lowBalance || 500;
  if (KG.balance == null) {
    el.className = 'bal na'; card.classList.remove('low');
    el.innerHTML = KG.balanceLogin
      ? `<span class="bal-dot"></span>Bakiye için Geliver'e bir kez giriş yapın <span class="bal-link warn" data-glogin="1">Giriş yap</span>`
      : `<span class="bal-dot"></span>Bakiye okunamadı <span class="bal-link" data-glogin="1" title="${esc(KG.balanceError || '')}">Geliver'e bağlan</span>`;
    return;
  }
  const n = Math.floor(KG.balance / avg), low = KG.balance <= lim;
  card.classList.toggle('low', low);
  el.className = 'bal' + (low ? ' low' : '');
  el.title = `Ortalama HepsiJet kargo ${money(avg)} (KDV dahil) · güncellendi ${fmtTime(KG.at)}`;
  el.innerHTML = `<span class="bal-dot"></span>Bakiye <b>${money(KG.balance)}</b><span class="bal-sep">·</span>≈${n} kargo`
    + (low ? `<span class="bal-link warn" data-url="https://app.geliver.io/payment">⚠ Bakiye ekle</span>` : '');
}
function renderKargo() {
  if (!KG) return;
  setCounts();
  const notes = [];
  const k = (CFG && CFG.kargo) || {};
  const needSetup = (KTAB === 'cod' && !k.codKey) || (KTAB === 'geliver' && !k.geliverToken);
  $('#kargoSetup').classList.toggle('hidden', !needSetup);
  if (needSetup) $('#kargoSetup').innerHTML = setupHtml(setupChecks().slice(3), KTAB === 'cod' ? 'Kapıda ödeme bağlantısı kurulmamış' : 'Geliver bağlantısı kurulmamış',
    'Size verilen ayar dosyasını (GIZLI-kargo-ayarlari.json) “İçe aktar” ile açın; anahtarlar kendiliğinden girilir.');
  if (KTAB === 'cod' && KG.codError && !needSetup) notes.push('Kapıda ödeme: ' + KG.codError);
  if (KTAB === 'geliver' && KG.geliverError && !needSetup) notes.push('Geliver: ' + KG.geliverError);
  if (KTAB === 'cod' && KG.codTest) notes.push('Etiket sunucusu DENEME modunda: fişler “ÖRNEK” yazılı çıkar, DHL\'e kaydedilmez.');
  $('#kargoNote').classList.toggle('hidden', !notes.length); $('#kargoNote').textContent = notes.join(' · ');
  $('#kargoFilter').querySelector('[data-f=offer]').classList.toggle('hidden', KTAB === 'cod');
  if (KTAB === 'cod' && KFILTER === 'offer') KFILTER = 'todo';
  for (const b of $('#kargoFilter').children) b.classList.toggle('active', b.dataset.f === KFILTER);
  const rows = KTAB === 'cod' ? codRows() : gelRows();
  const keyOf = (r) => (KTAB === 'cod' ? r.id : r.id);
  for (const k of [...KSEL]) if (!rows.some((r) => keyOf(r) === k)) KSEL.delete(k);
  const selectable = kSelectable;
  const pg = pageRows(rows);
  const all = pg.list.filter(selectable);   // "Hepsini sec" bu sayfadakileri secer
  $('#kargoHead').innerHTML = `<tr><th class="cb">${all.length ? `<input type="checkbox" id="kAll" title="Bu sayfadakilerin hepsini seç (${all.length})" ${all.every((r) => KSEL.has(keyOf(r))) ? 'checked' : ''}>` : ''}</th><th>Sipariş</th><th>Tarih</th><th>Alıcı</th><th>Adres</th>${KTAB === 'cod' ? '<th class="num">Tahsilat</th>' : '<th>Kargo</th>'}<th>Durum</th><th></th></tr>`;
  renderPager(pg);
  $('#kargoRows').innerHTML = pg.list.map((r) => {
    const k = keyOf(r), can = selectable(r);
    let st, act = '';
    if (KTAB === 'cod') {
      st = r.sorun ? `<span class="chip err">Adres hatası</span><div class="sub">${esc(r.sorun)}</div>`
        : r.printedAt ? `<span class="chip printed">Yazdırıldı ${fmtTime(r.printedAt)}</span>`
        : r.etiketli ? '<span class="chip ready">DHL\'e kayıtlı</span><div class="sub">Tekrar yazdırılabilir</div>'
        : r.gonderim === 'FULFILLED' ? '<span class="chip pending">Gönderildi</span>' : '<span class="chip unprinted">Yazdırılmadı</span>';
      if (can) act += `<button class="btn small" data-kprint="${esc(k)}">${r.printedAt || r.etiketli ? 'Tekrar yazdır' : 'Yazdır'}</button>`;
      if (r.printedAt) act += `<button class="btn ghost small" data-kunmark="cod:${esc(r.no)}" title="Yazdırılmadı olarak işaretle">↺</button>`;
      if (r.admin) act += `<button class="btn ghost small" data-url="${esc(r.admin)}">Shopify</button>`;
    } else {
      const ready = r.kind === 'ready';
      st = r.printedAt ? `<span class="chip printed">Yazdırıldı ${fmtTime(r.printedAt)}</span>`
        : ready ? `<span class="chip unprinted">Yazdırılmadı</span><div class="sub">${esc(r.statusText)}</div>`
        : r.kind === 'offer' ? offerStatus(r)
        : `<span class="chip pending">${esc(r.statusText)}</span>`;
      if (can) act += `<button class="btn small" data-kprint="${esc(k)}" title="Önizleyip yazdırır (ücret yok)">${ready && !r.printedAt ? 'Yazdır' : 'Tekrar yazdır'}</button>`;
      if (r.printedAt) act += `<button class="btn ghost small" data-kunmark="geliver:${esc(r.id)}" title="Yazdırılmadı olarak işaretle">↺</button>`;
      if (r.kind === 'offer' && r.pay && r.pay.paid && !r.pay.hold && r.hepsijet) act += `<button class="btn small buy" data-gbuy="${esc(r.id)}" title="HepsiJet teklifini kabul edip etiketi satın alır (Geliver bakiyesinden düşer)">HepsiJet ile satın al · ${money(r.hepsijet.total)}</button>`;
      if (r.kind === 'offer') act += `<button class="btn ghost small" data-url="https://app.geliver.io/shipments?statusFilter=GOT_OFFERS">Geliver'de aç</button>`;
      if (r.trackingUrl) act += `<button class="btn ghost small" data-url="${esc(r.trackingUrl)}">Takip</button>`;
    }
    const ship = KTAB === 'cod' ? `<td class="num">${money(r.tutar)}</td>` : `<td>${esc(r.provider || '—')}${r.price != null ? `<div class="sub">${money(r.price)}${r.desi != null ? ' · ' + r.desi + ' desi' : ''}</div>` : ''}</td>`;
    const place = KTAB === 'cod' ? [r.ilce, r.il].filter(Boolean).join(' / ') || r.sehir : [r.district, r.city].filter(Boolean).join(' / ');
    const held = KTAB === 'geliver' && r.kind === 'offer' && r.pay && r.pay.hold;
    return `<tr class="${KSEL.has(k) ? 'sel' : ''}${held ? ' held' : ''}">
      <td class="cb">${can ? `<input type="checkbox" data-ksel="${esc(k)}" ${KSEL.has(k) ? 'checked' : ''}>` : ''}</td>
      <td class="no">#${esc(r.no || '?')}</td><td>${fmtD(KTAB === 'cod' ? r.tarih : r.createdAt)}</td>
      <td>${esc(KTAB === 'cod' ? r.ad : r.name) || '—'}</td>
      <td class="addr">${esc(r.adres || r.address || '')}${place ? `<div class="sub">${esc(place)}</div>` : ''}</td>
      ${ship}<td>${st}</td><td><div class="act">${act}</div></td></tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">${KFILTER === 'todo' ? 'Yazdırılacak kargo fişi yok.' : 'Gösterilecek gönderi yok.'}</td></tr>`;
  $('#btnKargoPrint').disabled = !KSEL.size;
  $('#btnKargoPrint').lastChild.textContent = KSEL.size ? `Seçilenleri yazdır (${KSEL.size})` : 'Seçilenleri yazdır';
  $('#kargoDays').value = String(k.range || k.days || 14);
  $('#kargoInfo').textContent = KG.at ? `Güncellendi ${fmtTime(KG.at)}` : '';
  renderBalance();
  renderAdres();
}
function renderAdres() {
  const rows = KG.errors || [];
  $('#adresRows').innerHTML = rows.map((e) => {
    let fix = '', note = '';
    if (e.geliver) {
      if (e.canSync) {
        note = `<div class="fix-ok">✓ Shopify'da düzeltilmiş: ${esc(e.shopText)}</div>`;
        fix = `<button class="btn primary small" data-gsync="${esc(e.id)}">Geliver'e aktar</button>`;
      } else if (e.shopText) note = `<div class="sub">Shopify'daki adres de aynı: önce Shopify'da düzeltin, sonra Yenile.</div>`;
      else if (e.shopNote) note = `<div class="sub">${esc(e.shopNote)}</div>`;
    }
    return `<tr>
    <td class="no">#${esc(e.no || '?')}</td>
    <td>${e.source === 'cod' ? '<span class="chip cod">Kapıda ödeme · DHL</span>' : '<span class="chip ship">Geliver</span>'}</td>
    <td>${esc(e.name || '—')}</td>
    <td class="addr">${esc(e.address || '')}${e.city ? `<div class="sub">${esc(e.city)}</div>` : ''}</td>
    <td><span class="chip err">Adres hatası</span><div class="sub">${esc(e.error)}</div>${note}</td>
    <td><div class="act">${fix}${e.link ? `<button class="btn small" data-url="${esc(e.link)}">Shopify'da düzelt</button>` : ''}${e.geliver ? `<button class="btn ghost small" data-url="https://app.geliver.io/shipments">Geliver</button>` : ''}</div></td>
  </tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">${KG.codError && KG.geliverError ? 'Kargo bilgileri alınamadı: ' + esc(KG.codError) : '✓ Adres hatası olan sipariş yok.'}</td></tr>`;
}
async function loadKargo(force) {
  const r = await window.api.kargo(force);
  if (r.error) { toast(r.error, true); return; }
  KG = r; renderKargo(); renderHome();
}
$('#kargoTabs').onclick = (e) => { const b = e.target.closest('button[data-k]'); if (!b) return; KTAB = b.dataset.k; KSEL.clear(); KPAGE = 1; for (const x of $('#kargoTabs').children) x.classList.toggle('active', x === b); renderKargo(); };
$('#kargoDays').onchange = async (e) => { const v = e.target.value; KPAGE = 1; await window.api.kargoDays(v); if (CFG) CFG.kargo = { ...(CFG.kargo || {}), range: v, days: ({ today: 1, yesterday: 2 })[v] || Number(v) || 14 }; KSEL.clear(); renderKargo(); loadKargo(true); };
$('#kargoFilter').onclick = (e) => { const b = e.target.closest('button[data-f]'); if (!b) return; KFILTER = b.dataset.f; KSEL.clear(); KPAGE = 1; renderKargo(); };
async function refreshKargoBtn(b) {
  const label = b.lastChild.textContent;
  b.disabled = true; b.lastChild.textContent = 'Yenileniyor…';
  try { await loadKargo(true); toast(`Güncellendi · ${(KG && KG.errors ? KG.errors.length : 0)} adres hatası`); }
  finally { b.disabled = false; b.lastChild.textContent = label; }
}
$('#kargoPager').onclick = (e) => { const b = e.target.closest('[data-pg]'); if (!b || b.disabled) return; KPAGE = Number(b.dataset.pg); renderKargo(); $('#view-kargo').scrollTop = 0; document.querySelector('.kargo-table').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
$('#kargoPager').onchange = (e) => { if (!e.target.matches('[data-pgsize]')) return; KSIZE = Number(e.target.value) || 25; KPAGE = 1; try { localStorage.setItem('kargoPageSize', String(KSIZE)); } catch { /* */ } renderKargo(); };
$('#btnKargoRefresh').onclick = () => refreshKargoBtn($('#btnKargoRefresh'));
$('#btnAdresRefresh').onclick = () => refreshKargoBtn($('#btnAdresRefresh'));
$('#kargoRows').onchange = $('#kargoHead').onchange = (e) => {
  if (e.target.id === 'kAll') {
    const rows = pageRows(KTAB === 'cod' ? codRows() : gelRows()).list.filter(kSelectable);
    for (const r of rows) e.target.checked ? KSEL.add(r.id) : KSEL.delete(r.id);
  } else if (e.target.dataset.ksel) { e.target.checked ? KSEL.add(e.target.dataset.ksel) : KSEL.delete(e.target.dataset.ksel); }
  renderKargo();
};
async function printKargo(ids) {
  if (!ids.length) return;
  const b = $('#btnKargoPrint'); b.disabled = true;
  toast('Fişler hazırlanıyor…');
  try {
    const r = await window.api.labelsOpen(KTAB === 'cod' ? 'cod' : 'geliver', ids);
    if (r && r.error) toast(r.error, true);
    else if (r && r.ok) KSEL.clear();
    renderKargo();
  } finally { b.disabled = !KSEL.size; }
}
$('#btnKargoPrint').onclick = () => printKargo([...KSEL]);
window.api.on('kargo-updated', () => { if (VIEW === 'kargo' || VIEW === 'adres') loadKargo(false); else window.api.kargo(false).then((r) => { if (!r.error) { KG = r; setCounts(); } }); });
async function loadPrinters() {
  const list = await window.api.printers();
  const sel = $('#printerSelect'), cur = (CFG && CFG.kargo && CFG.kargo.printer) || '';
  sel.innerHTML = '<option value="">Varsayılan yazıcı</option>' + list.map((p) => `<option value="${esc(p.name)}">${esc(p.label)}${p.isDefault ? ' (varsayılan)' : ''}</option>`).join('');
  if (cur && !list.some((p) => p.name === cur)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}">${esc(cur)} (bulunamadı)</option>`);
  sel.value = cur;
}
$('#btnExport').onclick = async () => { const r = await window.api.settingsExport(); if (r && r.ok) toast('Ayarlar kaydedildi: ' + r.file); };
$('#btnImport').onclick = doImport;

$('#btnResetFiles').onclick = async () => {
  const r = await window.api.resetFiles();
  if (r.error) return toast(r.error, true);
  if (r.canceled) return;
  toast(`Sıfırlandı: ${r.folders} klasör, ${r.files} dosya silindi`);
  ORD = { rows: [] };
  refreshAll();
};
$('#toolFolder').onclick = () => CFG && window.api.openPath(CFG.downloadDir);
$('#ordMode').onclick = (e) => {
  const b = e.target.closest('button[data-m]'); if (!b) return;
  for (const x of $('#ordMode').children) x.classList.toggle('active', x === b);
  $('#ordTableWrap').classList.toggle('hidden', b.dataset.m !== 'table');
  $('#ordFilesWrap').classList.toggle('hidden', b.dataset.m !== 'files');
};

// ---------- Bugun: gunun isleri (infografik) ----------
const IC = {
  down: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="11" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="4" rx="1"/><rect x="3" y="16" width="18" height="5" rx="1"/></svg>',
  print: '<svg viewBox="0 0 24 24"><path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><path d="M12 7v4M12 14h.01"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
};
function setupChecks() {
  const k = (CFG && CFG.kargo) || {};
  return [
    { ok: !!(CFG && CFG.shop && CFG.clientId && CFG.clientSecret), label: 'Shopify bağlantısı', fix: 'shop' },
    { ok: !!(ORDR && ORDR.exists), label: 'İndirme klasörü', fix: 'dirs' },
    { ok: !!PSFOUND, label: 'Photoshop', fix: 'print' },
    { ok: !!k.codKey, label: 'Kapıda ödeme (DHL) bağlantısı', fix: 'kargo' },
    { ok: !!k.geliverToken, label: 'Geliver bağlantısı', fix: 'kargo' },
    { ok: !!k.printer, label: 'Etiket yazıcısı seçildi', fix: 'kargo' },
  ];
}
function setupHtml(checks, title, text) {
  return `<h3>${esc(title)}</h3><p>${esc(text)}</p>
    <div class="checks">${checks.map((c) => `<div class="check-item ${c.ok ? 'ok' : 'no'}"><span class="ci">${c.ok ? '✓' : '!'}</span><span>${esc(c.label)}${c.ok ? '' : ' — eksik'}</span></div>`).join('')}</div>
    <div class="setup-actions"><button class="btn primary" data-import="1">Ayar dosyasını içe aktar…</button><button class="btn" data-prefs="${esc((checks.find((c) => !c.ok) || {}).fix || 'app')}">Tercihleri aç</button></div>`;
}
function renderHome() {
  const checks = setupChecks();
  const missing = checks.filter((c) => !c.ok);
  const sc = $('#setupCard');
  sc.classList.toggle('hidden', !missing.length);
  if (missing.length) sc.innerHTML = setupHtml(checks, 'Kurulumu tamamlayın', 'Bazı bağlantılar eksik. En kolayı: diğer bilgisayardan ya da size verilen ayar dosyasını “İçe aktar” ile açmak.');
  const p = PLAN || { sheets: [], held: [], waiting: [], placed: 0, count: 0 };
  const unprintedSheets = (SHEETS || []).filter((s) => !s.printedAt).length;
  const newFiles = (ORDR && ORDR.newCount) || 0;
  const totalFiles = ORDR ? ORDR.groups.reduce((a, g) => a + g.files.length, 0) : 0;
  const todoCod = KG ? (KG.cod || []).filter((o) => o.gonderim !== 'FULFILLED' && !o.sorun && !o.printedAt).length : 0;
  const todoGel = KG ? (KG.geliver || []).filter((x) => x.kind === 'ready' && !x.printedAt && x.status !== 'LABEL_PRINTED').length : 0;
  const steps = [
    { n: 1, ic: IC.down, c: 'c-blue', title: 'Siparişler indi', big: newFiles, unit: 'yeni dosya', sub: `Son 7 günde ${totalFiles} dosya. Program her ${CFG ? CFG.intervalMin : '?'} dakikada bir kendisi kontrol eder.`, btn: ['Siparişlere git', 'orders'], todo: false },
    { n: 2, ic: IC.grid, c: 'c-violet', title: 'Sayfaları hazırla', big: p.sheets.length, unit: 'sayfa', sub: p.placed ? `${p.placed} baskı dizilmeyi bekliyor.` + (p.waiting.length ? ` ${p.waiting.length} tasarım sonraki siparişleri bekliyor.` : '') : 'Dizilecek baskı yok.', btn: ['Baskı sırasını aç', 'plan'], todo: p.sheets.length > 0 },
    { n: 3, ic: IC.print, c: 'c-green', title: 'Sayfaları bas', big: unprintedSheets, unit: 'sayfa', sub: unprintedSheets ? 'Photoshop’ta kontrol edip Print ile basın.' : 'Bekleyen baskı sayfası yok.', btn: ['Hazır sayfalara git', 'sheets'], todo: unprintedSheets > 0 },
    { n: 4, ic: IC.box, c: 'c-orange', title: 'Kargo fişlerini yazdır', big: KG ? todoCod + todoGel : '–', unit: 'fiş', sub: KG ? `Kapıda ödeme ${todoCod} · Geliver ${todoGel}` : 'Kargo bağlantısı kurulunca görünür.', btn: ['Kargo fişlerine git', 'kargo'], todo: todoCod + todoGel > 0 },
  ];
  $('#homeFlow').innerHTML = steps.map((st) => `<div class="step ${st.todo ? 'todo' : st.big === 0 ? 'done' : ''}">
      <div class="step-top"><span class="step-no">${st.big === 0 && !st.todo ? '✓' : st.n}</span><span class="step-title">${esc(st.title)}</span><span class="step-ic ${st.c}">${st.ic}</span></div>
      <div class="step-big">${esc(st.big)}<small>${esc(st.unit)}</small></div>
      <div class="step-sub">${esc(st.sub)}</div>
      <button class="btn${st.todo ? ' primary' : ''}" data-view="${st.btn[1]}">${esc(st.btn[0])}</button>
    </div>`).join('');
  const alerts = [];
  const errs = KG ? (KG.errors || []).length : 0;
  if (errs) alerts.push({ c: 'red', ic: IC.pin, t: `${errs} siparişte adres hatası`, s: 'Kargo fişi alınamıyor; Shopify’da düzeltin.', btn: ['İncele', 'adres'] });
  if (p.held && p.held.length) alerts.push({ c: 'red', ic: IC.card, t: `${p.held.length} baskı ödeme bekliyor`, s: 'Havale ödemesi gelmeden basılmaz.', btn: ['Gör', 'plan'] });
  if (p.waiting && p.waiting.length) alerts.push({ c: 'orange', ic: IC.clock, t: `${p.waiting.length} tasarım sıra bekliyor`, s: 'Tam satır olunca dizilir; acilse “Bekleyenleri de diz”.', btn: ['Gör', 'plan'] });
  $('#homeAlerts').innerHTML = alerts.map((a) => `<div class="alert ${a.c}"><span class="a-ic c-${a.c}">${a.ic}</span><div><b>${esc(a.t)}</b><span class="muted">${esc(a.s)}</span></div><button class="btn small" data-view="${a.btn[1]}">${esc(a.btn[0])}</button></div>`).join('');
}
async function doImport() {
  const r = await window.api.settingsImport();
  if (!r || r.canceled) return;
  if (r.error) return toast(r.error, true);
  CFG = r.config; fillSettings(CFG); loadPrinters(); toast('Ayarlar içe aktarıldı');
  KG = null; await loadKargo(true); renderHome();
}

// ---------- Tercihler gezinme ----------
function gotoPref(id) {
  const el = document.getElementById(id); if (!el) return;
  $('#settingsForm').scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
  for (const a of document.querySelectorAll('.pref-nav a')) a.classList.toggle('active', a.dataset.goto === id);
}
$('#settingsForm').addEventListener('scroll', () => {
  const f = $('#settingsForm'); let cur = 'set-app';
  for (const a of document.querySelectorAll('.pref-nav a')) { const h = document.getElementById(a.dataset.goto); if (h && h.offsetTop - 40 <= f.scrollTop) cur = a.dataset.goto; }
  if (f.scrollTop + f.clientHeight >= f.scrollHeight - 4) cur = 'set-reset';
  for (const a of document.querySelectorAll('.pref-nav a')) a.classList.toggle('active', a.dataset.goto === cur);
});
$('#btnCancel').onclick = () => { if (CFG) fillSettings(CFG); openDrawer(false); };
$('#btnRedownload').onclick = async () => {
  const n = parseInt($('#redoFrom').value, 10);
  if (!(n > 0)) return toast('Sipariş numarası girin (ör. 2266).', true);
  const b = $('#btnRedownload'); b.disabled = true; b.textContent = 'İndiriliyor…';
  try {
    const r = await window.api.redownload(n);
    if (r && r.busy) toast('Şu an kontrol yapılıyor, birazdan tekrar deneyin.', true);
    else if (r && r.error) toast(r.error, true);
    else { toast(`#${n} ve sonrası: ${r.files.length} dosya indi` + (r.skipped ? `, ${r.skipped} zaten vardı` : '')); refreshAll(); }
  } finally { b.disabled = false; b.textContent = 'Yeniden indir'; }
};
$('#forceAll').onchange = (e) => { FORCE = e.target.checked; loadPlan(); };
$('#btnPrintAll').onclick = () => doPrint(SHEETS.filter((s) => !s.printedAt).map((s) => s.path).reverse());
$('#btnSettings').onclick = () => openDrawer(true);
$('#btnCloseSettings').onclick = $('#drawerBg').onclick = () => openDrawer(false);
$('#btnSave').onclick = async () => {
  const r = await window.api.saveConfig(readSettings());
  CFG = r.config; fillSettings(CFG); setPsFound(r.photoshop); renderCard(); openDrawer(false); toast('Ayarlar kaydedildi');
  if (CFG.kargo && (CFG.kargo.geliverToken || CFG.kargo.codKey)) window.api.kargo(true).then((x) => { if (!x.error) { KG = x; setCounts(); if (VIEW === 'kargo' || VIEW === 'adres') renderKargo(); } });
};
$('#actToggle').onclick = () => $('#activity').classList.toggle('open');

// ---------- Guncelleme ----------
let UPD = {};
function renderUpdate() {
  const u = UPD, s = u.state;
  $('#updCurrent').textContent = 'v' + (u.current || '—');
  const when = u.checkedAt ? ` · son kontrol ${fmtTime(u.checkedAt)}` : '';
  const map = {
    dev: ['Geliştirme modunda güncelleme kontrolü kapalı.', 'Geliştirme', 'upd-idle'],
    idle: ['Güncellemeler otomatik kontrol edilir.', 'Bekliyor', 'upd-idle'],
    checking: ['Yeni sürüm aranıyor…', 'Kontrol ediliyor', 'upd-idle'],
    none: ['En güncel sürümü kullanıyorsunuz' + when + '.', 'Güncel', 'upd-ok'],
    available: [`v${u.latest} yayınlandı. İndirme sayfası açılır.`, 'Yeni sürüm', 'upd-new'],
    downloading: [`v${u.latest} indiriliyor… %${u.percent || 0}`, 'İndiriliyor', 'upd-new'],
    ready: [`v${u.latest} indirildi. Program kapanıp yeni sürümle açılır.`, 'Kuruluma hazır', 'upd-new'],
    error: [(u.error || 'Bilinmeyen hata') + when, 'Hata', 'upd-err'],
  };
  const [text, chip, cls] = map[s] || map.idle;
  $('#updText').textContent = text;
  $('#updChip').textContent = chip; $('#updChip').className = 'chip ' + cls;
  $('#updBarWrap').classList.toggle('hidden', s !== 'downloading');
  $('#updBar').style.width = (u.percent || 3) + '%';
  $('#updNotes').classList.toggle('hidden', !(u.notes && (s === 'ready' || s === 'available' || s === 'downloading')));
  $('#updNotes').textContent = u.notes || '';
  $('#btnUpdCheck').disabled = s === 'checking' || s === 'downloading' || s === 'dev';
  const inst = $('#btnUpdInstall');
  inst.classList.toggle('hidden', !(s === 'ready' || s === 'available'));
  inst.textContent = s === 'available' ? 'İndirme sayfasını aç' : 'Yeniden başlat ve güncelle';
  inst.disabled = !!STATUS.job;

  const top = $('#btnUpdateTop');
  top.classList.toggle('hidden', !['ready', 'available', 'downloading'].includes(s));
  top.classList.toggle('soft', s === 'downloading');
  $('#updTopText').textContent = s === 'downloading' ? `Güncelleme iniyor %${u.percent || 0}` : `v${u.latest} hazır · Güncelle`;
}
$('#btnUpdCheck').onclick = async () => { UPD = await window.api.updateCheck(); renderUpdate(); };
async function doInstall() {
  if (STATUS.job) return toast('Photoshop işlemi bitince güncelleyin.', true);
  const ok = await window.api.updateInstall();
  if (!ok) toast('Güncelleme şu an kurulamadı.', true);
}
$('#btnUpdInstall').onclick = doInstall;
$('#btnUpdateTop').onclick = () => (UPD.state === 'ready' ? doInstall() : openDrawer(true));
window.api.on('update', (u) => { UPD = u; renderUpdate(); });

window.api.on('status', (s) => { const wasJob = STATUS.job; STATUS = s; renderStatus(); renderUpdate(); if (wasJob && !s.job) refreshAll(); });
window.api.on('log', addLog);
window.api.on('refresh', () => { refreshAll(); loadToday(); });

(async () => {
  const d = await window.api.init();
  CFG = d.config; STATUS = d.status;
  document.body.classList.toggle('mac', d.status.platform === 'darwin');
  document.body.classList.toggle('win', d.status.platform === 'win32');
  $('#ver').textContent = `v${d.status.version}`;
  fillSettings(CFG); setPsFound(d.photoshop); renderCard(); loadPrinters();
  if (CFG.kargo && (CFG.kargo.geliverToken || CFG.kargo.codKey)) window.api.kargo(false).then((r) => { if (!r.error) { KG = r; setCounts(); renderHome(); } });
  setView('home');
  UPD = d.update || {}; renderUpdate();
  d.logs.forEach(addLog);
  renderStatus();
  await refreshAll();

  setInterval(renderStatus, 30000);
})();
