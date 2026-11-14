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
    out.push({ src: c.toDataURL('image/png'), wMm, hMm, key: n === 1 ? item.key : null, title: item.title + (doc.numPages > 1 ? ` (${n}/${doc.numPages})` : '') });
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
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w}mm ${h}mm;margin:0}*{margin:0;padding:0}html,body{background:#fff}
img{display:block;width:${w}mm;height:${h}mm;object-fit:contain;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}</style></head><body>${pages.map((p) => `<img src="${p.src}">`).join('')}</body></html>`;
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
        parts.push(...pages.map((p) => `<div class="lbl"><div class="t">${esc(p.title)}</div><img src="${p.src}" style="aspect-ratio:${p.wMm}/${p.hMm}"></div>`));
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
    if (!same) msg(`Bu fişler ${w}×${h} mm. 100×100 kağıda yazdırırken küçültülüp sığdırılır; etiket ruloda ${w}×${h} ise “Kağıt”tan fişin ölçüsünü seçin.`, 'info');
  }
}
$('#btnPrint').onclick = () => doPrint(true);
$('#btnDialog').onclick = () => doPrint(false);
$('#btnClose').onclick = () => window.close();
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
main().catch((e) => msg('Hata: ' + esc(e.message || e)));
