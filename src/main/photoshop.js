'use strict';
// Photoshop koprusu: is dosyasi (json) + jsx yazar, Photoshop'u calistirir, sonucu bekler.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function findPhotoshop(custom) {
  if (custom && fs.existsSync(custom)) return custom;
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const r of roots) {
      const base = path.join(r, 'Adobe');
      if (!fs.existsSync(base)) continue;
      const dirs = fs.readdirSync(base).filter((d) => /^Adobe Photoshop/i.test(d)).sort().reverse();
      for (const d of dirs) { const exe = path.join(base, d, 'Photoshop.exe'); if (fs.existsSync(exe)) return exe; }
    }
  } else if (process.platform === 'darwin') {
    const dirs = fs.readdirSync('/Applications').filter((d) => /^Adobe Photoshop/i.test(d)).sort().reverse();
    for (const d of dirs) {
      const dir = path.join('/Applications', d);
      const app = fs.statSync(dir).isDirectory() && d.endsWith('.app') ? dir
        : (fs.readdirSync(dir).filter((x) => /^Adobe Photoshop.*\.app$/i.test(x)).map((x) => path.join(dir, x))[0]);
      if (app && fs.existsSync(app)) return app;
    }
  }
  return null;
}

function jsxString(s) { return JSON.stringify(String(s)); }

/**
 * @param template  jsx sablon dosyasi (build.jsx / print.jsx)
 * @param job       is verisi (json'a yazilir)
 * @param onProgress (done, total, label) => void
 */
async function runJob(psPath, template, job, onProgress, timeoutMin = 90) {
  const exe = findPhotoshop(psPath);
  if (!exe) throw new Error('Photoshop bulunamadı. Ayarlardan Photoshop konumunu seçin.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuhalf-print-'));
  const jobPath = path.join(dir, 'job.json');
  const resultPath = path.join(dir, 'result.json');
  const progressPath = path.join(dir, 'progress.txt');
  fs.writeFileSync(jobPath, JSON.stringify({ ...job, resultPath, progressPath }), 'utf8');
  const body = fs.readFileSync(template, 'utf8');
  const jsxPath = path.join(dir, 'tuhalf-job.jsx');
  fs.writeFileSync(jsxPath, '\uFEFF#target photoshop\nvar __JOB = ' + jsxString(jobPath) + ';\n' + body, 'utf8');

  if (process.platform === 'darwin') spawn('open', ['-a', exe, jsxPath], { detached: true, stdio: 'ignore' }).unref();
  else spawn(exe, [jsxPath], { detached: true, stdio: 'ignore' }).unref();

  const started = Date.now();
  let lastProg = '';
  while (Date.now() - started < timeoutMin * 60000) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const p = fs.readFileSync(progressPath, 'utf8').trim();
      if (p && p !== lastProg) { lastProg = p; const [d, t, ...l] = p.split('|'); onProgress && onProgress(+d, +t, l.join('|')); }
    } catch { /* henuz yok */ }
    if (fs.existsSync(resultPath)) {
      await new Promise((r) => setTimeout(r, 300));
      const res = JSON.parse(fs.readFileSync(resultPath, 'utf8').replace(/^\uFEFF/, ''));
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
      return res;
    }
  }
  throw new Error('Photoshop zamanında yanıt vermedi. Photoshop\'ta açık bir uyarı penceresi olabilir.');
}

module.exports = { findPhotoshop, runJob };
