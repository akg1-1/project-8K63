/* ==========================================================================
   Cashfy — маленькая библиотека SVG-графиков (без зависимостей)
   ========================================================================== */

(function (global) {
  'use strict';

  var uid = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function niceMax(v) {
    if (!isFinite(v) || v <= 0) return 100;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) {
      if (v <= steps[i] * p) return steps[i] * p;
    }
    return 10 * p;
  }

  function smooth(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return 'M' + pts[0].x + ',' + pts[0].y;
    var d = 'M' + pts[0].x.toFixed(2) + ',' + pts[0].y.toFixed(2);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / 6;
      var c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6;
      var c2y = p2.y - (p3.y - p1.y) / 6;
      d += 'C' + c1x.toFixed(2) + ',' + c1y.toFixed(2) + ' ' +
           c2x.toFixed(2) + ',' + c2y.toFixed(2) + ' ' +
           p2.x.toFixed(2) + ',' + p2.y.toFixed(2);
    }
    return d;
  }

  /* ------------------------------- Площадной ------------------------------ */

  function area(values, labels, opts) {
    opts = opts || {};
    var W = 700, H = 210, PL = 8, PR = 8, PT = 16, PB = 26;
    var n = values.length;
    if (!n) return '<p class="hint" style="padding:24px 0">Пока нет данных за этот период.</p>';

    var max = niceMax(Math.max.apply(null, values));
    var iw = W - PL - PR;
    var ih = H - PT - PB;
    var base = PT + ih;

    var pts = values.map(function (v, i) {
      var x = n === 1 ? PL + iw / 2 : PL + (i / (n - 1)) * iw;
      var y = base - (Math.max(0, v) / max) * ih;
      return { x: x, y: y, v: v };
    });

    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var gy = (PT + (ih / 4) * g).toFixed(2);
      grid += '<line class="chart-grid" x1="' + PL + '" y1="' + gy + '" x2="' + (W - PR) + '" y2="' + gy + '"/>';
    }

    var line = smooth(pts);
    var areaPath = line + 'L' + pts[n - 1].x.toFixed(2) + ',' + base +
      'L' + pts[0].x.toFixed(2) + ',' + base + 'Z';

    var gid = 'ca' + (++uid);

    var xlabels = '';
    var step = Math.max(1, Math.ceil(n / 4));
    for (var i = 0; i < n; i += step) {
      if (!labels || !labels[i]) continue;
      var anchor = i === 0 ? 'start' : (i + step >= n ? 'end' : 'middle');
      xlabels += '<text class="chart-axis" x="' + pts[i].x.toFixed(2) + '" y="' + (H - 7) + '" text-anchor="' + anchor + '">' + esc(labels[i]) + '</text>';
    }

    var hover = '';
    if (opts.tip) {
      var slot = n === 1 ? iw : iw / Math.max(1, n - 1);
      for (var j = 0; j < n; j++) {
        var hx = pts[j].x - slot / 2;
        var hw = slot;
        if (j === 0) { hx = PL; hw = slot / 2 + 4; }
        if (j === n - 1) { hw = slot / 2 + PR + 4; }
        hover += '<rect x="' + hx.toFixed(2) + '" y="' + PT + '" width="' + Math.max(1, hw).toFixed(2) +
          '" height="' + ih + '" fill="transparent"><title>' + esc(opts.tip(labels ? labels[j] : '', values[j])) + '</title></rect>';
      }
    }

    var last = pts[n - 1];
    var dot = values[n - 1] > 0
      ? '<circle class="chart-dot" cx="' + last.x.toFixed(2) + '" cy="' + last.y.toFixed(2) + '" r="4"/>' +
        '<circle cx="' + last.x.toFixed(2) + '" cy="' + last.y.toFixed(2) + '" r="8" fill="none" stroke="var(--green)" stroke-opacity=".35" stroke-width="2"/>'
      : '';

    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.label || 'График трат') + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" class="chart-area-stop-a"/><stop offset="100%" class="chart-area-stop-b"/>' +
      '</linearGradient></defs>' +
      grid +
      '<path d="' + areaPath + '" fill="url(#' + gid + ')"/>' +
      '<path class="chart-line" d="' + line + '"/>' +
      dot + xlabels + hover +
      '</svg>';
  }

  /* --------------------------------- Donut -------------------------------- */

  function donut(parts, opts) {
    opts = opts || {};
    var size = opts.size || 148;
    var sw = opts.stroke || 20;
    var cx = size / 2, cy = size / 2;
    var r = (size - sw) / 2 - 2;
    var total = parts.reduce(function (s, p) { return s + Math.max(0, p.value); }, 0);
    var circ = 2 * Math.PI * r;

    var segs = '';
    if (total > 0) {
      var off = 0;
      parts.forEach(function (p) {
        var v = Math.max(0, p.value);
        if (v <= 0) return;
        var len = (v / total) * circ;
        var gap = Math.min(2.5, len * 0.18);
        var dash = Math.max(0.5, len - gap);
        segs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(2) + '" fill="none" stroke="' + esc(p.color || '#1DB954') +
          '" stroke-width="' + sw + '" stroke-dasharray="' + dash.toFixed(2) + ' ' + (circ - dash).toFixed(2) +
          '" stroke-dashoffset="' + (-off).toFixed(2) + '">' +
          '<title>' + esc(p.label || '') + (p.text ? ': ' + esc(p.text) : '') + '</title></circle>';
        off += len;
      });
    } else {
      segs = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(2) + '" fill="none" stroke="#2a2a2a" stroke-width="' + sw + '"/>';
    }

    var center = '';
    if (opts.centerTop || opts.centerBottom) {
      center =
        '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" fill="#fff" font-size="17" font-weight="800" letter-spacing="-.4">' + esc(opts.centerTop || '') + '</text>' +
        '<text x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle" fill="#8a8a8a" font-size="10.5" font-weight="600">' + esc(opts.centerBottom || '') + '</text>';
    }

    return '<svg class="donut" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' +
      esc(opts.label || 'Распределение по категориям') + '">' +
      '<g transform="rotate(-90 ' + cx + ' ' + cy + ')">' + segs + '</g>' + center + '</svg>';
  }

  /* --------------------------------- Bars --------------------------------- */

  function bars(items, opts) {
    opts = opts || {};
    var W = 360, H = 150, PT = 12, PB = 24;
    var n = items.length;
    if (!n) return '<p class="hint" style="padding:16px 0">Пока нет данных.</p>';

    var max = niceMax(Math.max.apply(null, items.map(function (i) { return i.value; })));
    var ih = H - PT - PB;
    var slot = W / n;
    var bw = Math.min(38, slot * 0.56);

    var out = '';
    items.forEach(function (it, i) {
      var h = Math.max(2, (Math.max(0, it.value) / max) * ih);
      var x = slot * i + (slot - bw) / 2;
      var y = PT + ih - h;
      out += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + bw.toFixed(2) +
        '" height="' + h.toFixed(2) + '" rx="' + Math.min(6, bw / 2).toFixed(2) +
        '" fill="' + esc(it.color || 'var(--green)') + '">' +
        '<title>' + esc(it.label) + ': ' + esc(it.text || '') + '</title></rect>';
      out += '<text class="chart-axis" x="' + (slot * i + slot / 2).toFixed(2) + '" y="' + (H - 7) +
        '" text-anchor="middle">' + esc(it.short || it.label) + '</text>';
    });

    var peak = '';
    if (opts.peakLabel) {
      peak = '<text class="chart-axis" x="' + W + '" y="12" text-anchor="end" fill="#6f6f6f">' + esc(opts.peakLabel) + '</text>';
    }

    return '<svg class="chart chart-bars" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.label || 'Траты по дням недели') + '">' + peak + out + '</svg>';
  }

  global.Charts = { area: area, donut: donut, bars: bars, esc: esc, niceMax: niceMax };
})(window);
