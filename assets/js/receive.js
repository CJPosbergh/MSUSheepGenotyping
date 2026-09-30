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
    $('finish').disabled = busy || need;
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
  $('reopen').onclick = function () { finished = null; pane('scan-pane'); renderAll(); $('scan').focus(); };
})();
