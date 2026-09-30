/* Producer's private page: progress before results, results after release. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = App.esc, token = App.param('t');
  var link = function (page, extra) { return page + '?t=' + encodeURIComponent(token) + (extra || ''); };
  App.header({ note: 'Private results link · do not share publicly' });
  App.footer();

  var D = null, filter = 'all';
  var ICON_OK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';

  function shortName(n) { return String(n || '').replace(/\s+susceptibility$/i, ''); }
  function sexLabel(s) { return s === 'M' ? 'Male' : s === 'F' ? 'Female' : s; }
  function released() { return D.submission.status === 'Results released' || !!D.submission.released; }
  function webResults(a) { return a.results.filter(function (r) { return r.showOnWeb; }); }

  function parentText(a) {
    if (!a.parentageRequested) return { main: 'Not requested', sub: '', color: 'var(--muted)', bad: false };
    var p = a.parentage;
    if (!p) return { main: 'Pending', sub: '', color: 'var(--muted)', bad: false };
    var bits = [], bad = false;
    [['sire', 'Sire'], ['dam', 'Dam']].forEach(function (x) {
      var r = p[x[0]], who = x[1];
      if (!r || !r.result || r.result === 'Not requested') return;
      if (r.result === 'Confirmed') bits.push(who + ' confirmed' + (r.assigned || r.reported ? ' · ' + (r.reported || r.assigned) : ''));
      else if (r.result === 'Excluded') { bad = true; bits.push('Recorded ' + who.toLowerCase() + ' excluded' + (r.assigned ? ' · matches ' + r.assigned : '')); }
      else if (r.result === 'Not genotyped') bits.push(who + ' not genotyped');
      else bits.push(who + ' ' + r.result.toLowerCase());
    });
    return { main: bits[0] || 'Pending', sub: bits.slice(1).concat(p.notes ? [p.notes] : []).join(' · '), color: bad ? 'var(--bad)' : 'var(--good)', bad: bad };
  }

  function needs(a) {
    return !!a.attention || !!a.replacement || (released() && parentText(a).bad);
  }

  function attnBox(a) {
    if (a.replacement) {
      return '<div class="attn wait"><b>Replacement on its way</b><span>' + (a.replacement.tsu ? 'New TSU <span class="mono">' + esc(a.replacement.tsu) + '</span> · ' : '') +
        'reference ' + esc(a.replacement.id) + '</span><a href="' + link('slip.html', '&r=' + encodeURIComponent(a.replacement.id)) + '">Print the slip</a></div>';
    }
    if (a.attention === 'qc') {
      return '<div class="attn qc"><b>Resample needed</b><span>This TSU failed the lab check. A replacement is free.</span><a href="' + link('replace.html') + '">Send a replacement TSU</a></div>';
    }
    if (a.attention === 'missing') {
      return '<div class="attn missing"><b>Sample not received</b><span>This TSU was on your form but not in your box.</span><a href="' + link('replace.html') + '">Send it now</a></div>';
    }
    return '<div class="attn wait"><b>' + esc(a.stateLabel || 'In progress') + '</b><span>Results will appear here when they are ready.</span></div>';
  }

  function chip(a) {
    var cls = a.attention === 'qc' ? 'c-bad' : a.attention === 'missing' || a.replacement ? 'c-mid' : a.sampleStatus === 'Complete' ? 'c-good' : 'c-none';
    return '<span class="chip ' + cls + '">' + esc(a.replacement ? 'Replacement on its way' : a.stateLabel || 'Waiting') + '</span>';
  }

  // ---------------------------------------------------------------- in progress
  function renderProgress() {
    var s = D.submission, st = s.status;
    var received = !!s.received, atLab = st === 'At lab' || st === 'Analyzing';
    var title = { 'Submitted': 'we\'re waiting for your samples', 'On hold': 'your samples have arrived', 'Received': 'your samples have arrived',
      'At lab': 'your samples are at the lab', 'Analyzing': 'your samples are at the lab' }[st] || 'your submission';
    $('title').textContent = s.flock + ': ' + title;
    $('lead').innerHTML = st === 'Submitted'
      ? 'Print your <a href="' + link('slip.html') + '">packing slip</a> and send your TSUs. We\'ll email you when they arrive.'
      : atLab ? 'Nothing for you to do right now. We will email you when results are ready, and they will appear on this same page.'
      : s.needsSignature ? 'We need your signed consent form before they can go to the genotyping lab.'
      : 'They will go to the genotyping lab in the next batch. We will email you when results are ready.';

    var batch = D.animals.map(function (a) { return a.batch; }).filter(Boolean)[0] || '';
    var steps = [
      { t: 'Form received', s: s.submitted + (s.signed ? ' · signed' + (s.signedDate && s.signedDate !== s.submitted ? ' ' + s.signedDate : '') : ' · not signed yet'), done: true },
      { t: 'Samples received', s: received ? s.receivedCount + ' of ' + s.animalCount + ' TSUs · ' + s.received : 'Send your TSUs by mail or drop off', done: received, now: !received },
      { t: 'At the genotyping lab', s: atLab ? 'Shipped ' + (s.shipped || '') + (batch ? ' · batch ' + batch : '') : received ? 'Goes in the next batch' : '', done: false, now: atLab },
      { t: 'Results ready', s: '', done: false }
    ];
    $('steps').innerHTML = steps.map(function (x, i) {
      var cls = x.done ? 'done' : x.now ? 'now' : 'todo';
      return '<div class="step ' + cls + '"><div class="dotline"><span class="dot">' + (x.done ? ICON_OK : '') + '</span>' + (i < 3 ? '<span class="bar"></span>' : '') + '</div>' +
        '<b>' + esc(x.t) + '</b><span>' + (esc(x.s) || '&nbsp;') + '</span></div>';
    }).join('');
    $('steps').classList.remove('hidden');

    $('rows').innerHTML = '<div class="tbl-head prog-grid"><span>Animal</span><span>EID</span><span>TSU</span><span>Status</span></div>' +
      D.animals.map(function (a) {
        return '<div class="tbl-row prog-grid"><b>' + esc(a.tag || a.eid) + '</b>' +
          '<span class="mono"><span class="cell-l">EID</span>' + esc(a.eid || '—') + '</span>' +
          '<span class="mono"><span class="cell-l">TSU</span>' + esc(a.tsu) + '</span>' +
          '<span>' + chip(a) + '</span></div>';
      }).join('');
  }

  // ---------------------------------------------------------------- results
  function renderResults() {
    var s = D.submission;
    var web = D.conditions.filter(function (c) { return c.showOnWeb; });
    var other = D.conditions.filter(function (c) { return !c.showOnWeb; });
    var webNames = web.map(function (c) { return shortName(c.name); });
    $('title').textContent = s.flock + ' results';
    $('lead').textContent = App.joinList(webNames.concat(['parentage'])).replace(/^./, function (c) { return c.toUpperCase(); }) +
      ' results for ' + s.animalCount + ' ' + (s.breed || 'animals') + ' submitted ' + s.submitted + '.';
    if (s.files.pdf || s.files.excel) {
      $('downloads').classList.remove('hidden');
      $('dl-pdf').classList.toggle('hidden', !s.files.pdf);
      $('dl-xlsx').classList.toggle('hidden', !s.files.excel);
    }

    var done = D.animals.filter(function (a) { return a.results.length; }).length;
    // Animals whose replacement is on its way still count here until it has results
    var qc = D.animals.filter(function (a) { return !a.results.length && (a.attention === 'qc' || (a.replacement && a.replacement.reason === 'Failed QC')); }).length;
    var miss = D.animals.filter(function (a) { return !a.results.length && (a.attention === 'missing' || (a.replacement && a.replacement.reason === 'Not received')); }).length;
    var tiles = [['Animals submitted', s.animalCount], ['Results complete', done], ['Resample needed', qc], ['Sample not received', miss]];
    $('stats').innerHTML = tiles.map(function (t) { return '<div class="stat"><span>' + t[0] + '</span><b>' + t[1] + '</b></div>'; }).join('');
    $('stats').classList.remove('hidden');

    if (other.length) {
      $('other-conds').innerHTML = '<div class="stack-s" style="flex:1"><b>Results for other conditions are in your full report</b><span class="small">This page shows ' +
        esc(App.joinList(webNames.concat(['parentage']))) + '. ' + esc(App.joinList(other.map(function (c) { return c.name; }))) +
        (other.length > 1 ? ' are' : ' is') + ' in the PDF report and the Excel file.</span></div>' +
        (s.files.pdf ? '<button type="button" class="btn btn-ghost btn-sm dl" id="dl-pdf2">Open full report (PDF)</button>' : '');
      $('other-conds').classList.remove('hidden');
      if ($('dl-pdf2')) $('dl-pdf2').onclick = function () { download('pdf'); };
    }

    // filters
    var batches = [];
    D.animals.forEach(function (a) { if (a.batch && batches.indexOf(a.batch) < 0) batches.push(a.batch); });
    batches.sort();
    var tests = { all: function () { return true; }, attention: needs };
    batches.forEach(function (b) { tests[b] = function (a) { return a.batch === b; }; });
    var labels = [['all', 'All animals']].concat(batches.length > 1 ? batches.map(function (b) { return [b, 'Batch ' + b]; }) : []).concat([['attention', 'Needs attention']]);
    var shown = D.animals.filter(tests[filter] || tests.all);
    $('filters').innerHTML = '<div class="row" role="group" aria-label="Filter animals" style="gap:8px">' + labels.map(function (l) {
      return '<button type="button" class="pill" data-f="' + esc(l[0]) + '" aria-pressed="' + (filter === l[0]) + '">' + esc(l[1]) + '<small>' + D.animals.filter(tests[l[0]]).length + '</small></button>';
    }).join('') + '</div><span class="small muted">Showing ' + shown.length + ' of ' + D.animals.length + '</span>';
    $('filters').classList.remove('hidden');
    Array.prototype.forEach.call($('filters').querySelectorAll('.pill'), function (b) {
      b.onclick = function () { filter = b.getAttribute('data-f'); renderResults(); };
    });

    $('rows').innerHTML = '<div class="tbl-head res-grid"><span>Animal</span><span>EID / NSIP ID</span><span>Batch</span><span>' +
      esc(webNames.join(' · ') || 'Results') + '</span><span>Parentage</span></div>' +
      (shown.length ? '' : '<div class="tbl-row"><span class="muted">No animals match this filter.</span></div>') +
      shown.map(function (a) {
        var head = '<div class="stack-s"><b style="font-size:16px">' + esc(a.tag || a.eid) + '</b><span class="small muted">' + esc([sexLabel(a.sex), a.born].filter(Boolean).join(' · ')) + '</span></div>' +
          '<div class="stack-s"><span class="mono small">' + esc(a.eid || '—') + '</span><span class="mono small muted">' + esc(a.nsip || 'Not NSIP-enrolled') + '</span></div>' +
          '<span class="mono small"><span class="cell-l">Batch</span>' + esc(a.batch || '—') + '</span>';
        var res = webResults(a);
        if (!res.length) return '<div class="tbl-row res-grid">' + head + '<div class="span2">' + attnBox(a) + '</div></div>';
        var conds = res.map(function (r) {
          var label = r.call && r.call !== r.genotype ? r.call + ' · ' + r.label : r.label || r.call;
          return '<div class="cond"><span class="cond-name">' + esc(shortName(r.name)) + '</span><span class="' + App.chipClass(r.category) + '">' + esc(label) + '</span><span class="mono small muted">' + esc(r.genotype) + '</span></div>';
        }).join('');
        var p = parentText(a);
        return '<div class="tbl-row res-grid">' + head + '<div class="stack-s">' + conds + '</div>' +
          '<div class="stack-s"><span class="cell-l">Parentage</span><span style="font-weight:600;color:' + p.color + '">' + esc(p.main) + '</span>' +
          (p.sub ? '<span class="small muted">' + esc(p.sub) + '</span>' : '') + '</div></div>';
      }).join('');

    var blocks = web.map(function (c) { return '<div><h3>' + esc(c.name) + '</h3><p>' + esc(c.explanation) + '</p></div>'; });
    blocks.push('<div><h3>Parentage</h3><p>Each lamb is compared with the genotyped rams and ewes you have submitted. A parent can only be confirmed if it has been genotyped. "Excluded" means the recorded parent does not match the lamb\'s DNA.</p></div>');
    blocks.push('<div><h3>' + (other.length ? 'Other conditions' : 'Your report files') + '</h3><p>' + (other.length ? 'Results for all other conditions tested are in your full report, with an explanation of each. ' : '') +
      'The Excel file has every result on one sheet you can sort, filter or add to your flock records, and a second sheet explaining each test.</p></div>');
    $('meaning-body').innerHTML = blocks.join('');
    $('meaning').classList.remove('hidden');
  }

  // ---------------------------------------------------------------- shared banners
  function renderBanners() {
    var s = D.submission;
    if (s.needsSignature) {
      $('sig-banner').innerHTML = '<div class="stack-s" style="flex:1"><b>Action needed: sign your consent form</b><span>' +
        (s.received ? 'Your samples arrived without a signed consent form, so they can\'t go to the lab yet. Sign online in a minute, or mail us the paper form.'
          : 'We need a signed consent form before your samples can go to the lab. Sign online now, or put the signed paper form in your box.') +
        '</span></div><a class="btn btn-primary btn-sm" href="' + link('sign.html') + '">Sign now</a>';
      $('sig-banner').classList.remove('hidden');
    }
    var attn = D.animals.filter(function (a) { return a.attention; });
    if (attn.length) {
      var qc = attn.filter(function (a) { return a.attention === 'qc'; }).length;
      $('attn-banner').className = 'alert ' + (qc ? 'bad' : 'warn');
      $('attn-banner').innerHTML = '<div class="stack-s" style="flex:1"><b>' + attn.length + (attn.length === 1 ? ' animal needs' : ' animals need') + ' a sample</b><span>' +
        esc(App.joinList(attn.map(function (a) { return a.tag || a.eid; }))) + ': ' +
        (qc ? 'replacements for samples that failed the lab check are free.' : 'these TSUs were on your form but not in your box.') +
        '</span></div><a class="btn btn-primary btn-sm" href="' + link('replace.html') + '">Send replacement TSUs</a>';
    }
    var open = D.replacements.filter(function (r) { return r.items.some(function (i) { return !i.received; }); });
    if (open.length) {
      $('repl-banner').className = 'alert info';
      $('repl-banner').innerHTML = '<div class="stack-s" style="flex:1">' + open.map(function (r) {
        return '<span><b>Replacement ' + esc(r.id) + '</b> registered ' + esc(r.requested) + ': ' + esc(App.joinList(r.items.map(function (i) { return i.tag; }))) +
          '. <a href="' + link('slip.html', '&r=' + encodeURIComponent(r.id)) + '">Print the slip</a></span>';
      }).join('') + '<span class="small">We\'ll email you when it arrives.</span></div>';
    }
  }

  function download(kind) {
    var btn = kind === 'excel' ? $('dl-xlsx') : $('dl-pdf');
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparing…';
    App.api('download', { token: token, kind: kind }).then(function (d) {
      App.downloadBase64(d.name, d.mime, d.base64);
    }).catch(function (e) {
      App.notice($('dl-msg'), 'bad', esc(e.message));
    }).then(function () { btn.disabled = false; btn.textContent = label; });
  }
  $('dl-pdf').onclick = function () { download('pdf'); };
  $('dl-xlsx').onclick = function () { download('excel'); };

  if (!token) {
    $('loading').classList.add('hidden');
    App.notice($('load-error'), 'bad', 'This page needs the private link from your email. Please open the link in the email we sent you.');
    return;
  }
  App.api('status', { token: token }).then(function (d) {
    D = d;
    var s = d.submission;
    document.title = s.flock + ' · ' + s.id + ' · MSU Sheep Genotyping';
    $('eyebrow').textContent = 'Submission ' + s.id + ' · ' + s.animalCount + ' ' + (s.breed || 'animals') + (s.released ? ' · results released ' + s.released : '');
    renderBanners();
    if (released()) renderResults(); else renderProgress();
    $('loading').classList.add('hidden');
    $('view').classList.remove('hidden');
  }).catch(function (e) {
    $('loading').classList.add('hidden');
    App.notice($('load-error'), 'bad', esc(e.message));
  });
})();
