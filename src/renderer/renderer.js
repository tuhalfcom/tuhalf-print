'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—');
let CFG = null, STATUS = {}, SHEETS = [];

const ICON_EMPTY = '<svg viewBox="0 0 24 24"><path d="M3 7h18M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>';

function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' error' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}

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
  $('#btnCheck').disabled = !!STATUS.running;

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
    : f.partial ? f.partial : f.waiting ? 'Bekliyor · sonraki dizilimde' : f.status === 'pending' ? 'Sırada' : 'Dizildi';
  const chip = f.printed
    ? `<span class="chip printed">Basıldı${f.printedAt ? ' ' + fmtTime(f.printedAt) : ''}</span>`
    : '<span class="chip unprinted">Basılmadı</span>';
  return `<div class="order ${f.status}${f.printed ? ' is-printed' : ''}" data-path="${esc(f.path)}" title="Klasörde göster">
    <div class="thumb" ${img}></div>
    <div>
      <div class="order-file">${esc(f.name)}</div>
      <div class="order-meta">${i.size ? `<span class="tag">${esc(i.size)}</span>` : ''}${i.color ? `<span class="tag">${esc(i.color)}</span>` : ''}${i.qty > 1 ? `<span class="tag">${i.qty} adet</span>` : ''}</div>
    </div>
    <div class="order-right">${chip}<span class="muted small">${esc(where)}</span></div>
  </div>`;
}

async function loadOrders() {
  const r = await window.api.orders();
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
  $('#ordersSummary').textContent = total ? `${total} dosya · ${unprinted} basılmadı · son 7 gün` : 'Yeni siparişler otomatik iner';
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
  $('#planSummary').textContent = p.count
    ? `${p.placed} baskı → ${p.sheets.length} sayfa` + (p.waiting.length ? ` · ${p.waiting.length} bekliyor` : '')
    : 'Dizilecek dosya yok';
  $('#btnBuild').disabled = !p.sheets.length || !!STATUS.job;
  $('#btnBuild').lastChild.textContent = p.sheets.length ? `Sayfaları hazırla (${p.sheets.length})` : 'Sayfaları hazırla';
  $('#rollInfo').textContent = CFG ? `Sayfa ${CFG.print.rollWidthMm} x ${CFG.print.maxLengthMm} mm · ara ${CFG.print.gapMm} mm` : '';
  const wb = $('#waitingBox');
  const showWait = p.waiting.length || FORCE;
  wb.classList.toggle('hidden', !showWait);
  $('#forceAll').checked = FORCE;
  $('#waitingTitle').textContent = FORCE ? 'Bekleyenler de diziliyor' : `Bekleyen (${p.waiting.length})`;
  $('#waitingList').innerHTML = p.waiting.map((n) => `<span class="tag">${esc(n)}</span>`).join('') || (FORCE ? '<span class="muted small">Tüm tasarımlar sayfalara yerleşti.</span>' : '');
  let html = p.sheets.map((s, n) => {
    const designs = s.items.filter((i) => !i.card).length;
    return `<div class="sheet-card">
      ${paperHtml(s, s.items)}
      <div class="sheet-info"><b>Sayfa ${n + 1}</b><span class="muted small">${designs} baskı${s.cards ? ` · ${s.cards} kart` : ''}</span></div>
    </div>`;
  }).join('');
  if (p.skipped.length) html += `<div class="sheet-card"><b>Ruloya sığmayan</b><span class="muted small">${p.skipped.map(esc).join('<br>')}</span></div>`;
  if (p.bad.length) html += `<div class="sheet-card"><b>Adı okunamayan</b><span class="muted small">${p.bad.map(esc).join('<br>')}</span></div>`;
  $('#plan').innerHTML = html || `<p class="muted small">${p.waiting.length ? 'Tam satır oluşturacak kadar tasarım yok. Yeni siparişler geldikçe dizilir.' : 'Yeni dosyalar indikçe yerleşim burada oluşur.'}</p>`;
}

// ---------- Hazir sayfalar ----------
async function loadSheets() {
  SHEETS = await window.api.sheets();
  const unprinted = SHEETS.filter((s) => !s.printedAt);
  $('#btnPrintAll').disabled = !unprinted.length || !!STATUS.job;
  $('#btnPrintAll').lastChild.textContent = unprinted.length ? `Basılmamışları bas (${unprinted.length})` : 'Basılmamışları bas';
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
        <button class="btn ghost small" data-show="${esc(s.path)}" title="Klasörde göster">PSD</button>
        <button class="btn ghost small${s.printedAt ? ' done' : ''}" data-mark="${esc(s.path)}" data-on="${s.printedAt ? '' : '1'}" title="${s.printedAt ? 'Basılmadı olarak işaretle' : 'Photoshop\'tan elle bastıysanız işaretleyin'}">${s.printedAt ? '✓' : 'Basıldı'}</button>
      </div>
    </div>`;
  }).join('') || `<div class="empty">${ICON_EMPTY}<div>Hazır sayfa yok</div></div>`;
}

const refreshAll = () => Promise.all([loadOrders(), loadPlan(), loadSheets()]).catch((e) => toast(e.message, true));

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
  const out = { print: {}, card: {} };
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
function setPsFound(p) { $('#psFound').textContent = p ? `Bulundu: ${p}` : 'Photoshop bulunamadı — konumunu seçin.'; }
function openDrawer(open) { $('#drawer').classList.toggle('open', open); $('#drawerBg').classList.toggle('hidden', !open); }

// ---------- Olaylar ----------
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-open],[data-print],[data-show],[data-pick],[data-mark],.order');
  if (!t) return;
  if (t.dataset.mark) { await window.api.markPrinted(t.dataset.mark, !!t.dataset.on); return refreshAll(); }
  if (t.dataset.open) return window.api.openPath(t.dataset.open);
  if (t.dataset.show) return window.api.showItem(t.dataset.show);
  if (t.dataset.pick) {
    const p = await window.api.pick(t.dataset.pick);
    if (p) $(`[name="${t.dataset.target}"]`).value = p;
    return;
  }
  if (t.dataset.print) return doPrint([t.dataset.print]);
  if (t.classList.contains('order')) return window.api.showItem(t.dataset.path);
});

async function doPrint(paths) {
  const r = await window.api.print(paths);
  if (r.error) return toast(r.error, true);
  const ok = r.files.filter((f) => f.ok).length;
  toast(ok === paths.length ? `${ok} sayfa yazıcıya gönderildi` : `${ok}/${paths.length} sayfa gönderildi, hatalar etkinlikte`, ok !== paths.length);
}

$('#btnCheck').onclick = async () => { const r = await window.api.checkNow(); if (r && r.error) toast(r.error, true); };
$('#btnBuild').onclick = async () => {
  const r = await window.api.build(FORCE);
  if (r.error) toast(r.error, true); else toast(`${(r.sheets || []).filter((s) => s.ok).length} sayfa hazır · Photoshop'ta kontrol edip Print'e basın`);
  FORCE = false;
};
$('#forceAll').onchange = (e) => { FORCE = e.target.checked; loadPlan(); };
$('#btnPrintAll').onclick = () => doPrint(SHEETS.filter((s) => !s.printedAt).map((s) => s.path).reverse());
$('#btnSettings').onclick = () => openDrawer(true);
$('#btnCloseSettings').onclick = $('#drawerBg').onclick = () => openDrawer(false);
$('#btnSave').onclick = async () => {
  const r = await window.api.saveConfig(readSettings());
  CFG = r.config; fillSettings(CFG); setPsFound(r.photoshop); renderCard(); openDrawer(false); toast('Ayarlar kaydedildi');
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
window.api.on('refresh', refreshAll);

(async () => {
  const d = await window.api.init();
  CFG = d.config; STATUS = d.status;
  document.body.classList.toggle('mac', d.status.platform === 'darwin');
  $('#ver').textContent = `Baskı merkezi · v${d.status.version}`;
  fillSettings(CFG); setPsFound(d.photoshop); renderCard();
  UPD = d.update || {}; renderUpdate();
  d.logs.forEach(addLog);
  renderStatus();
  await refreshAll();
  if (!CFG.shop) openDrawer(true);
  setInterval(renderStatus, 30000);
})();
