/* Receiving a box: open it by slip QR / reference / any TSU, scan every TSU, check the consent form,
   finish (writes the tracker, creates the invoice), then review and send the receipt email. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = App.esc;
  App.footer();

  var V = null;          // current receiving view from the back end
  var events = [], n = 0, extras = [], paper = { present: false, research: '', signer: '' }, draft = null, finished = null, busy = false;

  function show(id) { ['lookup', 'box'].forEach(function (x) { $(x).classList.toggle('hidden', x !== id); }); }
  function pane(id) { ['scan-pane', 'check-pane', 'mail-pane', 'done-pane'].forEach(function (x) { $(x).classList.toggle('hidden', x !== id); }); }
  function gotCount() { return V.expected.filter(function (e) { return e.received; }).length; }
  function missing() { return V.expected.filter(function (e) { return !e.received; }); }
  function needsPaper() { return V.kind === 'submission' && !V.consent.signed; }

  Staff.gate('receive', function () {
    if (window.Scanner && Scanner.supported()) { $('q-cam').classList.remove('hidden'); $('scan-cam').classList.remove('hidden'); }
    var ref = App.param('ref');
    if (ref) { $('q').value = ref; lookup(); } else { show('lookup'); $('q').focus(); }
  });

  // ---------------------------------------------------------------- open a box
  function lookup() {
    var q = $('q').value.trim();
    if (!q) return;
    $('find').disabled = true;
    $('q-msg').classList.add('hidden');
    Staff.call('lookup', { query: q }).then(function (d) {
      open(d);
    }).catch(function (e) {
      App.notice($('q-msg'), 'bad', esc(e.message));
    }).then(function () { $('find').disabled = false; });
  }
  $('find').onclick = lookup;
  $('q').onkeydown = function (e) { if (e.key === 'Enter') lookup(); };
  $('q-cam').onclick = function () { Scanner.open(function (c) { $('q').value = c; lookup(); }, { prompt: 'Point the camera at the QR code on the packing slip' }); };

  function open(d) {
    V = d; events = []; n = 0; extras = []; draft = null; finished = null;
    paper = { present: false, research: '', signer: '' };
    var s = d.submission, rep = d.kind === 'replacement';
    $('b-eyebrow').textContent = rep ? 'Replacement TSUs for ' + s.id : 'Submission' + (s.receivedDate ? ' · first received ' + s.receivedDate : '');
    $('b-title').textContent = d.ref + ' · ' + s.flock;
    $('b-sub').textContent = [s.contact, s.town, rep ? d.expected.length + ' replacement' + (d.expected.length === 1 ? '' : 's') : s.animalCount + ' ' + (s.breed || 'animals')].filter(Boolean).join(' · ');
    $('of').textContent = d.expected.length;
    if (!rep && s.receivedDate) App.notice($('b-note'), 'info', 'This box was already received on ' + esc(s.receivedDate) + '. Scanning adds any TSUs that arrived late; finishing again sends a new receipt.');
    else $('b-note').classList.add('hidden');
    history.replaceState(null, '', '?ref=' + encodeURIComponent(d.ref));
    rack = null; $('rack').classList.add('hidden');
    show('box'); pane('scan-pane');
    renderAll();
    $('scan').focus();
  }

  $('other-box').onclick = function () { V = null; history.replaceState(null, '', location.pathname); $('q').value = ''; show('lookup'); $('q').focus(); };
  $('another').onclick = $('other-box').onclick;

  // ---------------------------------------------------------------- rendering
  function renderAll() { renderExpected(); renderEvents(); renderHold(); renderFinish(); }

  function renderExpected() {
    var closing = !$('check-pane').classList.contains('hidden') || !!finished;
    $('got').textContent = gotCount();
    $('exp').innerHTML = V.expected.map(function (e) {
      var st = e.received ? ['st-ok', 'Received'] : closing ? ['st-miss', 'Missing'] : ['st-wait', 'Waiting'];
      return '<div class="tbl-row exp-grid"><b>' + esc(e.tag) + '</b><span class="mono">' + esc(e.tsu) + '</span><span class="mono opt small">' + esc(e.eid) +
        '</span><span class="opt small">' + esc(e.sexBorn) + '</span><span><span class="st ' + st[0] + '">' + st[1] + '</span></span></div>';
    }).join('');
  }

  function renderEvents() {
    if (!events.length) return;
    $('events').innerHTML = events.slice(-5).reverse().map(function (e) {
      return '<div class="ev ' + e.cls + '"><span class="row" style="gap:8px;flex-wrap:nowrap"><span class="mono">' + e.n + '</span><b>' + esc(e.title) + '</b></span>' +
        (e.sub ? '<span class="small">' + esc(e.sub) + '</span>' : '') + '</div>';
    }).join('');
  }

  function renderHold() {
    if (!needsPaper()) { $('hold').classList.add('hidden'); return; }
    var h = $('hold');
    h.classList.remove('hidden');
    h.className = 'hold' + (paper.present ? ' ok' : '');
    var chosePaper = V.consent.method === 'Paper';
    h.innerHTML = (paper.present
      ? '<span><b>Paper consent form received.</b> The hold lifts when you finish. Take a photo of the form for the Drive folder, then file the paper.</span>'
      : '<span><b>Look for the signed consent form.</b> ' + (chosePaper ? 'This producer chose to sign on paper.' : 'This submission is not signed yet.') +
        ' If it isn\'t in the box, receive as normal; the samples stay on hold until they sign.</span>') +
      '<label class="check"><input type="checkbox" id="p-in"' + (paper.present ? ' checked' : '') + '> Signed paper consent form is in the box</label>' +
      (paper.present ? '<div class="row" style="gap:10px"><span class="small"><b>From the form:</b> research use</span>' +
        '<button type="button" class="choice" id="p-y" aria-pressed="' + (paper.research === 'Y') + '">Yes</button>' +
        '<button type="button" class="choice" id="p-n" aria-pressed="' + (paper.research === 'N') + '">No</button>' +
        '<label class="row small" style="gap:8px">Signed by <input class="field" id="p-name" style="width:220px;height:40px" value="' + esc(paper.signer) + '"></label></div>' : '');
    $('p-in').onchange = function (e) { paper.present = e.target.checked; renderHold(); renderFinish(); };
    if ($('p-y')) {
      $('p-y').onclick = function () { paper.research = 'Y'; renderHold(); renderFinish(); };
      $('p-n').onclick = function () { paper.research = 'N'; renderHold(); renderFinish(); };
      $('p-name').oninput = function (e) { paper.signer = e.target.value; };
    }
  }

  function renderFinish() {
    var need = paper.present && !paper.research;
    $('finish').disabled = busy || need || busyRack();
    $('finish').textContent = 'Finish receiving (' + gotCount() + ' of ' + V.expected.length + ')';
    $('finish-hint').textContent = need ? 'Record the research answer from the paper form to finish.' : '';
  }

  // ---------------------------------------------------------------- scanning
  var queue = Promise.resolve();
  function scan(code) {
    code = String(code || '').replace(/\s/g, '').toUpperCase();
    if (!code || !V) return;
    var num = ++n;
    // Same box's QR scanned again by mistake: ignore quietly
    if (code === V.ref) { events.push({ n: num, cls: 'ev-dup', title: 'That is the packing slip', sub: 'Scan the TSUs themselves.' }); renderEvents(); return; }
    queue = queue.then(function () {
      return Staff.call('scan', { ref: V.ref, tsu: code }).then(function (d) {
        var ev;
        if (d.result === 'ok') {
          V.expected.forEach(function (e) { if (e.tsu === d.tsu) e.received = true; });
          ev = { cls: 'ev-ok', title: d.tag + ' received', sub: d.tsu };
        } else if (d.result === 'dup') {
          ev = { cls: 'ev-dup', title: d.tsu + ' scanned twice', sub: 'Already ticked off as ' + d.tag + '. Nothing changed.' };
        } else if (d.result === 'other') {
          ev = { cls: 'ev-other', title: d.tsu + ' is not on this ' + (V.kind === 'replacement' ? 'replacement' : 'submission'), sub: 'Belongs to ' + d.belongs + '. Set it aside.' };
          extras.push(d.tsu + ' belongs to ' + d.belongs + '. Set it aside.');
        } else {
          ev = { cls: 'ev-other', title: d.tsu + ' is not on any submission', sub: 'Set it aside and check the barcode, or ask Christian.' };
          extras.push(d.tsu + ' is not on any submission. Set it aside.');
        }
        ev.n = num;
        events.push(ev);
        renderExpected(); renderEvents(); renderFinish();
      }).catch(function (e) {
        events.push({ n: num, cls: 'ev-other', title: code + ' not saved', sub: e.message + ' Scan it again.' });
        renderEvents();
      });
    });
  }
  function scanTyped() { var v = $('scan').value; $('scan').value = ''; scan(v); $('scan').focus(); }
  $('scan').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); scanTyped(); } };
  $('scan-go').onclick = scanTyped;
  $('scan-cam').onclick = function () { Scanner.open(scan, { keepOpen: true, prompt: 'Point the camera at each TSU barcode in turn' }); };

  // ---------------------------------------------------------------- a whole rack from one photo
  // rack = { phase: reading|preview|saving|done|error, msg, frac, read (RackScan result), out: { tsu: server result }, sel, corner }
  var rack = null;
  var RK_TIPS = 'Fill the photo with the rack, hold the phone flat and steady under it, use soft light with no flash, and tap the screen to focus.';

  $('rack-btn').onclick = function () { if (!busyRack()) $('rack-file').click(); };
  $('rack-file').onchange = function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) readRack(f);
  };
  function busyRack() { return rack && (rack.phase === 'reading' || rack.phase === 'saving'); }

  function readRack(file) {
    rack = { phase: 'reading', msg: 'Opening the photo…', frac: 0, read: null, out: {}, sel: null, corner: corner() };
    renderRack();
    $('rack').scrollIntoView({ behavior: 'smooth', block: 'start' });
    RackScan.read(file, function (msg, frac) {
      if (!rack || rack.phase !== 'reading') return;
      rack.msg = msg; rack.frac = frac;
      var bar = $('rk-bar'), m = $('rk-msg');
      if (bar) bar.style.width = Math.round(frac * 100) + '%';
      if (m) m.textContent = msg;
    }).then(function (r) {
      if (!rack) return;
      rack.read = r;
      rack.phase = r.codes.length ? 'preview' : 'error';
      if (!r.codes.length) rack.msg = 'No barcodes were found in that photo.';
      renderRack();
    }).catch(function (e) {
      if (!rack) return;
      rack.phase = 'error'; rack.msg = e.message || 'The photo could not be read.';
      renderRack();
    });
  }

  function checkInRack() {
    var codes = rack.read.codes;
    rack.phase = 'saving'; renderRack();
    var payload = codes.map(function (c) { return { tsu: c.text, pos: rack.read.cols ? wellName(c.row, c.col) : '' }; });
    queue = queue.then(function () {
      return Staff.call('scanRack', { ref: V.ref, tsus: payload }).then(function (d) {
        var tally = { ok: 0, dup: 0, repeat: 0 }, others = {}, unknown = [];
        d.results.forEach(function (x) {
          rack.out[x.tsu] = x;
          if (x.result === 'ok') { tally.ok++; V.expected.forEach(function (e) { if (e.tsu === x.tsu) e.received = true; }); }
          else if (x.result === 'dup') tally.dup++;
          else if (x.result === 'repeat') tally.repeat++;
          else if (x.result === 'other') { var k = x.otherRef || x.belongs; (others[k] = others[k] || { belongs: x.belongs.replace(/ \(.*\)$/, ''), tsus: [] }).tsus.push(x.tsu); }
          else unknown.push(x.tsu);
        });
        rack.tally = tally; rack.others = others; rack.unknown = unknown;
        Object.keys(others).forEach(function (k) {
          var o = others[k], many = o.tsus.length > 1;
          extras.push(o.tsus.length + ' TSU' + (many ? 's' : '') + ' from the rack (' + o.tsus.join(', ') + ') belong' + (many ? '' : 's') + ' to ' + o.belongs + '. Set ' + (many ? 'them' : 'it') + ' aside.');
        });
        if (unknown.length) extras.push(unknown.join(', ') + ' from the rack ' + (unknown.length > 1 ? 'are' : 'is') + ' not on any submission. Set ' + (unknown.length > 1 ? 'them' : 'it') + ' aside.');
        var bits = [];
        if (tally.dup) bits.push(tally.dup + ' already in');
        var nOther = Object.keys(others).reduce(function (a, k) { return a + others[k].tsus.length; }, 0);
        if (nOther) bits.push(nOther + ' for other boxes');
        if (unknown.length) bits.push(unknown.length + ' unknown');
        events.push({ n: ++n, cls: nOther || unknown.length ? 'ev-other' : 'ev-ok', title: 'Rack photo: ' + tally.ok + ' received', sub: bits.join(' · ') });
        rack.phase = 'done';
        renderRack(); renderExpected(); renderEvents(); renderFinish();
      }).catch(function (e) {
        rack.phase = 'preview'; rack.err = e.message + (e.transport ? ' Nothing is lost: press Check in again.' : '');
        renderRack();
      });
    });
  }

  // Well names. The photo shows the vial bottoms; staff say which corner of the photo holds A1 (remembered on
  // this device). Numbers 1-12 run along the long side of the rack from that corner, letters A-H along the short side.
  // The page always draws the standard plate map (A1 top left, H12 bottom right), whatever way the photo was taken.
  var CORNERS = { bl: 'bottom left', tl: 'top left', tr: 'top right', br: 'bottom right' };
  function corner() { try { var c = localStorage.getItem('msuRackA1'); return CORNERS[c] ? c : 'bl'; } catch (e) { return 'bl'; } }
  function setCorner(c) { try { localStorage.setItem('msuRackA1', c); } catch (e) { /* stays for this visit */ } rack.corner = c; }
  function wellName(r, c) {
    var R = rack.read.rows, C = rack.read.cols, k = rack.corner || corner(), left = k[1] === 'l', top = k[0] === 't';
    var across = C >= R;      // long side across the photo
    var num = across ? (left ? c + 1 : C - c) : (top ? r + 1 : R - r);
    var let_ = across ? (top ? r : R - 1 - r) : (left ? c : C - 1 - c);
    return (let_ >= 0 && let_ < 8 ? 'ABCDEFGH'[let_] : '?') + num;
  }

  /** What sits in each well of the 96-well plate: { A1: TSU or '?' }, plus codes that fall outside A1-H12. */
  function plateMap() {
    var map = {}, outside = [];
    rack.read.cells.forEach(function (row, r) {
      row.forEach(function (t, c) {
        if (!t) return;
        var w = wellName(r, c), num = +w.slice(1);
        if (w[0] === '?' || num < 1 || num > 12) { if (t !== '?') outside.push(t); return; }
        map[w] = t;
      });
    });
    return { map: map, outside: outside };
  }

  function cellState(tsu, well) {
    var at = well + ': ';
    if (!tsu) return ['rk-empty', at + 'empty well'];
    if (tsu === '?') return ['rk-unread', at + 'a vial is here but its code could not be read. Scan it by hand.'];
    var o = rack.out[tsu];
    if (o) {
      if (o.result === 'ok') return ['rk-ok', at + tsu + ' received (' + o.tag + ')'];
      if (o.result === 'dup' || o.result === 'repeat') return ['rk-dup', at + tsu + ' already checked in' + (o.tag ? ' (' + o.tag + ')' : '')];
      if (o.result === 'other') return ['rk-other', at + tsu + ' belongs to ' + o.belongs + '. Set it aside.'];
      return ['rk-other', at + tsu + ' is not on any submission. Set it aside.'];
    }
    var e = V.expected.filter(function (x) { return x.tsu === tsu; })[0];
    if (!e) return ['rk-not', at + tsu + ' is not on this ' + (V.kind === 'replacement' ? 'replacement' : 'submission')];
    return e.received ? ['rk-have', at + tsu + ' already checked in (' + e.tag + ')'] : ['rk-exp', at + tsu + ' (' + e.tag + ') is on this box'];
  }

  function unreadWells() {
    var out = [], cells = rack.read.cells;
    cells.forEach(function (row, r) { row.forEach(function (t, c) { if (t === '?') out.push(wellName(r, c)); }); });
    return out.sort(function (a, b) { return a[0] === b[0] ? +a.slice(1) - +b.slice(1) : a < b ? -1 : 1; });
  }

  function renderRack() {
    var box = $('rack');
    if (V) renderFinish();
    if (!rack) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var h = '<div class="row" style="justify-content:space-between;align-items:baseline"><h2 style="font-size:22px">Rack photo</h2>' +
      (busyRack() ? '' : '<button type="button" class="linkbtn" id="rk-close">Close</button>') + '</div>';
    if (rack.phase === 'reading') {
      h += '<div class="rk-bar"><span id="rk-bar" style="width:' + Math.round(rack.frac * 100) + '%"></span></div><span class="small muted" id="rk-msg">' + esc(rack.msg) + '</span>';
      box.innerHTML = h; return;
    }
    if (rack.phase === 'error') {
      h += '<div class="alert warn"><span><b>' + esc(rack.msg) + '</b> ' + RK_TIPS + ' Or scan the TSUs one at a time.</span></div>' +
        '<div class="row"><button type="button" class="btn btn-primary btn-sm" id="rk-again">Try another photo</button></div>';
      box.innerHTML = h; wireRack(); return;
    }
    if (!rack.corner) rack.corner = corner();
    var r = rack.read, unread = r.cols ? unreadWells() : [], vials = r.codes.length + unread.length;
    var onBox = r.codes.filter(function (c) { return V.expected.some(function (e) { return e.tsu === c.text; }); }).length;
    var byHand = unread.length ? '<b>' + unread.length + ' vial' + (unread.length === 1 ? '' : 's') + ' could not be read</b> (marked ?): scan by hand: ' + unread.join(', ') : '';
    if (rack.phase === 'preview' || rack.phase === 'saving') {
      h += '<p style="margin:0"><b>Read ' + r.codes.length + (unread.length ? ' of ' + vials + ' vials' : ' code' + (r.codes.length === 1 ? '' : 's')) + '</b> in ' + r.seconds + ' s: ' +
        onBox + ' on this box' + (r.codes.length - onBox ? ', <b>' + (r.codes.length - onBox) + ' not on this box</b>' : '') + '.</p>';
      if (byHand) h += '<p style="margin:0">' + byHand + '. Or retake the photo.</p>';
      if (unread.length > 0.25 * vials) h += '<div class="alert info"><span>Many codes unread? ' + RK_TIPS + '</span></div>';
    } else {
      var t = rack.tally;
      var items = ['<li><b>' + t.ok + '</b> checked in</li>'];
      if (t.dup) items.push('<li>' + t.dup + ' were already checked in</li>');
      Object.keys(rack.others).forEach(function (k) { var o = rack.others[k]; var many = o.tsus.length > 1; items.push('<li><b>' + o.tsus.length + ' belong' + (many ? '' : 's') + ' to ' + esc(o.belongs) + '</b>: set ' + (many ? 'them' : 'it') + ' aside (red)</li>'); });
      if (rack.unknown.length) items.push('<li><b>' + rack.unknown.length + ' not on any submission</b>: set aside (red)</li>');
      if (byHand) items.push('<li>' + byHand + '</li>');
      var left = missing().length;
      items.push('<li>' + (left ? left + ' TSU' + (left === 1 ? '' : 's') + ' on this box still not checked in' : 'Every TSU on this box is checked in') + '</li>');
      h += '<ul style="margin:0;padding-left:18px" class="stack-s">' + items.join('') + '</ul>';
    }
    if (r.cols) {
      // The standard plate map, A1 top left to H12 bottom right, whichever way the rack was photographed
      var pm = plateMap(), LET = 'ABCDEFGH', labelCell = function (txt) { return '<span class="rk-lab">' + txt + '</span>'; };
      h += '<div class="rack-grid" role="grid" aria-label="96-well plate map" style="grid-template-columns:22px repeat(12,minmax(0,1fr));max-width:766px">';
      h += labelCell('');
      for (var n0 = 1; n0 <= 12; n0++) h += labelCell(n0);
      for (var a = 0; a < 8; a++) {
        h += labelCell(LET[a]);
        for (var b = 1; b <= 12; b++) {
          var well = LET[a] + b, tsu = pm.map[well] || null, st = cellState(tsu, well);
          h += '<button type="button" class="rk ' + st[0] + (rack.sel === well ? ' sel' : '') + '" data-well="' + well + '" title="' + esc(st[1]) + '" aria-label="' + esc(st[1]) + '">' +
            (tsu === '?' ? '?' : tsu ? esc(tsu.slice(-3)) : '') + '</button>';
        }
      }
      h += '</div>';
      h += '<span class="small" id="rk-sel">' + (rack.sel ? esc(cellState(pm.map[rack.sel] || null, rack.sel)[1]) : 'Tap a well to see its TSU.') + '</span>';
      if (pm.outside.length) h += '<div class="alert warn"><span>' + pm.outside.length + ' code' + (pm.outside.length === 1 ? '' : 's') + ' fell outside a 96-well layout (' + esc(pm.outside.join(', ')) + '). Check which corner of the photo holds A1, or retake the photo square on.</span></div>';
      h += '<div class="rk-key">' + (rack.phase === 'done'
        ? '<span><i style="border-color:var(--good);background:var(--good-bg)"></i>Checked in</span><span><i style="border-color:#C99700;background:var(--warn-bg)"></i>Already in</span><span><i style="border-color:var(--bad);background:#FBE3DB"></i>Set aside</span>'
        : '<span><i style="border-color:var(--primary)"></i>On this box</span><span><i style="border-color:var(--bad);border-style:dashed"></i>Not on this box</span>') +
        '<span><i style="border-color:#C99700;border-style:dashed"></i>? Unread vial</span><span><i style="border-color:var(--line);background:var(--bg)"></i>Empty well</span></div>';
      h += '<label class="small" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">Well A1 is at the <select id="rk-corner" class="field" style="width:auto;padding:4px 8px;font-size:14px">' +
        Object.keys(CORNERS).map(function (k) { return '<option value="' + k + '"' + (rack.corner === k ? ' selected' : '') + '>' + CORNERS[k] + '</option>'; }).join('') +
        '</select> of the photo</label>';
    }
    if (rack.err && rack.phase === 'preview') h += '<div class="alert bad"><span>' + esc(rack.err) + '</span></div>';
    if (rack.phase === 'preview') h += '<div class="row"><button type="button" class="btn btn-primary" id="rk-go">Check in ' + r.codes.length + ' TSU' + (r.codes.length === 1 ? '' : 's') + '</button>' +
      '<button type="button" class="btn btn-ghost" id="rk-again">Use a different photo</button></div>';
    if (rack.phase === 'saving') h += '<div class="row"><button type="button" class="btn btn-primary" disabled>Checking in ' + r.codes.length + '…</button></div>';
    if (rack.phase === 'done') h += '<div class="row"><button type="button" class="btn btn-ghost btn-sm" id="rk-again">Check in another rack</button></div>';
    box.innerHTML = h;
    wireRack();
  }

  function wireRack() {
    if ($('rk-close')) $('rk-close').onclick = function () { rack = null; renderRack(); $('scan').focus(); };
    if ($('rk-again')) $('rk-again').onclick = function () { $('rack-file').click(); };
    if ($('rk-go')) $('rk-go').onclick = function () { rack.err = ''; checkInRack(); };
    if ($('rk-corner')) $('rk-corner').onchange = function (e) { setCorner(e.target.value); rack.sel = null; renderRack(); };
    Array.prototype.forEach.call($('rack').querySelectorAll('.rk'), function (b) {
      b.onclick = function () { rack.sel = b.getAttribute('data-well'); renderRack(); };
    });
  }

  // ---------------------------------------------------------------- finishing
  $('finish').onclick = function () {
    if ($('finish').disabled) return;
    queue.then(function () {
      var miss = missing(), got = gotCount();
      $('check-title').textContent = 'Check before finishing · ' + got + ' of ' + V.expected.length;
      var items = ['<li>' + got + ' TSU' + (got === 1 ? '' : 's') + ' will be marked Received by <b>' + esc(Staff.name()) + '</b></li>'];
      if (miss.length) items.push('<li><b>' + esc(miss.map(function (e) { return e.tag + ' (' + e.tsu + ')'; }).join(', ')) + '</b> will be marked ' + (V.kind === 'replacement' ? 'still missing' : 'Not received') + '</li>');
      if (needsPaper()) items.push(paper.present ? '<li>Paper consent form recorded (research use: ' + (paper.research === 'Y' ? 'Yes' : 'No') + '); the hold lifts</li>' : '<li>No signed consent form: the samples stay <b>on hold</b></li>');
      extras.forEach(function (x) { items.push('<li>' + esc(x) + '</li>'); });
      $('check-list').innerHTML = items.join('');
      $('commit-err').classList.add('hidden');
      pane('check-pane');
      renderExpected();
    });
  };
  $('back1').onclick = function () { pane('scan-pane'); renderExpected(); $('scan').focus(); };

  $('commit').onclick = function () {
    $('commit').disabled = true; $('commit').textContent = 'Saving…';
    Staff.call('finish', { ref: V.ref, paper: needsPaper() && paper.present ? paper : null }).then(function (d) {
      finished = d; draft = d.draft;
      if (paper.present) V.consent.signed = true;
      $('saved-note').innerHTML = 'Saved on the tracker.' + (d.invoiceId ? ' Invoice <b>' + esc(d.invoiceId) + '</b> is ready for review.' : '') +
        (d.invoiceNote ? '<br><span class="small">Invoice not updated: ' + esc(d.invoiceNote) + '</span>' : '');
      $('m-to').textContent = 'To ' + draft.to;
      $('m-subj').value = draft.subject;
      $('m-body').value = draft.body;
      $('send-err').classList.add('hidden');
      pane('mail-pane');
      renderExpected();
    }).catch(function (e) {
      App.notice($('commit-err'), 'bad', esc(e.message));
    }).then(function () { $('commit').disabled = false; $('commit').textContent = 'Mark received and write the email'; });
  };

  function done(emailed) {
    var got = gotCount(), miss = missing();
    $('done-title').textContent = (V.kind === 'replacement' ? 'Replacement received' : 'Box received') + ' · ' + got + ' of ' + V.expected.length;
    var items = ['<li>' + got + ' TSU' + (got === 1 ? '' : 's') + ' marked Received on the tracker by <b>' + esc(Staff.name()) + '</b></li>'];
    if (miss.length) items.push('<li><b>' + esc(miss.map(function (e) { return e.tag; }).join(', ')) + '</b> marked ' + (V.kind === 'replacement' ? 'still missing' : 'Not received') + '</li>');
    extras.forEach(function (x) { items.push('<li>' + esc(x) + '</li>'); });
    items.push(emailed ? '<li>Emailed ' + esc(draft.to) + ': "' + esc($('m-subj').value) + '"</li>' : '<li>No email was sent to the producer.</li>');
    $('done-list').innerHTML = items.join('');
    pane('done-pane');
  }

  $('send').onclick = function () {
    $('send').disabled = true; $('send').textContent = 'Sending…';
    Staff.call('sendReceipt', { ref: V.ref, subject: $('m-subj').value, body: $('m-body').value }).then(function () {
      done(true);
    }).catch(function (e) {
      App.notice($('send-err'), 'bad', esc(e.message));
    }).then(function () { $('send').disabled = false; $('send').textContent = 'Send email and finish'; });
  };
  $('skip').onclick = function () { done(false); };
  $('reopen').onclick = function () { finished = null; pane('scan-pane'); renderAll(); renderRack(); $('scan').focus(); };
})();
