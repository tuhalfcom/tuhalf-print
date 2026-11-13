// Tuhalf Print - PSD yazdirma. Photoshop'ta en son kullanilan yazdirma ayarlariyla basar.
(function () {
    function readText(p) { var f = File(p); f.encoding = 'UTF-8'; f.open('r'); var t = f.read(); f.close(); return t.replace(/^\uFEFF/, ''); }
    function writeText(p, s) { var f = File(p); f.encoding = 'UTF-8'; f.open('w'); f.write(s); f.close(); }
    function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"'; }
    var job = eval('(' + readText(__JOB) + ')');
    var res = [], oldDialogs = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
    try {
        for (var i = 0; i < job.files.length; i++) {
            var p = job.files[i];
            writeText(job.progressPath, i + '|' + job.files.length + '|' + File(p).name);
            try {
                // Sayfa zaten aciksa (operator duzenlemis olabilir) onu kaydedip bas, degilse dosyadan ac
                var target = File(p).fsName.toLowerCase(), d = null;
                for (var k = 0; k < app.documents.length; k++) {
                    try { if (app.documents[k].fullName.fsName.toLowerCase() === target) { d = app.documents[k]; break; } } catch (eN) {}
                }
                if (d) { app.activeDocument = d; if (!d.saved) d.save(); }
                else d = open(File(p));
                d.printOneCopy();
                d.close(SaveOptions.DONOTSAVECHANGES);
                res.push('{"path":' + q(p) + ',"ok":true}');
            } catch (e) {
                res.push('{"path":' + q(p) + ',"ok":false,"error":' + q(e.message) + '}');
            }
        }
    } finally {
        app.displayDialogs = oldDialogs;
        writeText(job.resultPath, '{"ok":true,"files":[' + res.join(',') + ']}');
    }
})();
