// ---- Yerlesim motoru (ES3 uyumlu: Photoshop ExtendScript icin) ----
// Birimler mm. Guillotine (kesilebilir) yerlesim, siparis sirasini koruyan first-fit.
function preferredRotated(w, h, usableW) {
    // Her ebat icin rulo genisligine en verimli yonu sec (ogeyi basina dusen uzunluk en az olan)
    function perItem(a, b) { var n = Math.floor(usableW / a); return n < 1 ? 1e9 : b / n; }
    var p = perItem(w, h), r = perItem(h, w);
    return r < p;
}

function newSheet(cfg) {
    var g = cfg.gap, m = cfg.margin;
    return { items: [], free: [{ x: m, y: m, w: cfg.width - 2 * m + g, h: cfg.maxLength - 2 * m + g }] };
}

function tryPlace(sheet, it, cfg) {
    var g = cfg.gap, usableW = cfg.width - 2 * cfg.margin;
    var prefRot = preferredRotated(it.w, it.h, usableW);
    var curMax = 0;
    for (var q = 0; q < sheet.items.length; q++) { var pi = sheet.items[q]; if (pi.y + pi.h + g > curMax) curMax = pi.y + pi.h + g; }
    // Aday puani: [bosluk doldurma mu?, tercih edilen yon mu?, alt kenar, x]
    var best = null, bestKey = null;
    var orients = [false, true];
    for (var o = 0; o < 2; o++) {
        var rot = orients[o];
        if (rot && it.lockPortrait) continue;   // 30x42 / 50x70 hep dik
        var iw = (rot ? it.h : it.w) + g, ih = (rot ? it.w : it.h) + g;
        for (var i = 0; i < sheet.free.length; i++) {
            var f = sheet.free[i];
            if (iw <= f.w + 1e-6 && ih <= f.h + 1e-6) {
                var bottom = f.y + ih;
                var hole = bottom <= curMax + 1e-6 ? 0 : 1;
                var pref = (rot === prefRot) ? 0 : 1;
                var key = [hole, pref, bottom, f.x];
                var better = false;
                if (!bestKey) better = true;
                else for (var k = 0; k < 4; k++) { if (key[k] < bestKey[k] - 1e-6) { better = true; break; } if (key[k] > bestKey[k] + 1e-6) break; }
                if (better) { bestKey = key; best = { i: i, rot: rot, iw: iw, ih: ih }; }
            }
        }
    }
    if (!best) return false;
    var fr = sheet.free[best.i];
    sheet.free.splice(best.i, 1);
    // Yatay bolme: sag parca (oge yuksekliginde), alt parca (tam genislik) -> satir duzeni, kolay kesim
    if (fr.w - best.iw > 1e-6) sheet.free.push({ x: fr.x + best.iw, y: fr.y, w: fr.w - best.iw, h: best.ih });
    if (fr.h - best.ih > 1e-6) sheet.free.push({ x: fr.x, y: fr.y + best.ih, w: fr.w, h: fr.h - best.ih });
    sheet.items.push({ item: it, x: fr.x, y: fr.y, rotated: best.rot, w: best.iw - g, h: best.ih - g });
    return true;
}

function fits(it, cfg) {
    var uw = cfg.width - 2 * cfg.margin, ul = cfg.maxLength - 2 * cfg.margin;
    return (it.w <= uw && it.h <= ul) || (!it.lockPortrait && it.h <= uw && it.w <= ul);
}

// items: siparis sirasina gore sirali (eskiden yeniye). Her oge en erken sayfaya girer.
function packAll(items, cfg) {
    var sheets = [], skipped = [];
    for (var k = 0; k < items.length; k++) {
        var it = items[k];
        if (!fits(it, cfg)) { skipped.push(it); continue; }
        var placed = false;
        for (var s = 0; s < sheets.length && !placed; s++) placed = tryPlace(sheets[s], it, cfg);
        if (!placed) { var sh = newSheet(cfg); tryPlace(sh, it, cfg); sheets.push(sh); }
    }
    for (var t = 0; t < sheets.length; t++) {
        var maxB = 0;
        for (var j = 0; j < sheets[t].items.length; j++) { var p = sheets[t].items[j]; if (p.y + p.h > maxB) maxB = p.y + p.h; }
        sheets[t].length = cfg.fixedLength ? cfg.maxLength : Math.ceil(maxB + cfg.margin);
    }
    return { sheets: sheets, skipped: skipped };
}
