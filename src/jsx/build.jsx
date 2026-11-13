// Tuhalf Print - PSD sayfa olusturucu. __JOB degiskeni uygulama tarafindan eklenir.
(function () {
    function readText(p) { var f = File(p); f.encoding = 'UTF-8'; f.open('r'); var t = f.read(); f.close(); return t.replace(/^\uFEFF/, ''); }
    function writeText(p, s) { var f = File(p); f.encoding = 'UTF-8'; f.open('w'); f.write(s); f.close(); }
    function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"'; }

    var job = eval('(' + readText(__JOB) + ')');
    var results = [], fatal = null;
    var DPI = job.dpi;
    function px(mm) { return Math.round(mm * DPI / 25.4); }

    var oldUnits = app.preferences.rulerUnits, oldDialogs = app.displayDialogs;
    app.preferences.rulerUnits = Units.PIXELS;
    app.displayDialogs = DialogModes.NO;
    var white = new SolidColor(); white.rgb.red = 255; white.rgb.green = 255; white.rgb.blue = 255;
    app.backgroundColor = white;

    function prepareSource(it) {
        var doc = open(File(it.src));
        if (doc.mode !== DocumentMode.RGB) doc.changeMode(ChangeMode.RGB);
        if (doc.bitsPerChannel !== BitsPerChannelType.EIGHT) doc.bitsPerChannel = BitsPerChannelType.EIGHT;
        doc.flatten();
        var tw = px(it.wMm), th = px(it.hMm);              // dik hedef
        var sw = doc.width.as('px'), sh = doc.height.as('px');
        var sc = Math.max(tw / sw, th / sh);               // kapla + ortadan kirp
        var nw = Math.max(tw, Math.round(sw * sc)), nh = Math.max(th, Math.round(sh * sc));
        var method = ResampleMethod.PRESERVEDETAILS || ResampleMethod.BICUBIC;
        doc.resizeImage(UnitValue(nw, 'px'), UnitValue(nh, 'px'), DPI, method);
        if (nw !== tw || nh !== th) doc.resizeCanvas(UnitValue(tw, 'px'), UnitValue(th, 'px'), AnchorPosition.MIDDLECENTER);
        if (it.rotated) doc.rotateCanvas(90);
        return doc;
    }

    // Ayni kaynak (or. tesekkur karti) tekrar tekrar acilmasin: hazirlanmis kopyayi sakla
    var cache = {};
    function sourceFor(it) {
        if (!it.card) return { doc: prepareSource(it), keep: false };
        var key = it.src + '|' + it.wMm + '|' + it.hMm + '|' + (it.rotated ? 1 : 0);
        if (!cache[key]) cache[key] = prepareSource(it);
        return { doc: cache[key], keep: true };
    }

    var total = 0, doneCount = 0;
    for (var a = 0; a < job.sheets.length; a++) total += job.sheets[a].items.length;

    try {
        for (var s = 0; s < job.sheets.length; s++) {
            var sh = job.sheets[s], errs = [];
            var sheet = app.documents.add(UnitValue(px(sh.widthMm), 'px'), UnitValue(px(sh.lengthMm), 'px'), DPI, sh.title,
                NewDocumentMode.RGB, DocumentFill.WHITE);
            for (var k = 0; k < sh.items.length; k++) {
                var it = sh.items[k];
                writeText(job.progressPath, doneCount + '|' + total + '|' + sh.title + ': ' + it.name);
                try {
                    var so = sourceFor(it), src = so.doc;
                    app.activeDocument = src;
                    src.selection.selectAll(); src.selection.copy();
                    if (!so.keep) src.close(SaveOptions.DONOTSAVECHANGES);
                    app.activeDocument = sheet;
                    var lay = sheet.paste();
                    lay.name = it.name;
                    var b = lay.bounds;
                    lay.translate(UnitValue(px(it.xMm) - b[0].as('px'), 'px'), UnitValue(px(it.yMm) - b[1].as('px'), 'px'));
                } catch (e1) {
                    errs.push(it.name + ': ' + e1.message);
                    try { if (app.activeDocument !== sheet && !it.card) app.activeDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
                    app.activeDocument = sheet;
                }
                doneCount++;
            }
            var opt = new PhotoshopSaveOptions(); opt.layers = true; opt.embedColorProfile = true;
            sheet.saveAs(File(sh.out), opt, true, Extension.LOWERCASE);
            // Sayfa Photoshop'ta acik kalir: operator kontrol eder, baskiyi uygulamadaki Print ile verir
            if (!job.keepOpen) sheet.close(SaveOptions.DONOTSAVECHANGES);
            results.push('{"title":' + q(sh.title) + ',"ok":' + (errs.length ? 'false' : 'true') + ',"errors":[' +
                (function () { var o = []; for (var z = 0; z < errs.length; z++) o.push(q(errs[z])); return o.join(','); })() + ']}');
        }
    } catch (e) {
        fatal = e.message;
    } finally {
        for (var ck in cache) { try { cache[ck].close(SaveOptions.DONOTSAVECHANGES); } catch (e3) {} }
        app.preferences.rulerUnits = oldUnits;
        app.displayDialogs = oldDialogs;
        writeText(job.resultPath, '{"ok":' + (fatal ? 'false' : 'true') + ',"error":' + (fatal ? q(fatal) : 'null') + ',"sheets":[' + results.join(',') + ']}');
    }
})();
