'use strict';
/* Kargo fisi onizleme: Geliver PDF etiketlerini resme cevirir, DHL fislerini oldugu gibi gosterir,
   secilen yaziciya 100x100 mm basar. */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
let JOB = null;
const PAGES = []; // { src, wMm, hMm, key }
let HTMLJOB = null; // { html, keys, count }

function msg(html, cls = '') { $('#msgs').insertAdjacentHTML('beforeend', `<div class="msg ${cls}">${html}</div>`); }
function b64ToBytes(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

// Fisin etrafindaki bos beyaz alani kirp (Geliver fisleri 100x130/150 gelir, alti genelde bos).
// Boylece 100x100 etikete sigdirilirken icerik olabildigince buyuk basilir.
function trimCanvas(c, pxPerMm) {
  const { width: W, height: H } = c;
  const d = c.getContext('2d').getImageData(0, 0, W, H).data;
  const dark = (x, y) => { const i = (y * W + x) * 4; return d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235; };
  let top = 0, bot = H - 1, left = 0, right = W - 1;
  const rowHas = (y) => { for (let x = 0; x < W; x += 2) if (dark(x, y)) return true; return false; };
  const colHas = (x) => { for (let y = top; y <= bot; y += 2) if (dark(x, y)) return true; return false; };
  while (top < bot && !rowHas(top)) top++;
  while (bot > top && !rowHas(bot)) bot--;
  while (left < right && !colHas(left)) left++;
  while (right > left && !colHas(right)) right--;
  const pad = Math.round(1.5 * pxPerMm);
  top = Math.max(0, top - pad); left = Math.max(0, left - pad); bot = Math.min(H - 1, bot + pad); right = Math.min(W - 1, right + pad);
  const w = right - left + 1, h = bot - top + 1;
  if (w < 20 || h < 20) return { canvas: c, wMm: W / pxPerMm, hMm: H / pxPerMm };
  const o = document.createElement('canvas'); o.width = w; o.height = h;
  const x = o.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(c, left, top, w, h, 0, 0, w, h);
  return { canvas: o, wMm: w / pxPerMm, hMm: h / pxPerMm };
}

async function renderPdf(item) {
  const doc = await pdfjsLib.getDocument({ data: b64ToBytes(item.pdf) }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const wMm = v1.width * 25.4 / 72, hMm = v1.height * 25.4 / 72;
    const scale = (wMm / 25.4 * 300) / v1.width; // ~300 dpi
    const v = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: v }).promise;
    const t = trimCanvas(c, c.width / wMm);
    out.push({ src: t.canvas.toDataURL('image/png'), full: c.toDataURL('image/png'), wMm, hMm, cwMm: t.wMm, chMm: t.hMm, key: n === 1 ? item.key : null, title: item.title + (doc.numPages > 1 ? ` (${n}/${doc.numPages})` : '') });
  }
  return out;
}

// Kagit: '100' = 100x100 kagida sigdir, 'own' = fisin kendi olcusu
function paperSize() {
  const p = PAGES[0];
  return $('#paper').value === 'own' ? { w: p.wMm, h: p.hMm } : { w: 100, h: 100 };
}
function printHtmlFromPages(pages) {
  const { w, h } = paperSize();
  const own = $('#paper').value === 'own';
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w}mm ${h}mm;margin:0}*{margin:0;padding:0}html,body{background:#fff}
img{display:block;width:${w}mm;height:${h}mm;object-fit:contain;object-position:center;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}</style></head><body>${pages.map((p) => `<img src="${own ? (p.full || p.src) : p.src}">`).join('')}</body></html>`;
}

async function doPrint(silent) {
  const printer = $('#printer').value;
  const btns = [$('#btnPrint'), $('#btnDialog')]; btns.forEach((b) => { b.disabled = true; });
  $('#btnPrint').textContent = 'Gönderiliyor…';
  let r;
  if (HTMLJOB) r = await window.lapi.print({ printer, html: HTMLJOB.html, keys: HTMLJOB.keys, count: HTMLJOB.count, silent, wMm: 100, hMm: 100 });
  else { const ps = paperSize(); r = await window.lapi.print({ printer, paper: $('#paper').value, html: printHtmlFromPages(PAGES), keys: PAGES.map((p) => p.key).filter(Boolean), count: PAGES.length, silent, wMm: ps.w, hMm: ps.h }); }
  $('#btnPrint').textContent = 'Yazdır'; btns.forEach((b) => { b.disabled = false; });
  $('#msgs').querySelectorAll('.msg.ok, .msg.perr').forEach((m) => m.remove());
  if (r.error) msg(`<b>Yazdırılamadı:</b> ${esc(r.error)}<br>Yazıcının açık ve doğru seçili olduğunu kontrol edin. Olmazsa “Yazdırma penceresiyle…” deneyin.`, 'perr');
  else msg(`✓ Yazıcıya gönderildi: <b>${esc(printer || 'varsayılan yazıcı')}</b>`, 'ok');
}

async function main() {
  JOB = await window.lapi.job();
  if (!JOB) { $('#list').innerHTML = '<div class="loading">Gösterilecek fiş yok.</div>'; return; }
  document.title = JOB.title + ' — önizleme'; $('#title').textContent = JOB.title;
  if (JOB.note) msg(esc(JOB.note), 'info');
  if (JOB.errors && JOB.errors.length) msg(`<b>${JOB.errors.length} fiş hazırlanamadı:</b><ul>${JOB.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`);
  const pr = await window.lapi.printers();
  $('#printer').innerHTML = (pr.list.length ? '' : '<option value="">Yazıcı bulunamadı</option>') + pr.list.map((p) => `<option value="${esc(p.name)}">${esc(p.label)}${p.isDefault ? ' (varsayılan)' : ''}</option>`).join('');
  $('#printer').value = pr.selected || '';
  const parts = [];
  try {
    for (const it of JOB.items) {
      if (it.pdf) {
        const pages = await renderPdf(it);
        PAGES.push(...pages);
        parts.push(...pages.map((p) => `<div class="lbl"><div class="t">${esc(p.title)}</div><div class="sheet100"><img src="${p.src}"></div></div>`));
      } else if (it.html) {
        HTMLJOB = { html: it.html, keys: it.keys || (it.key ? [it.key] : []), count: it.count || 1 };
        parts.push(`<div class="lbl"><div class="t">${esc(it.title)}</div><iframe sandbox="" id="frame"></iframe></div>`);
      }
    }
  } catch (e) { msg('Fiş gösterilemedi: ' + esc(e.message || e)); }
  $('#list').innerHTML = parts.join('') || '<div class="loading">Gösterilecek fiş yok.</div>';
  const f = $('#frame');
  if (f && HTMLJOB) f.srcdoc = HTMLJOB.html.replace(/\$\{YAZICI\}/g, esc($('#printer').value || 'Varsayılan yazıcı'));
  const ready = PAGES.length || HTMLJOB;
  $('#btnPrint').disabled = !ready; $('#btnDialog').disabled = !ready;
  if (PAGES.length && PAGES.some((p) => Math.abs(p.wMm - PAGES[0].wMm) > 1 || Math.abs(p.hMm - PAGES[0].hMm) > 1)) msg('Fişlerin ölçüleri farklı; hepsi ilk fişin ölçüsünde yazdırılacak.', 'info');
  if (PAGES.length) {
    const w = Math.round(PAGES[0].wMm), h = Math.round(PAGES[0].hMm);
    const same = Math.abs(w - 100) < 2 && Math.abs(h - 100) < 2;
    $('#paper').innerHTML = `<option value="100">100 × 100 mm${same ? '' : ' (sığdır)'}</option>` + (same ? '' : `<option value="own">${w} × ${h} mm (fişin ölçüsü)</option>`);
    $('#paper').value = !same && pr.paper === 'own' ? 'own' : '100';
    $('#paper').classList.toggle('hidden', same); $('#paperLbl').classList.toggle('hidden', same);
    if (!same) {
      const p0 = PAGES[0], k = Math.min(1, 100 / p0.cwMm, 100 / p0.chMm);
      msg(`Geliver fişi ${w}×${h} mm geliyor. Boş kenarları kırpıldı (içerik ${Math.round(p0.cwMm)}×${Math.round(p0.chMm)} mm) ve 100×100 etikete %${Math.round(k * 100)} ölçekte ortalanarak basılır. Etiket ruloda ${w}×${h} ise “Kağıt”tan fişin ölçüsünü seçin.`, 'info');
      msg('Yazıcının kendi ayarında (Denetim Masası › Aygıtlar ve Yazıcılar › Yazdırma tercihleri) kağıt boyutu 100×100 mm olmalı; orada 100×150 kalırsa altta boşluk olur.', 'info');
    }
  }
}
$('#btnPrint').onclick = () => doPrint(true);
$('#btnDialog').onclick = () => doPrint(false);
$('#btnClose').onclick = () => window.close();
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
main().catch((e) => msg('Hata: ' + esc(e.message || e)));
