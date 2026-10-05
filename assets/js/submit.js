/* Submission page: read the Excel form in the browser, check it, sign, submit, then upload photos. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = App.esc;
  App.header({ note: 'Questions? <a href="#help">Contact us</a>' });
  App.footer();

  var state = { parsed: null, check: null, fileB64: '', method: 'online', research: '', photos: {}, busy: false };

  App.config().then(function (c) {
    if (c.blankForm) $('blank-form').href = c.blankForm;
    if (c.paperForm) { $('paper-link').href = c.paperForm; $('consent-link').href = c.paperForm; }
    $('help').innerHTML = 'Email: ' + esc(c.contactEmail || 'christian.posbergh@montana.edu') + '<br>Office: ' + esc(c.contactPhone || '406-994-3736');
    $('mail-to').innerHTML = App.addressHtml(c.mailingAddress || 'MSU Sheep Genotyping, 311 Animal Biosciences Building, Bozeman, MT 59717');
    $('drop-at').innerHTML = App.mapsLink(c.dropoffLocation) + '<br><span class="small muted">' + esc(c.dropoffHours || '') + '</span>';
  });

  function pills(n) {
    Array.prototype.forEach.call($('pills').children, function (el, i) { el.className = i < n ? 'done' : i === n ? 'on' : ''; });
  }
  pills(0);

  // ---------------------------------------------------------------- reading the file
  function sheetRows(wb, pick) {
    var name = wb.SheetNames.filter(pick)[0];
    if (!name) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
  }

  function readFile(file) {
    var msg = $('read-msg');
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { App.notice(msg, 'bad', 'Please choose the Excel submission form (.xlsx). If you saved it as another type, open it in Excel and use File > Save As > Excel Workbook.'); return; }
    if (file.size > 5 * 1024 * 1024) { App.notice(msg, 'bad', 'That file is larger than a submission form should be (over 5 MB).'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var buf = new Uint8Array(reader.result);
      var wb;
      try { wb = XLSX.read(buf, { type: 'array' }); } catch (e) { App.notice(msg, 'bad', 'That file could not be read as an Excel workbook.'); return; }
      var subRows = sheetRows(wb, function (n) { return /submitter/i.test(n); }) || [];
      var aniRows = sheetRows(wb, function (n) { return /animal/i.test(n); });
      if (!aniRows) { App.notice(msg, 'bad', 'This file has no Animals tab. Please use the MSU Sheep Genotyping submission form.'); return; }
      var map = mapAnimalHeaders(aniRows[0] || []);
      var needed = ['tsu', 'yob', 'breed', 'sex'].filter(function (f) { return !map.cols.some(function (c) { return c.field === f; }); });
      if (needed.length) { App.notice(msg, 'bad', 'The Animals tab is missing columns: ' + needed.map(function (f) { return FORM_RULES.labels[f]; }).join(', ') + '. Please use the current submission form.'); return; }
      var animals = [];
      for (var i = 1; i < aniRows.length; i++) { var a = mapAnimalRow(map, aniRows[i], i + 1); if (a) animals.push(a); }
      state.parsed = { submitter: mapSubmitter(subRows), animals: animals, fileName: file.name };
      var b = ''; for (var j = 0; j < buf.length; j += 0x8000) b += String.fromCharCode.apply(null, buf.subarray(j, j + 0x8000));
      state.fileB64 = btoa(b);
      state.photos = {};
      state.requestId = App.newId();      // same id if Submit is pressed again for this file: never a duplicate
      msg.classList.add('hidden');
      showReview();
    };
    reader.readAsArrayBuffer(file);
  }

  $('file').addEventListener('change', function (e) { readFile(e.target.files[0]); e.target.value = ''; });
  ['dragover', 'dragenter'].forEach(function (t) { $('drop').addEventListener(t, function (e) { e.preventDefault(); $('drop').classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { $('drop').addEventListener(t, function () { $('drop').classList.remove('over'); }); });
  $('drop').addEventListener('drop', function (e) { e.preventDefault(); readFile(e.dataTransfer.files[0]); });

  // ---------------------------------------------------------------- review
  function showReview() {
    var p = state.parsed;
    var c = state.check = validateSubmission(p.submitter, p.animals, new Date().getFullYear());
    $('choose').classList.add('hidden');
    $('review').classList.remove('hidden');
    $('file-name').textContent = p.fileName;
    $('sum-flock').textContent = c.submitter.flock || '(no flock name)';
    $('sum-contact').textContent = c.submitter.name || '';
    var breeds = []; c.animals.forEach(function (a) { if (a.breed && breeds.indexOf(a.breed) < 0) breeds.push(a.breed); });
    $('sum-animals').textContent = c.animals.length + ' ' + (breeds.join(', ') || 'animals');
    var nsip = c.animals.filter(function (a) { return a.nsipId; }).length;
    $('sum-nsip').textContent = nsip ? nsip + ' NSIP-enrolled' : 'None NSIP-enrolled';
    $('sum-email').textContent = c.submitter.email ? 'Results to ' + c.submitter.email : '';
    showErrors(c.errors);
    if (c.warnings.length) App.notice($('warnings'), 'info', esc(c.warnings.join(' ')));
    else $('warnings').classList.add('hidden');
    renderAnimals();
    pills(c.errors.length ? 1 : 2);
    refresh();
  }

  function showErrors(errors) {
    var el = $('errors');
    if (!errors || !errors.length) { el.classList.add('hidden'); return; }
    var items = errors.slice(0, 40).map(function (e) {
      return '<li>' + (e.row ? '<b>Row ' + e.row + '</b> · ' : '') + esc(e.message) + '</li>';
    }).join('');
    App.notice(el, 'bad', '<div class="stack-s"><b>' + errors.length + ' thing' + (errors.length > 1 ? 's' : '') +
      ' to fix before submitting.</b> Fix them in Excel, save, and choose the file again.<ul class="errlist">' + items + '</ul>' +
      (errors.length > 40 ? '<span>…and ' + (errors.length - 40) + ' more.</span>' : '') + '</div>');
  }

  function photosOn() { return state.method === 'online' && state.research === 'Y'; }

  function renderAnimals() {
    var on = photosOn();
    $('animal-rows').innerHTML = state.check.animals.map(function (a, i) {
      var n = (state.photos[i] || []).length;
      var btn = on ? '<label class="btn btn-ghost btn-sm" style="' + (n >= 5 ? 'opacity:.5;pointer-events:none' : '') + '">+ Photo<input type="file" accept="image/*" multiple class="sr" data-i="' + i + '"></label> <span class="photo-count" style="color:' + (n ? 'var(--good)' : 'var(--muted)') + '">' + n + '/5</span>' : '<span class="small muted">—</span>';
      return '<div class="tbl-row animal-grid" style="padding:8px 0;font-size:14px"><b>' + esc(a.flockTag || '—') + '</b><span class="mono small opt">' + esc(a.eid) +
        '</span><span class="mono small">' + esc(a.tsu) + '</span><span class="opt">' + esc(a.sex) + '</span><span class="opt">' + esc(a.yob) + '</span><span class="opt">' + esc(a.breed) +
        '</span><span class="opt">' + btn + '</span></div>';
    }).join('');
    Array.prototype.forEach.call($('animal-rows').querySelectorAll('input[type=file]'), function (inp) {
      inp.addEventListener('change', function () { addPhotos(Number(inp.dataset.i), inp.files); });
    });
  }

  function addPhotos(i, files) {
    var list = state.photos[i] || (state.photos[i] = []);
    Array.prototype.forEach.call(files, function (f) { if (list.length < 5 && /^image\//.test(f.type)) list.push(f); });
    renderAnimals(); refresh();
  }

  function matchBatch(files) {
    var tags = state.check.animals.map(function (a) { return String(a.flockTag || a.eid).toUpperCase(); });
    var unmatched = [];
    Array.prototype.forEach.call(files, function (f) {
      var base = f.name.replace(/\.[^.]+$/, '').toUpperCase().replace(/[-_ ]\d{1,2}$/, '');
      var i = tags.indexOf(base);
      if (i < 0) unmatched.push(f.name); else addPhotos(i, [f]);
    });
    if (unmatched.length) $('photo-note').textContent = 'No animal matched: ' + unmatched.slice(0, 8).join(', ') + (unmatched.length > 8 ? '…' : '') + '. Name photos by tag, like J01.jpg or J01-2.jpg.';
  }
  $('photo-batch').addEventListener('change', function (e) { if (photosOn()) matchBatch(e.target.files); e.target.value = ''; });
  $('photo-drop').addEventListener('dragover', function (e) { e.preventDefault(); });
  $('photo-drop').addEventListener('drop', function (e) { e.preventDefault(); if (photosOn()) matchBatch(e.dataTransfer.files); });

  // ---------------------------------------------------------------- consent
  function press(id, on) { $(id).setAttribute('aria-pressed', on ? 'true' : 'false'); }
  $('m-online').onclick = function () { state.method = 'online'; renderAnimals(); refresh(); };
  $('m-paper').onclick = function () { state.method = 'paper'; renderAnimals(); refresh(); };
  $('r-y').onclick = function () { state.research = 'Y'; renderAnimals(); refresh(); };
  $('r-n').onclick = function () { state.research = 'N'; renderAnimals(); refresh(); };
  ['agree', 'paper-ack'].forEach(function (id) { $(id).addEventListener('change', refresh); });
  $('signer').addEventListener('input', refresh);

  function photoCount() { return Object.keys(state.photos).reduce(function (t, k) { return t + state.photos[k].length; }, 0); }

  function refresh() {
    var paper = state.method === 'paper';
    press('m-online', !paper); press('m-paper', paper);
    press('r-y', state.research === 'Y'); press('r-n', state.research === 'N');
    $('online-part').classList.toggle('hidden', paper);
    $('paper-part').classList.toggle('hidden', !paper);
    $('photo-drop').style.opacity = photosOn() ? '1' : '.5';
    $('photo-note').textContent = paper ? 'Photos can only be added when you sign online, since the research answer on a paper form isn\'t known until your box arrives.'
      : state.research === 'Y' ? 'Photos are kept for research because you allowed MSU research use above.'
      : state.research === 'N' ? 'You chose no research use above, so photos won\'t be kept.' : 'Photos are only kept if you allow MSU research use above.';
    if (!photosOn()) state.photos = {};
    var c = state.check;
    var missing = [];
    if (c && c.errors.length) missing.push('fix the form');
    if (paper) { if (!$('paper-ack').checked) missing.push('tick that you\'ll put the signed consent form in your box'); }
    else {
      if (!state.research) missing.push('answer the research question');
      if (!$('agree').checked) missing.push('tick "I agree"');
      if (!$('signer').value.trim()) missing.push('type your name');
    }
    var n = c ? c.animals.length : 0, ph = photoCount();
    var btn = $('submit');
    btn.textContent = 'Submit ' + n + ' animal' + (n === 1 ? '' : 's') + (ph ? ' and ' + ph + ' photo' + (ph === 1 ? '' : 's') : '');
    btn.disabled = state.busy || missing.length > 0;
    $('submit-msg').textContent = missing.length ? 'To submit, ' + App.joinList(missing) + '.' + (paper ? '' : ' Or choose the paper form above.') : '';
  }

  // ---------------------------------------------------------------- submit
  $('submit').onclick = function () {
    if (state.busy) return;
    state.busy = true; refresh();
    $('submit').textContent = 'Submitting…';
    $('submit-error').classList.add('hidden');
    var paper = state.method === 'paper';
    App.api('submit', {
      requestId: state.requestId,
      submitter: state.parsed.submitter, animals: state.parsed.animals, notes: $('notes').value, website: $('website').value,
      signature: paper ? { method: 'paper', paperAck: $('paper-ack').checked }
        : { method: 'online', research: state.research, agree: $('agree').checked, name: $('signer').value.trim() },
      form: { name: state.parsed.fileName, base64: state.fileB64 }
    }).then(done, function (err) {
      state.busy = false; refresh();
      if (err.details) { showErrors(err.details); $('errors').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      var box = $('submit-error');
      box.classList.remove('hidden');
      box.innerHTML = '<div class="alert bad"><span>' + (err.transport
        ? '<b>We couldn\'t confirm your submission.</b> ' + esc(err.message) + ' It may still have been saved: check your email for a ' +
          'confirmation with your packing slip link. If nothing arrives in a few minutes, press Submit again. It is safe: the same form won\'t be entered twice.'
        : esc(err.message)) + '</span></div>';
    });
  };

  function done(r) {
    pills(3);
    $('review').classList.add('hidden');
    $('done').classList.remove('hidden');
    $('done-title').textContent = 'Submitted. Your reference is ' + r.submissionId;
    $('done-sub').textContent = r.emailed ? 'A confirmation and your private link are on their way to ' + r.email + '.' : 'We couldn\'t send the confirmation email just now; your private link is below, please keep it.';
    var base = location.href.replace(/[^/]*(\?.*)?$/, '');
    $('slip-link').href = base + 'slip.html?t=' + encodeURIComponent(r.token);
    $('status-link').href = base + 'status.html?t=' + encodeURIComponent(r.token);
    if (state.method === 'paper') {
      $('consent-link').classList.remove('hidden');
      $('pack-label').textContent = 'Print the packing slip and the consent form, and put both in the box';
    }
    $('send-label').textContent = 'Send your ' + state.check.animals.length + ' TSUs to us, by mail or in person';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    uploadPhotos(r);
  }

  // ---------------------------------------------------------------- photos after submit
  function resize(file) {
    return createImageBitmap(file).then(function (img) {
      var scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    }).catch(function () {
      // The browser can't decode it (some phone formats): send the original if it is small enough
      if (file.size > 6 * 1024 * 1024) throw new Error('too large');
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res(String(r.result).split(',')[1]); };
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    });
  }

  function uploadPhotos(r) {
    var jobs = [];
    state.check.animals.forEach(function (a, i) {
      (state.photos[i] || []).forEach(function (f) { jobs.push({ key: r.animalKeys[a.row], file: f, tag: a.flockTag || a.eid }); });
    });
    if (!jobs.length || !r.photosAllowed) return;
    var box = $('photo-progress'), doneN = 0, failed = [];
    box.classList.remove('hidden');
    var show = function () {
      App.notice(box, failed.length ? 'warn' : 'info', 'Uploading photos: ' + doneN + ' of ' + jobs.length + (failed.length ? '. Not uploaded: ' + esc(failed.join(', ')) + ' (you can email them to us).' : '') +
        (doneN + failed.length === jobs.length ? '' : ' Please keep this page open.'));
    };
    show();
    jobs.reduce(function (p, j) {
      return p.then(function () {
        return resize(j.file).then(function (b64) { return App.api('uploadPhoto', { token: r.token, animalKey: j.key, data: b64 }); })
          .then(function () { doneN++; show(); }, function () { failed.push(j.tag + ' ' + j.file.name); show(); });
      });
    }, Promise.resolve()).then(function () {
      if (!failed.length) App.notice(box, 'good', 'All ' + jobs.length + ' photos uploaded. Thank you!');
    });
  }
})();
