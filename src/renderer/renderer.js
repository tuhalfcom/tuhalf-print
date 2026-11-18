'use strict';
const $ = (s) => document.querySelector(s);
const eyeBtn = (no) => `<button class="eye" data-od="${esc(no)}" title="Siparişi önizle"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
// Birden fazla urunlu siparis: personel atlamasin diye her yerde belirgin isaret
let ORDQ = new Map();
function buildQty() { buildNotes(); ORDQ = new Map(); for (const o of (typeof ORD !== 'undefined' && ORD.rows) || []) if (o.items && o.items.length) ORDQ.set(Number(o.no), o.items.reduce((a, i) => a + (Number(i.qty) || 1), 0)); }
const qtyOf = (no) => ORDQ.get(Number(no)) || 0;
// Musteri notlari (hediye paketi, ozel istek...) — personel atlamasin diye her listede gosterilir
let NOTES = new Map();
function buildNotes() { NOTES = new Map(); for (const o of (typeof ORD !== 'undefined' && ORD.rows) || []) if (o.note) NOTES.set(Number(o.no), o.note); }
const noteOf = (no) => NOTES.get(Number(no)) || '';
const noteHtml = (no, cls = '') => { const n = noteOf(no); return n ? `<div class="cnote ${cls}" title="${esc(n)}"><b>Müşteri notu</b><span>${esc(n)}</span></div>` : ''; };
const multiBadge = (no) => { const n = qtyOf(no); return n > 1 ? `<span class="qty-badge" title="Bu siparişte ${n} ürün var — hepsini birlikte hazırlayıp aynı pakete koyun">${n} ürün</span>` : ''; };
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
// Cerceve rengi dosya adindan: 2276-30x42-Naturel-Urun-1.png -> Naturel
const FRAME_TR = { CERCEVESIZ: 'Çerçevesiz', NATUREL: 'Naturel', SIYAH: 'Siyah', BEYAZ: 'Beyaz', CEVIZ: 'Ceviz', ALTIN: 'Altın', GUMUS: 'Gümüş' };
function frameOf(i) {
  const raw = i.color || (String(i.fileName || i.name || '').match(/^\d+-[^-]+-([^-.]+)/) || [])[1] || '';
  if (!raw || /^renk-?yok$/i.test(raw)) return null;
  const key = raw.toUpperCase().replace(/[^A-Z]/g, '');
  const cls = { SIYAH: 'f-black', BEYAZ: 'f-white', NATUREL: 'f-wood', CEVIZ: 'f-walnut', CERCEVESIZ: 'f-none' }[key] || 'f-other';
  return { label: FRAME_TR[key] || raw, cls };
}
function paperHtml(sheet, items) {
  // Yazici son ogeden sonra keser: onizleme de basilacak uzunlukta gosterilir
  const used = items.length ? Math.max(...items.map((i) => i.yMm + i.hMm)) + (CFG ? Number(CFG.print.marginMm) || 0 : 0) : sheet.lengthMm;
  const w = sheet.widthMm, h = Math.min(sheet.lengthMm, Math.max(used, 50));
  const slots = items.map((i) => {
    const bg = i.thumb ? `background-image:url('${window.api.fileUrl(i.thumb)}');` : '';
    const box = `left:${(i.xMm / w) * 100}%;top:${(i.yMm / h) * 100}%;width:${(i.wMm / w) * 100}%;height:${(i.hMm / h) * 100}%;`;
    // 90 derece cevrik baskida gorseli de cevir
    const inner = i.rotated
      ? `<div class="img" style="${bg}width:${(i.hMm / i.wMm) * 100}%;height:${(i.wMm / i.hMm) * 100}%;transform:translate(-50%,-50%) rotate(90deg)"></div>`
      : `<div class="img" style="${bg}width:100%;height:100%;left:0;top:0"></div>`;
    const q = i.card ? 0 : qtyOf(i.order);
    const fr = i.card ? null : frameOf(i);
    return `<div class="slot${i.card ? ' card' : ''}${q > 1 ? ' is-multi' : ''}" style="${box}" title="${esc(i.name)}${q > 1 ? ` — bu siparişte ${q} ürün var` : ''}">${inner}<span>${i.card ? 'Kart' : '#' + esc(i.order)}${q > 1 ? ` · ${q} ürün` : ''}${!i.card && noteOf(i.order) ? ' · Not' : ''}</span>${fr ? `<em class="frame ${fr.cls}" title="Çerçeve rengi">${esc(fr.label)}</em>` : ''}</div>`;
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
  // Doluluk: yazici tasarim bitince kestigi icin sayfanin KULLANILAN boyuna gore hesaplanir (609,6 x kullanilan uzunluk)
  // Yazici son tasarimdan sonra keser: basilan uzunluk = en alttaki ogenin bittigi yer + kenar boslugu
  const usedLen = (s) => Math.min(s.lengthMm || Infinity, Math.max(0, ...s.items.map((i) => i.yMm + i.hMm)) + (CFG ? Number(CFG.print.marginMm) || 0 : 0));
  const fillOf = (s) => { const a = (s.widthMm || (CFG ? CFG.print.rollWidthMm : 0)) * usedLen(s); return a ? Math.min(100, Math.round(100 * s.items.reduce((x, i) => x + i.wMm * i.hMm, 0) / a)) : 0; };
  const fills = p.sheets.map(fillOf);
  if (fills.length) $('#planSummary').textContent += ` · ortalama doluluk %${Math.round(fills.reduce((a, b) => a + b, 0) / fills.length)}`;
  let html = p.sheets.map((s, n) => {
    const designs = s.items.filter((i) => !i.card).length;
    const f = fills[n];
    return `<div class="artboard">
      <div class="artboard-title"><b>Sayfa ${n + 1}</b><span>${designs} baskı${s.cards ? ` · ${s.cards} kart` : ''} <span class="fill ${f < 50 ? 'low' : f < 70 ? 'mid' : ''}" title="Tasarım ve kartların, basılacak alanda kapladığı yer. Yazıcı son tasarımdan sonra kestiği için sayfanın kalanı sayılmaz.">%${f} dolu · ${Math.round(usedLen(s) / 10)} cm</span></span></div>
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
  const list = SHEETS.filter((s) => (SHEET_TAB === 'done' ? !!s.printedAt : !s.printedAt));
  if (SHEET_TAB === 'done') list.sort((a, b) => b.printedAt - a.printedAt);
  let lastDay = '';
  $('#sheets').innerHTML = list.map((s) => {
    let head = '';
    if (SHEET_TAB === 'done') { const d = new Date(s.printedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }); if (d !== lastDay) { lastDay = d; head = `<div class="sheet-day">${esc(d)}</div>`; } }
    return head + sheetCard(s);
  }).join('') || (SHEET_TAB === 'done'
    ? '<div class="empty-state"><span class="es-ic">⟲</span><b>Henüz basılan sayfa yok</b><span>Basılan sayfalar burada gün gün listelenir; yanlış işaretleneni “Basılmadı” yapabilirsiniz.</span></div>'
    : `<div class="empty-state"><span class="es-ic">✓</span><b>Basılacak sayfa yok</b><span>${PLAN && PLAN.sheets.length ? `Baskı sırasında ${PLAN.sheets.length} sayfa hazırlanmayı bekliyor.` : 'Yeni siparişler gelince Baskı sırasında dizilir.'}</span>${PLAN && PLAN.sheets.length ? '<button class="btn primary" data-view="plan">Baskı sırasını aç</button>' : ''}</div>`);
}
let SHEET_TAB = 'todo';
function sheetCard(s) {
  {
    const m = s.meta;
    const preview = m ? paperHtml(m, m.items) : '<div class="paper" style="aspect-ratio:610/420"></div>';
    const chip = s.printedAt ? `<span class="chip printed" title="${esc(s.printedBy ? s.printedBy + ' bilgisayarında basıldı' : '')}">Basıldı ${fmtTime(s.printedAt)}${s.printedBy ? ' · ' + esc(s.printedBy) : ''}</span>` : '<span class="chip ready">Baskıya hazır</span>';
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
  }
}
$('#sheetTab').onclick = (e) => { const b = e.target.closest('button[data-t]'); if (!b) return; SHEET_TAB = b.dataset.t; for (const x of $('#sheetTab').children) x.classList.toggle('active', x === b); loadSheets(); };

// Ust uste gelen yenileme isteklerini tek seferde topla (ayni anda en fazla bir yenileme)
let RF_RUN = null, RF_AGAIN = false, RF_T = null;
// Siparis listesi (urun adedi + musteri notu) once yuklenir; baski sirasi ve kargo listeleri bunu kullanir
const refreshNow = () => loadOrdersPage(false, VIEW === 'orders').catch(() => {})
  .then(() => Promise.all([loadOrders(), loadPlan(), loadSheets()]))
  .then(() => { renderHome(); try { if (VIEW === 'kargo' && KG) renderKargo(); } catch { /* */ } }).catch((e) => toast(e.message, true));
function refreshAll() {
  if (RF_RUN) { RF_AGAIN = true; return RF_RUN; }
  RF_RUN = refreshNow().finally(() => { RF_RUN = null; if (RF_AGAIN) { RF_AGAIN = false; clearTimeout(RF_T); RF_T = setTimeout(refreshAll, 250); } });
  return RF_RUN;
}

// ---------- Etkinlik ----------
const LOGS = [];
let ACT_F = 'all';
function addLog(e) {
  LOGS.push(e); if (LOGS.length > 400) LOGS.shift();
  if (VIEW === 'home') renderFeed();
  const row = document.createElement('div');
  row.className = 'log ' + e.level + (ACT_F === 'ok' && e.level !== 'ok' || ACT_F === 'bad' && !/warn|error/.test(e.level) ? ' f-hide' : '');
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
  if ($('#phoneOn')) $('#phoneOn').checked = !(c.phone && c.phone.enabled === false);
}
function readSettings() {
  const out = { print: {}, card: {}, kargo: {}, roles: {} };
  for (const el of $('#settingsForm').elements) {
    if (!el.name) continue;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
    if (el.name === 'print.portraitLocked') v = v.split(',').map((x) => x.trim()).filter(Boolean);
    const [a, b] = el.name.split('.');
    if (b) out[a][b] = v; else out[a] = v;
  }
  return out;
}
async function renderStations() {
  try {
    const r = await window.api.stations();
    $('#pcList').innerHTML = r.list.length ? r.list.map((x) => `<div class="pc-row"><span class="pc-dot ${Date.now() - x.seen < 15 * 60000 ? 'on' : ''}"></span><b>${esc(x.name)}</b>${x.me ? ' <span class="chip ready">bu bilgisayar</span>' : ''}<span class="grow"></span><span>${x.roles && x.roles.download === false ? 'indirme kapalı' : 'indiriyor'}</span><span>· v${esc(x.version || '?')}</span><span>· ${fmtD(x.seen)}</span></div>`).join('')
      : 'Henüz kayıt yok (indirme klasörü seçilince oluşur).';
    document.querySelector('[name="station"]').placeholder = r.host || 'Bilgisayar adı';
  } catch { /* */ }
}
document.addEventListener('click', (e) => { if (e.target.id === 'btnPcRefresh') renderStations(); });
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
function openDrawer(open) {
  if (open) renderStations(); $('#drawer').classList.toggle('open', open); $('#drawerBg').classList.toggle('hidden', !open); }

// ---------- Olaylar ----------
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-open],[data-print],[data-show],[data-pick],[data-mark],[data-ps],[data-view],[data-goto],[data-scroll],[data-url],[data-kprint],[data-kunmark],[data-import],[data-prefs],[data-gsync],[data-gbuy],[data-glogin],[data-kgo],.order,.ord-file');
  if (!t) return;
  if (t.dataset.import) return doImport();
  if (t.dataset.kgo) { KTAB = 'geliver'; KFILTER = t.dataset.kgo; KPAGE = 1; for (const x of $('#kargoTabs').children) x.classList.toggle('active', x.dataset.k === 'geliver'); }
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
    return `<tr class="${o.cancelled ? 'cancelled' : ''}${qtyOf(o.no) > 1 ? ' is-multi' : ''}${o.note ? ' has-note' : ''}">
      <td class="no"><div class="no-wrap">${eyeBtn(o.no)}<span>#${o.no}</span>${multiBadge(o.no)}</div>${o.cancelled ? '<div class="sub">İptal</div>' : ''}</td>
      <td>${fmtDate(o.createdAt)}</td>
      <td>${o.name ? esc(o.name) : '<span class="muted">—</span>'}${o.city ? `<div class="sub">${esc(o.city)}</div>` : ''}${noteHtml(o.no)}</td>
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
  ORD = r; buildQty();
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
  try { const r = await window.api.todayStats(force); if (r && !r.error) TODAY = r; renderToday(r && r.error); watchAlerts(); } catch { /* */ }
}
function renderToday(err) {
  for (const el of document.querySelectorAll('[data-today]')) {
    if (!TODAY) { el.querySelector('.tp-num').textContent = '–'; el.querySelector('small').textContent = err ? 'Shopify bağlı değil' : 'yükleniyor…'; continue; }
    const d = TODAY.today - TODAY.yesterdaySoFar;
    el.querySelector('.tp-num').textContent = TODAY.today;
    el.classList.toggle('up', d > 0); el.classList.toggle('down', d < 0);
    el.querySelector('small').innerHTML = `${money(TODAY.revenue)} <span class="tp-sep">·</span> <span class="tp-delta">${d > 0 ? '+' + d : d < 0 ? '−' + Math.abs(d) : '±0'}</span> düne göre`;
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
        : r.printedAt ? `<span class="chip printed">Yazdırıldı ${fmtTime(r.printedAt)}${r.printedBy ? " · " + esc(r.printedBy) : ""}</span>`
        : r.etiketli ? '<span class="chip ready">DHL\'e kayıtlı</span><div class="sub">Tekrar yazdırılabilir</div>'
        : r.gonderim === 'FULFILLED' ? '<span class="chip pending">Gönderildi</span>' : '<span class="chip unprinted">Yazdırılmadı</span>';
      if (can) act += `<button class="btn small" data-kprint="${esc(k)}">${r.printedAt || r.etiketli ? 'Tekrar yazdır' : 'Yazdır'}</button>`;
      if (r.printedAt) act += `<button class="btn ghost small" data-kunmark="cod:${esc(r.no)}" title="Yazdırılmadı olarak işaretle">↺</button>`;
      if (r.admin) act += `<button class="btn ghost small" data-url="${esc(r.admin)}">Shopify</button>`;
    } else {
      const ready = r.kind === 'ready';
      st = r.printedAt ? `<span class="chip printed">Yazdırıldı ${fmtTime(r.printedAt)}${r.printedBy ? " · " + esc(r.printedBy) : ""}</span>`
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
    return `<tr class="${KSEL.has(k) ? 'sel' : ''}${held ? ' held' : ''}${qtyOf(r.no) > 1 ? ' is-multi' : ''}${noteOf(r.no) ? ' has-note' : ''}">
      <td class="cb">${can ? `<input type="checkbox" data-ksel="${esc(k)}" ${KSEL.has(k) ? 'checked' : ''}>` : ''}</td>
      <td class="no"><div class="no-wrap">${r.no ? eyeBtn(r.no) : ''}<span>#${esc(r.no || '?')}</span>${r.no ? multiBadge(r.no) : ''}</div></td><td>${fmtD(KTAB === 'cod' ? r.tarih : r.createdAt)}</td>
      <td>${esc(KTAB === 'cod' ? r.ad : r.name) || '—'}${r.no ? noteHtml(r.no) : ''}</td>
      <td class="addr">${esc(r.adres || r.address || '')}${place ? `<div class="sub">${esc(place)}</div>` : ''}</td>
      ${ship}<td>${st}</td><td><div class="act">${act}</div></td></tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">${KFILTER === 'todo' ? 'Yazdırılacak kargo fişi yok.' : 'Gösterilecek gönderi yok.'}</td></tr>`;
  $('#btnKargoPrint').disabled = !KSEL.size;
  $('#btnKargoPrint').lastChild.textContent = KSEL.size ? `Seçilenleri yazdır (${KSEL.size})` : 'Seçilenleri yazdır';
  $('#kargoDays').value = String(k.range || k.days || 14);
  $('#kargoInfo').textContent = KG.at ? `Güncellendi ${fmtTime(KG.at)}` : '';
  renderBalance();
  const bulk = KTAB === 'geliver' && KFILTER === 'offer' ? (KG.geliver || []).filter((x) => inRange(x.createdAt) && x.kind === 'offer' && x.pay && x.pay.paid && !x.pay.hold && x.hepsijet) : [];
  $('#btnBulkBuy').classList.toggle('hidden', bulk.length < 2);
  if (bulk.length >= 2) $('#btnBulkBuy').textContent = `Ödenmişlerin hepsini HepsiJet ile al (${bulk.length} · ${money(bulk.reduce((a, x) => a + x.hepsijet.total, 0))})`;
  watchAlerts();
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
    <td class="no"><div class="no-wrap">${e.no ? eyeBtn(e.no) : ''}<span>#${esc(e.no || '?')}</span>${e.no ? multiBadge(e.no) : ''}</div></td>
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
// Telefondan takip
let PHONE_URL = '';
$('#btnPhoneLink').onclick = async () => {
  const b = $('#btnPhoneLink'); b.disabled = true; b.textContent = 'Hazırlanıyor…';
  try {
    const r = await window.api.phoneLink();
    if (!r || r.error) { $('#phoneQr').innerHTML = `<span class="small" style="color:var(--bad)">${esc((r && r.error) || 'Bağlantı alınamadı')}</span>`; return; }
    PHONE_URL = r.url;
    $('#phoneQr').innerHTML = `<img src="${r.qr}" alt="Telefon bağlantısı QR kodu">`;
    $('#btnPhoneCopy').classList.remove('hidden');
    $('#phoneOn').checked = r.enabled !== false;
    if (r.store === false) toast('Sunucuda durum deposu henüz kurulmamış; sayfa boş görünebilir.', true);
  } finally { b.disabled = false; b.textContent = 'Telefon bağlantısını göster'; }
};
$('#btnPhoneCopy').onclick = () => { if (PHONE_URL) { navigator.clipboard.writeText(PHONE_URL); toast('Bağlantı kopyalandı'); } };
$('#phoneOn').onchange = (e) => window.api.phoneEnable(e.target.checked);
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
// ---------- Sesli / bildirimli uyarilar ----------
const WATCH = { orders: null, errors: null, low: null };
function beep(kind) {
  if (CFG && CFG.sound === false) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'bad' ? [[520, 0], [390, 0.16]] : [[740, 0], [988, 0.13]];
    for (const [f, t] of notes) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.22);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.25);
    }
    setTimeout(() => ac.close(), 800);
  } catch { /* */ }
}
function watchAlerts() {
  if (TODAY) {
    if (WATCH.orders != null && TODAY.today > WATCH.orders) { const n = TODAY.today - WATCH.orders; beep('good'); window.api.notify('Yeni sipariş', `${n} yeni sipariş geldi · bugün toplam ${TODAY.today}`); }
    WATCH.orders = TODAY.today;
  }
  if (KG) {
    const e = (KG.errors || []).length;
    if (WATCH.errors != null && e > WATCH.errors) { beep('bad'); window.api.notify('Adres hatası', `${e - WATCH.errors} siparişte adres hatası var; kargo fişi alınamıyor.`); }
    WATCH.errors = e;
    if (KG.balance != null) {
      const low = KG.balance <= (KG.lowBalance || 500);
      if (WATCH.low === false && low) { beep('bad'); window.api.notify('Geliver bakiyesi azaldı', `Bakiye ${money(KG.balance)} — bakiye ekleyin.`); }
      WATCH.low = low;
    }
  }
}
async function renderSummary() {
  let d = {};
  try { d = await window.api.daySummary(); } catch { /* */ }
  $('#sumDate').textContent = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  const cell = (n, l, c = '') => `<div class="sum-cell ${c}"><b>${n}</b><span>${l}</span></div>`;
  $('#homeSum').innerHTML = [
    cell(TODAY ? TODAY.today : '–', 'sipariş geldi', 'green'),
    cell(TODAY ? money(TODAY.revenue).replace(',00', '') : '–', 'ciro'),
    cell(d.files ?? '–', 'baskı dosyası indi'),
    cell(d.sheets ?? '–', 'sayfa basıldı'),
    cell(d.labels ?? '–', 'kargo fişi yazdırıldı'),
    cell(d.bought ? money(d.spent).replace(',00', '') : '0 ₺', `kargo harcaması${d.bought ? ` (${d.bought})` : ''}`),
  ].join('');
}
function renderFeed() {
  const el = $('#homeFeed'); if (!el) return;
  const rows = LOGS.filter((e) => e.level !== 'info').slice(-7).reverse();
  el.innerHTML = rows.map((e) => `<div class="feed-row ${e.level}"><span class="feed-dot"></span><span class="feed-msg">${esc(e.msg)}</span><time>${fmtTime(e.t)}</time></div>`).join('') || '<div class="muted small">Bugün henüz bir olay yok.</div>';
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
  // Siradaki is: personel ne yapacagini dusunmesin
  let nx;
  if (missing.length) nx = { t: 'Kurulumu tamamlayın', s: 'Eksik bağlantılar var; ayar dosyasını içe aktarmak en kolayı.', b: 'Ayar dosyasını içe aktar…', a: 'data-import="1"', c: 'blue' };
  else if (errs) nx = { t: `${errs} siparişte adres hatası var`, s: 'Kargo fişi alınamıyor. Shopify’da düzeltip “Geliver’e aktar” ya da Yenile.', b: 'Adres hatalarını aç', a: 'data-view="adres"', c: 'red' };
  else if (unprintedSheets) nx = { t: `${unprintedSheets} hazır sayfa basılmayı bekliyor`, s: 'Photoshop’ta kontrol edip yazdırın.', b: 'Hazır sayfalara git', a: 'data-view="sheets"', c: 'green' };
  else if (p.sheets.length) nx = { t: `${p.sheets.length} sayfa hazırlanmayı bekliyor`, s: `${p.placed} baskı rulo sayfalarına dizilecek.`, b: 'Baskı sırasını aç', a: 'data-view="plan"', c: 'violet' };
  else if (KG && todoCod + todoGel) nx = { t: `${todoCod + todoGel} kargo fişi yazdırılacak`, s: `Kapıda ödeme ${todoCod} · Geliver ${todoGel}`, b: 'Kargo fişlerine git', a: 'data-view="kargo"', c: 'orange' };
  else if (KG && (KG.geliver || []).some((x) => x.kind === 'offer' && x.pay && x.pay.paid && x.hepsijet)) { const n = KG.geliver.filter((x) => x.kind === 'offer' && x.pay && x.pay.paid && x.hepsijet).length; nx = { t: `${n} ödenmiş siparişin kargosu alınmadı`, s: 'Geliver › Teklif bekleyen’den HepsiJet ile alın.', b: 'Teklif bekleyenleri aç', a: 'data-view="kargo" data-kgo="offer"', c: 'orange' }; }
  else nx = { t: 'Her şey yolunda', s: 'Bekleyen iş yok. Yeni sipariş gelince burada görünür.', b: '', a: '', c: 'ok' };
  $('#homeNext').className = 'next ' + nx.c + (missing.length ? ' hidden' : '');
  $('#homeNext').innerHTML = `<span class="next-ic">${nx.c === 'ok' ? '✓' : '→'}</span><div><small>Sıradaki iş</small><b>${esc(nx.t)}</b><span class="muted">${esc(nx.s)}</span></div>${nx.b ? `<button class="btn primary" ${nx.a}>${esc(nx.b)}</button>` : ''}`;
  renderSummary(); renderFeed();
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
$('#actFilter').onclick = (e) => {
  const b = e.target.closest('button[data-f]'); if (!b) return;
  ACT_F = b.dataset.f;
  for (const x of $('#actFilter').children) x.classList.toggle('active', x === b);
  for (const row of $('#logList').children) row.classList.toggle('f-hide', ACT_F === 'ok' ? !row.classList.contains('ok') : ACT_F === 'bad' ? !(row.classList.contains('warn') || row.classList.contains('error')) : false);
};
$('#btnCopyLog').onclick = async () => {
  const txt = LOGS.slice(-200).map((e) => `${new Date(e.t).toLocaleString('tr-TR')} [${e.level}] ${e.msg}`).join('\n');
  try { await navigator.clipboard.writeText(`Tuhalf Print ${STATUS.version || ''}\n` + txt); toast('Etkinlik kopyalandı'); } catch { toast('Kopyalanamadı', true); }
};
$('#btnAllLogs').onclick = () => $('#activity').classList.add('open');
// Toplu HepsiJet alimi
$('#btnBulkBuy').onclick = async () => {
  const ids = (KG.geliver || []).filter((x) => inRange(x.createdAt) && x.kind === 'offer' && x.pay && x.pay.paid && !x.pay.hold && x.hepsijet).map((x) => x.id);
  if (!ids.length) return;
  const b = $('#btnBulkBuy'); const label = b.textContent; b.disabled = true; b.textContent = 'Kontrol ediliyor…';
  try {
    const r = await window.api.geliverBuyBulk(ids);
    if (r.canceled) return;
    if (r.error) { toast(r.error, true); return; }
    toast(`${r.bought.length} etiket alındı (${money(r.total)})` + (r.failed.length ? ` · ${r.failed.length} hata, etkinliğe bakın` : '') + '. Fişler hazırlanıyor…', !!r.failed.length);
    for (let i = 0; i < 5 && r.bought.length; i++) {
      await new Promise((ok) => setTimeout(ok, 2500));
      const k2 = await window.api.kargo(true); if (!k2.error) { KG = k2; renderKargo(); }
      const ready = (KG.geliver || []).filter((x) => r.bought.includes(x.id) && x.pdfUrl).map((x) => x.id);
      if (ready.length === r.bought.length || (i === 4 && ready.length)) { const o = await window.api.labelsOpen('geliver', ready); if (o && o.error) toast(o.error, true); return; }
    }
  } finally { b.disabled = false; b.textContent = label; }
};

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
  // Coklu urun isaretleri icin siparis listesini arka planda yukle
  window.api.ordersDetail(false, 14).then((r) => { if (r && r.rows && !ORD.rows.length) { ORD = r; buildQty(); if (KG) renderKargo(); loadPlan(); loadSheets(); } }).catch(() => {});

  setInterval(renderStatus, 30000);
})();


// ================= Siparis detay paneli =================
let OD_NO = null;
async function openOrder(no) {
  no = Number(String(no).replace(/\D/g, ''));
  if (!no) return;
  OD_NO = no;
  $('#odNo').textContent = '#' + no; $('#odSub').textContent = 'Yükleniyor…';
  $('#odBody').innerHTML = '<div class="muted small">Yükleniyor…</div>'; $('#odPreview').innerHTML = '';
  $('#od').classList.add('open'); $('#odBg').classList.remove('hidden');
  const d = await window.api.orderInfo(no);
  if (OD_NO !== no) return;
  const row = (ORD.rows || []).find((o) => o.no === no) || d.order || {};
  const name = row.name || (d.cod && d.cod.ad) || (d.geliver && d.geliver.name) || '';
  const city = row.city || (d.cod && [d.cod.ilce, d.cod.il || d.cod.sehir].filter(Boolean).join(' / ')) || (d.geliver && [d.geliver.district, d.geliver.city].filter(Boolean).join(' / ')) || '';
  $('#odSub').textContent = [name, city, row.createdAt ? fmtD(row.createdAt) : ''].filter(Boolean).join(' · ') || 'Sipariş bilgisi Shopify listesinde yok';
  const sec = (title, body) => `<section class="od-sec"><h5>${title}</h5>${body}</section>`;
  const parts = [];
  // durum ozeti
  const ps = row.no ? printState({ ...row, local: d.files.length ? { files: d.files.map((f) => ({ ...f, printed: d.sheets.length > 0 && d.sheets.every((x) => x.printedAt) })) } : null, hold: d.hold }) : null;
  parts.push(`<div class="od-chips">${row.financial ? payCell(row) : ''}${ps ? `<div>${ps.html}</div>` : ''}${d.addrError ? '<span class="chip err">Adres hatası</span>' : ''}</div>`);
  if (d.hold) parts.push(`<div class="od-warn">⚠ ${esc(d.hold)} — baskı ve kargo bekletiliyor.</div>`);
  const nq = (row.items || []).reduce((a, i) => a + (Number(i.qty) || 1), 0) || d.files.reduce((a, f) => a + (Number(f.qty) || 1), 0);
  const odNote = row.note || noteOf(no);
  if (odNote) parts.push(`<div class="od-note"><b>Müşteri notu</b><span>${esc(odNote)}</span></div>`);
  if (nq > 1) parts.push(`<div class="od-multi"><b>${nq} ürünlü sipariş</b><span>Hepsini birlikte basıp aynı pakete koyun; tek fişle gönderilir.</span></div>`);
  // gonderim adresi
  const A = d.address;
  const adrTxt = A ? [A.name, [A.address1, A.address2].filter(Boolean).join(' '), [A.zip, A.city, A.province].filter(Boolean).join(' '), A.phone].filter(Boolean)
    : d.cod ? [d.cod.ad, d.cod.adres, [d.cod.ilce, d.cod.il || d.cod.sehir].filter(Boolean).join(' / '), d.cod.telefon].filter(Boolean)
    : d.geliver ? [d.geliver.name, d.geliver.address, [d.geliver.district, d.geliver.city].filter(Boolean).join(' / '), d.geliver.phone].filter(Boolean) : [];
  if (adrTxt.length) parts.push(sec('Gönderim adresi', `<div class="od-addr">${adrTxt.map((x, i) => i === 0 ? `<b>${esc(x)}</b>` : `<span>${esc(x)}</span>`).join('')}</div>`));
  // urunler
  if (row.items && row.items.length) parts.push(sec('Ürünler', `<ul class="od-items">${row.items.map((i) => `<li><b>${i.qty}×</b> ${esc(i.title)}${i.variant ? `<span class="muted"> / ${esc(i.variant)}</span>` : ''}</li>`).join('')}</ul>${row.total != null ? `<div class="od-total">${money(row.total)} · ${esc(row.shipping || '')}</div>` : ''}`));
  // baski dosyalari (buyuk onizleme solda)
  parts.push(sec(`Baskı dosyaları (${d.files.length})`, d.files.length ? `<div class="od-files">${d.files.map((f, i) => `<button class="od-file" data-odfocus="${i}"><b>${esc(f.size || '?')}</b> ${esc(f.color || '')}${f.qty > 1 ? ` · ${f.qty} adet` : ''}<span>${f.status === 'arranged' ? 'sayfaya dizildi' : 'dizilmeyi bekliyor'}</span></button>`).join('')}</div>` : '<div class="muted small">Bu siparişin dosyası inmemiş. “Dosyayı yeniden indir” ile deneyin.</div>'));
  const multi = d.files.length > 1;
  $('#odPreview').className = 'od-preview' + (multi ? ' is-multi' : '') + (d.files.length ? '' : ' empty');
  $('#odPreview').innerHTML = d.files.length ? d.files.map((f, i) => `<figure class="od-art" id="odArt${i}"><div class="od-sheet"><img src="${window.api.fileUrl(f.preview || f.thumb || f.path)}" alt="${esc(f.name)}" decoding="async"></div><figcaption><b>${esc(f.size || '?')} ${esc(f.color || '')}</b><span>${esc(f.name)}</span><button class="btn ghost small" data-show="${esc(f.path)}">Klasörde göster</button></figcaption></figure>`).join('')
    : '<div class="od-none"><b>Tasarım dosyası yok</b><span>Sipariş gelince ya da “Dosyayı yeniden indir” ile burada görünür.</span></div>';
  if (d.sheets.length) parts.push(sec('Baskı sayfaları', d.sheets.map((x) => `<div class="od-line"><span>${esc(dayLabel(x.folder))} · <b>${esc(x.sheet)}</b></span>${x.printedAt ? `<span class="chip printed">Basıldı ${fmtTime(x.printedAt)}${x.printedBy ? ' · ' + esc(x.printedBy) : ''}</span>` : '<span class="chip ready">Basılmadı</span>'}</div>`).join('')));
  // kargo
  const kargo = [];
  if (d.cod) kargo.push(`<div class="od-line"><span><b>Kapıda ödeme (DHL)</b> · ${money(d.cod.tutar)}</span>${d.cod.printedAt ? `<span class="chip printed">Fiş yazdırıldı ${fmtTime(d.cod.printedAt)}${d.cod.printedBy ? ' · ' + esc(d.cod.printedBy) : ''}</span>` : d.cod.etiketli ? '<span class="chip ready">DHL\'e kayıtlı</span>' : '<span class="chip unprinted">Fiş yazdırılmadı</span>'}</div>`);
  if (d.geliver) kargo.push(`<div class="od-line"><span><b>Geliver</b> · ${esc(d.geliver.statusText || '')}${d.geliver.tracking ? ' · ' + esc(d.geliver.tracking) : ''}</span>${d.geliver.printedAt ? `<span class="chip printed">Fiş yazdırıldı ${fmtTime(d.geliver.printedAt)}</span>` : ''}</div>`);
  if (d.addrError) kargo.push(`<div class="od-warn">Adres hatası: ${esc(d.addrError.error || d.addrError.message || '')}</div>`);
  parts.push(sec('Kargo', kargo.join('') || '<div class="muted small">Kargo kaydı bulunamadı.</div>'));
  // islemler
  const acts = [];
  if (d.files.length) acts.push(`<button class="btn small" data-show="${esc(d.files[0].path)}">Klasörde göster</button>`);
  acts.push(`<button class="btn small" data-odredo="${no}">Dosyayı yeniden indir</button>`);
  if (d.cod && !d.cod.sorun && (d.cod.etiketli || d.cod.gonderim !== 'FULFILLED')) acts.push(`<button class="btn small" data-odlabel="cod:${esc(d.cod.id)}">${d.cod.etiketli ? 'Fişi tekrar yazdır' : 'Kargo fişi yazdır'}</button>`);
  if (d.geliver && d.geliver.pdfUrl) acts.push(`<button class="btn small" data-odlabel="geliver:${esc(d.geliver.id)}">Kargo fişi yazdır</button>`);
  if (d.addrError) acts.push('<button class="btn small" data-view="adres" data-odclose="1">Adres hatalarına git</button>');
  if (d.admin) acts.push(`<button class="btn small ghost" data-url="${esc(d.admin)}">Shopify'da aç</button>`);
  parts.push(`<div class="od-acts">${acts.join('')}</div>`);
  $('#odBody').innerHTML = parts.join('');
}
function closeOrder() { OD_NO = null; $('#od').classList.remove('open'); $('#odBg').classList.add('hidden'); }
$('#odClose').onclick = closeOrder; $('#odBg').onclick = closeOrder;
$('#odBody').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-odredo],[data-odlabel],[data-odclose],[data-odfocus]');
  if (!b) return;
  if (b.dataset.odfocus) { const el = $('#odArt' + b.dataset.odfocus); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (b.dataset.odclose) { closeOrder(); return; }
  if (b.dataset.odredo) {
    b.disabled = true; b.textContent = 'İndiriliyor…';
    const r = await window.api.redownloadOne(b.dataset.odredo);
    toast(r.error ? r.error : r.busy ? 'Kontrol sürüyor, birazdan tekrar deneyin' : r.files && r.files.length ? `${r.files.length} dosya indi` : 'Dosya zaten var ya da baskı linki yok' + (r.pending && r.pending.length ? ' · ' + r.pending.join(', ') : ''), !!r.error);
    openOrder(b.dataset.odredo); refreshAll(); return;
  }
  if (b.dataset.odlabel) {
    const [kind, id] = b.dataset.odlabel.split(':');
    const r = await window.api.labelsOpen(kind, [kind === 'cod' ? id : id]);
    if (r && r.error) toast(r.error, true);
  }
});
// tablolardan ac: goz simgesi ya da satira tikla
document.addEventListener('click', (e) => {
  const eye = e.target.closest('[data-od]');
  if (eye) { e.stopPropagation(); openOrder(eye.dataset.od); return; }
  if (e.target.closest('button, a, input, select, label, .ord-file, [data-path], [data-url], [data-show]')) return;
  const tr = e.target.closest('#ordRows tr, #kargoRows tr, #adresRows tr');
  if (!tr) return;
  const eyeB = tr.querySelector('[data-od]');
  if (eyeB) { openOrder(eyeB.dataset.od); return; }
  const m = (tr.querySelector('.no') || {}).textContent?.match(/#(\d{3,6})/);
  if (m) openOrder(m[1]);
});

// ================= Hizli arama (Ctrl+K) =================
const PAGES = [['home', 'Bugün'], ['plan', 'Baskı sırası'], ['sheets', 'Hazır sayfalar'], ['orders', 'Siparişler'], ['kargo', 'Kargo fişleri'], ['adres', 'Adres hataları']];
let PAL = [], PAL_I = 0;
async function openPalette() {
  $('#palBg').classList.remove('hidden'); $('#palInput').value = ''; $('#palInput').focus();
  if (!ORD.rows || !ORD.rows.length) { try { ORD = await window.api.ordersDetail(false, 30); buildQty(); } catch { /* */ } }
  renderPalette();
}
function closePalette() { $('#palBg').classList.add('hidden'); }
function renderPalette() {
  const q = $('#palInput').value.trim().toLocaleLowerCase('tr');
  const items = [];
  for (const [v, t] of PAGES) if (!q || t.toLocaleLowerCase('tr').includes(q)) items.push({ kind: 'page', v, t, s: 'Sayfaya git' });
  const seen = new Set();
  const add = (no, t, s) => { if (seen.has(no)) return; seen.add(no); items.push({ kind: 'order', no, t, s }); };
  if (q) {
    for (const o of ORD.rows || []) {
      const hay = [String(o.no), o.name, o.city, ...(o.gateways || [])].join(' ').toLocaleLowerCase('tr');
      if (hay.includes(q.replace('#', ''))) add(o.no, `#${o.no} ${o.name || ''}`, [o.city, o.createdAt ? fmtD(o.createdAt) : '', o.total != null ? money(o.total) : ''].filter(Boolean).join(' · '));
      if (items.length > 40) break;
    }
    for (const r of (KG && KG.cod) || []) if ([r.no, r.ad, r.sehir].join(' ').toLocaleLowerCase('tr').includes(q.replace('#', ''))) add(Number(r.no), `#${r.no} ${r.ad || ''}`, 'Kapıda ödeme · ' + (r.sehir || ''));
    for (const r of (KG && KG.geliver) || []) if ([r.no, r.name, r.city].join(' ').toLocaleLowerCase('tr').includes(q.replace('#', ''))) add(Number(r.no), `#${r.no} ${r.name || ''}`, 'Geliver · ' + (r.city || ''));
    if (/^\d{3,}$/.test(q.replace('#', '')) && !seen.has(Number(q.replace('#', '')))) add(Number(q.replace('#', '')), '#' + q.replace('#', ''), 'Siparişi aç');
  }
  PAL = items.slice(0, 30); PAL_I = Math.min(PAL_I, Math.max(0, PAL.length - 1));
  $('#palList').innerHTML = PAL.map((it, i) => `<div class="pal-item ${i === PAL_I ? 'on' : ''}" data-pal="${i}"><span class="pal-k k-${it.kind}">${it.kind === 'page' ? '→' : '#'}</span><div><b>${esc(it.t)}</b><small>${esc(it.s)}</small></div></div>`).join('') || '<div class="muted small" style="padding:14px">Sonuç yok</div>';
}
function palGo(i) {
  const it = PAL[i]; if (!it) return;
  closePalette();
  if (it.kind === 'page') setView(it.v); else openOrder(it.no);
}
$('#palInput').oninput = () => { PAL_I = 0; renderPalette(); };
$('#palInput').onkeydown = (e) => {
  if (e.key === 'ArrowDown') { PAL_I = Math.min(PAL.length - 1, PAL_I + 1); renderPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { PAL_I = Math.max(0, PAL_I - 1); renderPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') { palGo(PAL_I); e.preventDefault(); }
  else if (e.key === 'Escape') { closePalette(); e.preventDefault(); }
};
$('#palList').onclick = (e) => { const it = e.target.closest('[data-pal]'); if (it) palGo(Number(it.dataset.pal)); };
$('#palBg').onclick = (e) => { if (e.target.id === 'palBg') closePalette(); };
$('#btnPal').onclick = openPalette;

// ================= Klavye kisayollari =================
document.addEventListener('keydown', (e) => {
  if (!$('#askBg').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') { if (!$('#palBg').classList.contains('hidden')) closePalette(); else if ($('#od').classList.contains('open')) closeOrder(); return; }
  if ((e.ctrlKey || e.metaKey) && /^[1-6]$/.test(e.key)) { e.preventDefault(); setView(PAGES[Number(e.key) - 1][0]); return; }
  if (e.key === 'F5') {
    e.preventDefault();
    if (VIEW === 'orders') $('#btnOrdRefresh').click();
    else if (VIEW === 'kargo') $('#btnKargoRefresh').click();
    else if (VIEW === 'adres') $('#btnAdresRefresh').click();
    else { refreshAll(); loadToday(true); toast('Yenilendi'); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 'p' && VIEW === 'kargo') { e.preventDefault(); if (!$('#btnKargoPrint').disabled) $('#btnKargoPrint').click(); }
});
