/* Reads a whole rack of TSUs from one photo of the vial bottoms.
   Loads the barcode reader (zxing-wasm, kept in assets/vendor/zxing) the first time it is used, finds every
   Data Matrix code in the photo section by section, works out the rack grid from where the codes sit, then
   looks again, one rack position at a time, wherever the grid says a code should be but none was read.

   RackScan.read(file, onProgress) -> Promise of
     { codes: [{ text, row, col }], rows, cols, cells: [[text or null]], seconds }
   rows/cols describe the grid as it appears in the photo, turned so the long side runs across. */
(function () {
  'use strict';

  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/[^\/?#]*([?#].*)?$/, 'vendor/zxing/') : '../assets/vendor/zxing/';
  })();
  var MAX_SIDE = 4000;            // big enough for a phone photo, small enough to keep memory sane
  var TILE = 1100, OVERLAP = 0.35;
  var OPTS = { formats: ['DataMatrix'], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 0 };
  var CELL = { formats: ['DataMatrix'], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1 };
  // Ways to look at one rack position, cheapest first: as is, enlarged, enlarged and smoothed, plain threshold
  var CELL_TRIES = [{ up: 1, opts: CELL }, { up: 2, opts: CELL }, { up: 2, opts: Object.assign({}, CELL, { tryDenoise: true }) },
    { up: 2, opts: Object.assign({}, CELL, { binarizer: 'FixedThreshold' }) }, { up: 2, opts: CELL, stretch: true },
    { up: 3, opts: Object.assign({}, CELL, { tryDenoise: true }), stretch: true }];

  /** Contrast stretch on the middle of a crop (washed out by glare, or dim): 5th to 95th percentile -> 0..255. */
  function stretch(img) {
    var d = img.data, w = img.width, h = img.height, hist = new Array(256).fill(0), n = 0, x, y;
    for (y = Math.round(h * 0.2); y < h * 0.8; y++) for (x = Math.round(w * 0.2); x < w * 0.8; x++) {
      var i = (y * w + x) * 4; hist[(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0]++; n++;
    }
    var lo = 0, hi = 255, acc = 0;
    for (; lo < 255 && (acc += hist[lo]) < n * 0.05; lo++);
    for (acc = 0; hi > 0 && (acc += hist[hi]) < n * 0.05; hi--);
    if (hi - lo < 8) return img;
    var k = 255 / (hi - lo);
    for (var j = 0; j < d.length; j += 4) {
      var g = (d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11 - lo) * k;
      d[j] = d[j + 1] = d[j + 2] = g < 0 ? 0 : g > 255 ? 255 : g;
    }
    return img;
  }

  var readerP = null;
  function loadReader() {
    if (!readerP) {
      readerP = new Promise(function (res, rej) {
        if (window.ZXingWASM) return res();
        var sc = document.createElement('script');
        sc.src = BASE + 'zxing-reader.js';
        sc.onload = function () { res(); };
        sc.onerror = function () { rej(new Error('The barcode reader could not load. Check the internet connection and try again.')); };
        document.head.appendChild(sc);
      }).then(function () {
        return window.ZXingWASM.prepareZXingModule({
          overrides: { locateFile: function (path, prefix) { return /\.wasm$/.test(path) ? BASE + 'zxing_reader.wasm' : prefix + path; } },
          fireImmediately: true
        });
      });
      readerP.catch(function () { readerP = null; });
    }
    return readerP;
  }

  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('This browser cannot open that file. Take the photo again (JPEG or PNG).')); };
      img.src = url;
    });
  }

  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }); var m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function clean(t) { return String(t || '').replace(/\s/g, '').toUpperCase(); }
  function wait() { return new Promise(function (r) { setTimeout(r, 0); }); }   // let the page repaint between sections

  /** Centre and size of a read result, in full-image pixels. */
  function place(r, ox, oy, scale) {
    var p = r.position, pts = [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft];
    var x = 0, y = 0;
    pts.forEach(function (q) { x += q.x; y += q.y; });
    var side = (Math.hypot(p.topRight.x - p.topLeft.x, p.topRight.y - p.topLeft.y) + Math.hypot(p.bottomLeft.x - p.topLeft.x, p.bottomLeft.y - p.topLeft.y)) / 2;
    return { x: ox + x / 4 / scale, y: oy + y / 4 / scale, size: side / scale };
  }

  function read(file, onProgress) {
    var t0 = Date.now();
    var say = function (msg, frac) { if (onProgress) onProgress(msg, frac); };
    say('Loading the barcode reader…', 0);
    var img;
    return Promise.all([loadReader(), loadImage(file)]).then(function (got) {
      img = got[1];
      var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, MAX_SIDE / Math.max(w, h));
      var W = Math.round(w * s), H = Math.round(h * s);
      var full = document.createElement('canvas');
      full.width = W; full.height = H;
      var fctx = full.getContext('2d', { willReadFrequently: true });
      fctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(img.src);
      var work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });

      function crop(x, y, cw, ch, up) {
        x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
        cw = Math.min(W - x, Math.round(cw)); ch = Math.min(H - y, Math.round(ch));
        if (cw < 8 || ch < 8) return null;
        work.width = Math.round(cw * up); work.height = Math.round(ch * up);
        wctx.imageSmoothingEnabled = true;
        wctx.drawImage(full, x, y, cw, ch, 0, 0, work.width, work.height);
        return { data: wctx.getImageData(0, 0, work.width, work.height), x: x, y: y };
      }

      var found = {}, codes = [];
      function add(r, ox, oy, scale) {
        var text = clean(r.text);
        if (!text || r.isValid === false || found[text]) return false;
        var c = place(r, ox, oy, scale);
        c.text = text;
        found[text] = c; codes.push(c);
        return true;
      }

      function tiles(size) {
        var out = [], step = Math.round(size * (1 - OVERLAP));
        for (var ty = 0; ty < H; ty += step) {
          for (var tx = 0; tx < W; tx += step) { out.push([tx, ty]); if (tx + size >= W) break; }
          if (ty + size >= H) break;
        }
        return out;
      }
      // Read overlapping sections of the photo (size px each, enlarged by up)
      function sweep(size, up, from, to, label) {
        var list = tiles(size), i = 0;
        function next() {
          if (i >= list.length) return Promise.resolve();
          var t = list[i++];
          say(label + ' ' + i + ' of ' + list.length, from + (to - from) * i / list.length);
          var c = crop(t[0], t[1], size, size, up);
          if (!c) return next();
          return window.ZXingWASM.readBarcodes(c.data, OPTS).then(function (rs) {
            rs.forEach(function (r) { add(r, c.x, c.y, up); });
          }, function () { /* a bad section is not fatal */ }).then(wait).then(next);
        }
        return next();
      }

      // Pass 1: the whole photo at a modest size (fast, and blur matters less when smaller), then sections at full size
      var whole = Math.min(1, 2000 / Math.max(W, H));
      var w0 = crop(0, 0, W, H, whole);
      return window.ZXingWASM.readBarcodes(w0.data, OPTS).then(function (rs) {
        rs.forEach(function (r) { add(r, 0, 0, whole); });
      }, function () {}).then(function () {
        return sweep(TILE, 1, 0.05, 0.55, 'Reading barcodes… section');
      }).then(function () {
        // Very few codes: they are probably small in the photo, so look again enlarged
        if (codes.length >= 6) return;
        return sweep(600, 2, 0.55, 0.75, 'Looking closer… section');
      }).then(function () {
        // Pass 2: work out the grid, then look again wherever a code should be
        var g = grid(codes, W, H);
        if (!g) return finish(null);
        var todo = g.todo, k = 0;
        function nextCell() {
          if (k >= todo.length) return Promise.resolve();
          var rc = todo[k++];
          say('Looking again at empty positions… ' + k + ' of ' + todo.length, 0.75 + 0.23 * k / todo.length);
          var pt = g.toImage(rc[0], rc[1]);
          var side = g.pitch * 1.1, base = Math.max(1, 200 / side);
          var n = 0;
          function attempt() {
            if (n >= CELL_TRIES.length) return Promise.resolve();
            var tr = CELL_TRIES[n++], up = Math.min(4, base * tr.up);
            var c = crop(pt.x - side / 2, pt.y - side / 2, side, side, up);
            if (!c) return Promise.resolve();
            return window.ZXingWASM.readBarcodes(tr.stretch ? stretch(c.data) : c.data, tr.opts).then(function (rs) {
              if (!(rs[0] && add(rs[0], c.x, c.y, up))) return attempt();
            }, attempt);
          }
          return attempt().then(wait).then(nextCell);
        }
        return nextCell().then(function () { return finish(grid(codes, W, H)); });
      });

      function finish(g) {
        say('Done', 1);
        var out = { codes: [], rows: 0, cols: 0, cells: [], seconds: Math.round((Date.now() - t0) / 100) / 10 };
        if (!g) {
          out.codes = codes.map(function (c) { return { text: c.text, row: 0, col: 0 }; });
          if (codes.length === 1) { out.rows = 1; out.cols = 1; out.cells = [[codes[0].text]]; }
          return out;
        }
        // Keep only the rows and columns from the first to the last one with a code (edges added for the search may be empty)
        var at = g.rc;
        var r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
        at.forEach(function (rc) { r0 = Math.min(r0, rc[0]); r1 = Math.max(r1, rc[0]); c0 = Math.min(c0, rc[1]); c1 = Math.max(c1, rc[1]); });
        var R = r1 - r0 + 1, C = c1 - c0 + 1, turn = R > C;   // show the long side across
        out.rows = turn ? C : R; out.cols = turn ? R : C;
        for (var a = 0; a < out.rows; a++) { out.cells.push([]); for (var b = 0; b < out.cols; b++) out.cells[a].push(null); }
        codes.forEach(function (c, n) {
          var rc = [at[n][0] - r0, at[n][1] - c0];
          var row = turn ? rc[1] : rc[0], col = turn ? R - 1 - rc[0] : rc[1];
          if (out.cells[row][col] === null) out.cells[row][col] = c.text;
          out.codes.push({ text: c.text, row: row, col: col });
        });
        return out;
      }
    });
  }

  /** Rack grid from code centres. Spacing comes from nearest neighbours and tilt from their directions; each
      code then gets its row and column by stepping from neighbour to neighbour (so a photo taken at a slant,
      where rows are not quite parallel, still lines up), and a perspective fit of row/column to photo
      position says where unread positions are. Returns null with fewer than 2 codes. */
  function grid(codes, W, H) {
    var n = codes.length;
    if (n < 2) return null;
    var nn = [], sx = 0, sy = 0;
    codes.forEach(function (a, i) {
      var bd = Infinity, bx = 0, by = 0;
      codes.forEach(function (b, j) {
        if (i === j) return;
        var dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bx = dx; by = dy; }
      });
      nn.push(Math.sqrt(bd));
      var t = Math.atan2(by, bx);
      sx += Math.cos(4 * t); sy += Math.sin(4 * t);
    });
    var pitch = median(nn), th = Math.atan2(sy, sx) / 4, co = Math.cos(th), si = Math.sin(th);
    function steps(i, j) {           // [rows, cols] from code i to code j, or null if they don't sit on the grid
      var dx = codes[j].x - codes[i].x, dy = codes[j].y - codes[i].y;
      var a = dx * co + dy * si, b = -dx * si + dy * co, ka = Math.round(a / pitch), kb = Math.round(b / pitch);
      if (Math.abs(ka) + Math.abs(kb) > 2 || (!ka && !kb)) return null;
      if (Math.abs(a - ka * pitch) > 0.3 * pitch || Math.abs(b - kb * pitch) > 0.3 * pitch) return null;
      return [kb, ka];
    }
    var adj = codes.map(function () { return []; });
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
      var s = steps(i, j);
      if (s) { adj[i].push([j, s[0], s[1]]); adj[j].push([i, -s[0], -s[1]]); }
    }
    var rc = new Array(n), done = 0;
    function walk(start) {
      var q = [start];
      while (q.length) {
        var k = q.shift();
        adj[k].forEach(function (e) {
          if (rc[e[0]]) return;
          rc[e[0]] = [rc[k][0] + e[1], rc[k][1] + e[2]]; done++; q.push(e[0]);
        });
      }
    }
    var seed = 0;
    adj.forEach(function (e, k) { if (e.length > adj[seed].length) seed = k; });
    rc[seed] = [0, 0]; done = 1; walk(seed);
    while (done < n) {               // codes not linked to the rest: place them from the nearest placed code
      var best = -1, from = -1, bd = Infinity;
      for (var u = 0; u < n; u++) if (!rc[u]) for (var v = 0; v < n; v++) if (rc[v]) {
        var d = Math.hypot(codes[u].x - codes[v].x, codes[u].y - codes[v].y);
        if (d < bd) { bd = d; best = u; from = v; }
      }
      var dx = codes[best].x - codes[from].x, dy = codes[best].y - codes[from].y;
      rc[best] = [rc[from][0] + Math.round((-dx * si + dy * co) / pitch), rc[from][1] + Math.round((dx * co + dy * si) / pitch)];
      done++; walk(best);
    }
    var r0 = Infinity, c0 = Infinity, r1 = -Infinity, c1 = -Infinity;
    rc.forEach(function (p) { r0 = Math.min(r0, p[0]); c0 = Math.min(c0, p[1]); r1 = Math.max(r1, p[0]); c1 = Math.max(c1, p[1]); });
    rc = rc.map(function (p) { return [p[0] - r0, p[1] - c0]; });
    var R = r1 - r0 + 1, C = c1 - c0 + 1;

    // Where is (row, col) in the photo? Perspective fit with enough codes, else straight steps from the mean
    var fit = homography(codes, rc);
    var mx = 0, my = 0, mr = 0, mc = 0;
    codes.forEach(function (c, k) { mx += c.x / n; my += c.y / n; mr += rc[k][0] / n; mc += rc[k][1] / n; });
    function toImage(r, c) {
      if (fit) { var w = fit[6] * c + fit[7] * r + 1; return { x: (fit[0] * c + fit[1] * r + fit[2]) / w * 1000, y: (fit[3] * c + fit[4] * r + fit[5]) / w * 1000 }; }
      var a = (c - mc) * pitch, b = (r - mr) * pitch;
      return { x: mx + a * co - b * si, y: my + a * si + b * co };
    }

    // Positions to look at again: every empty one, plus whole edge rows/columns a standard 8 x 12 rack may still have
    function inside(r, c) { var p = toImage(r, c); return p.x > pitch * 0.3 && p.y > pitch * 0.3 && p.x < W - pitch * 0.3 && p.y < H - pitch * 0.3; }
    var wantR = C >= R ? 8 : 12, wantC = C >= R ? 12 : 8, ra = 0, rb = R - 1, ca = 0, cb = C - 1;
    if (n >= 6) {
      for (var t = 0; rb - ra + 1 < wantR && t < 8; t++) { if (inside(rb + 1, (ca + cb) / 2)) rb++; else if (inside(ra - 1, (ca + cb) / 2)) ra--; else break; }
      for (t = 0; cb - ca + 1 < wantC && t < 8; t++) { if (inside((ra + rb) / 2, cb + 1)) cb++; else if (inside((ra + rb) / 2, ca - 1)) ca--; else break; }
    }
    var taken = {};
    rc.forEach(function (p) { taken[p[0] + ',' + p[1]] = true; });
    var todo = [];
    for (var rr = ra; rr <= rb; rr++) for (var cc = ca; cc <= cb; cc++) if (!taken[rr + ',' + cc] && inside(rr, cc)) todo.push([rr, cc]);
    return { rc: rc, pitch: pitch, toImage: toImage, todo: todo };
  }

  /** Least-squares perspective map from (col, row) to photo position (in thousands of pixels). Needs 6+ codes. */
  function homography(codes, rc) {
    if (codes.length < 6) return null;
    var M = [], i, j, k;
    for (i = 0; i < 8; i++) { M.push([]); for (j = 0; j < 9; j++) M[i].push(0); }
    codes.forEach(function (p, n) {
      var c = rc[n][1], r = rc[n][0], x = p.x / 1000, y = p.y / 1000;
      [[c, r, 1, 0, 0, 0, -c * x, -r * x, x], [0, 0, 0, c, r, 1, -c * y, -r * y, y]].forEach(function (row) {
        for (var a = 0; a < 8; a++) for (var b = 0; b < 9; b++) M[a][b] += row[a] * row[b];
      });
    });
    for (i = 0; i < 8; i++) {                 // Gaussian elimination
      var piv = i;
      for (k = i + 1; k < 8; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      if (Math.abs(M[piv][i]) < 1e-12) return null;
      var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      for (k = 0; k < 8; k++) if (k !== i) { var f = M[k][i] / M[i][i]; for (j = i; j < 9; j++) M[k][j] -= f * M[i][j]; }
    }
    var h = [];
    for (i = 0; i < 8; i++) h.push(M[i][8] / M[i][i]);
    return h;
  }

  window.RackScan = { read: read, _grid: grid };
})();
