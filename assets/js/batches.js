/* Batches: choose ready samples, create the batch, fill GenomNZ's template in the browser, save a copy to
   Drive, then mark it shipped (or cancel it). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = App.esc;
  var TEMPLATE = '../assets/templates/GenomNZ_Animal_Info_Template.xlsx';
  App.footer();

  var ready = { groups: [], onHold: [] }, off = {}, current = null, birthFlock = 'Montana State University', lastFile = null;

  function todayIso() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function panes(id) { ['new-pane', 'made-pane', 'shipped-pane'].forEach(function (x) { $(x).classList.toggle('hidden', x !== id); }); }

  Staff.gate('batches', function () {
    App.config().then(function (c) { if (c.birthFlock) { birthFlock = c.birthFlock; $('bf').textContent = c.birthFlock; } });
    load();
  });

  function load() {
    Staff.call('ready').then(function (d) { ready = d; renderGroups(); }).catch(function (e) { App.notice($('page-msg'), 'bad', esc(e.message)); });
    loadHistory();
  }

  function loadHistory() {
    Staff.call('batches').then(function (d) { renderHistory(d.batches); }).catch(function () {});
  }

  // ---------------------------------------------------------------- ready list
  function selected() { return ready.groups.filter(function (g) { return !off[g.submissionId]; }); }

  function renderGroups() {
    var locked = !$('new-pane').classList.contains('hidden') ? false : true;
    var rows = ready.groups.map(function (g) {
      var reps = g.animals.filter(function (a) { return a.replacement; }).length;
      var on = !off[g.submissionId];
      var note = reps === g.animals.length ? 'Replacements: ' + g.animals.map(function (a) { return a.tag; }).join(', ')
        : g.animals.length + ' TSU' + (g.animals.length === 1 ? '' : 's') + (reps ? ' · includes ' + reps + ' replacement' + (reps === 1 ? '' : 's') : '');
      return '<label class="pick' + (locked ? ' off' : '') + '"><input type="checkbox" data-id="' + esc(g.submissionId) + '"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') +
        ' aria-label="Include ' + esc(g.submissionId) + ' in the batch"><span class="stack-s"><span class="row" style="gap:8px"><b class="mono">' + esc(g.submissionId) + '</b><span>' + esc(g.flock) +
        '</span><span class="tag ' + (reps === g.animals.length ? 'tag-rep">Replacement' : 'tag-sub">Submission') + '</span></span><span class="small muted">' + esc(note) + '</span></span>' +
        '<b>' + g.animals.length + '</b><span class="small opt">' + esc(g.received) + '</span></label>';
    });
    ready.onHold.forEach(function (h) {
      rows.push('<div class="pick off"><input type="checkbox" disabled aria-label="' + esc(h.submissionId) + ' is on hold"><span class="stack-s"><span class="row" style="gap:8px"><b class="mono">' + esc(h.submissionId) +
        '</b><span>' + esc(h.flock) + '</span><span class="tag tag-hold">On hold: not signed</span></span><span class="small muted">Waiting for the producer to sign.' +
        (h.lastReminder ? ' Reminder sent ' + esc(h.lastReminder) + '.' : '') + '</span></span><span></span><span class="small opt">' + esc(h.received) + '</span></div>');
    });
    $('groups').innerHTML = rows.length ? rows.join('') : '<div class="section muted">Nothing is ready to ship. Samples appear here once they are received and signed.</div>';
    Array.prototype.forEach.call($('groups').querySelectorAll('input[data-id]'), function (el) {
      el.onchange = function () { off[el.dataset.id] = !el.checked; renderSel(); };
    });
    renderSel();
  }

  function renderSel() {
    var sel = selected(), n = sel.reduce(function (a, g) { return a + g.animals.length; }, 0);
    $('sel').innerHTML = n ? '<b>' + n + ' TSU' + (n === 1 ? '' : 's') + '</b> from ' + (sel.length === 1 ? '1 submission' : sel.length + ' submissions') : 'Tick the submissions going in this box.';
    $('create').disabled = !n;
  }

  // ---------------------------------------------------------------- make and save the file
  var templatePromise = null;
  function template() {
    if (!templatePromise) templatePromise = fetch(TEMPLATE).then(function (r) { if (!r.ok) throw new Error('The GenomNZ template file is missing from the website.'); return r.arrayBuffer(); });
    return templatePromise;
  }

  function makeFile(batchId, rows, flock) {
    return template().then(function (buf) {
      return GenomNZExport.fill(ExcelJS, buf, rows, { birthFlock: flock || birthFlock });
    }).then(function (out) {
      var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      lastFile = { name: batchId + '_GenomNZ.xlsx', blob: blob };
      App.downloadBlob(lastFile.name, blob);
      return blob;
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  $('create').onclick = function () {
    var sel = selected();
    var animals = [];
    sel.forEach(function (g) { g.animals.forEach(function (a) { animals.push(a); }); });
    var rows = animals.map(function (a) { return { animalKey: a.key, yob: a.yob, breed: a.breed, sex: a.sex, tsu: a.tsu }; });
    try { GenomNZExport.prepareRows(rows); } catch (e) {
      App.notice($('create-err'), 'bad', '<div class="stack-s"><b>Fix these on the tracker first:</b><span>' + esc((e.problems || [e.message]).join('; ')) + '</span></div>');
      return;
    }
    $('create-err').classList.add('hidden');
    $('create').disabled = true; $('create').textContent = 'Creating…';
    Staff.call('createBatch', { keys: animals.map(function (a) { return a.key; }) }).then(function (d) {
      current = { id: d.batchId, rows: d.rows, n: d.rows.length, subs: sel.map(function (g) { return g.submissionId; }) };
      showMade(d.batchId, d.rows, 'Downloading…');
      return makeFile(d.batchId, d.rows, d.birthFlock).then(blobToBase64).then(function (b64) {
        $('file-note').textContent = 'Downloaded · saving a copy to the batch in Drive…';
        return Staff.call('saveBatchFile', { batchId: d.batchId, base64: b64 });
      }).then(function () {
        $('file-note').textContent = 'Downloaded · also saved to the batch in Drive';
      }).catch(function (e) {
        $('file-note').textContent = 'The batch was created, but: ' + e.message + ' Use Download again.';
      });
    }).catch(function (e) {
      App.notice($('create-err'), 'bad', esc(e.message));
    }).then(function () { $('create').textContent = 'Create batch and download GenomNZ file'; renderSel(); loadHistory(); });
  };

  function showMade(id, rows, note) {
    panes('made-pane');
    $('made-title').textContent = id + ' · ' + rows.length + ' TSU' + (rows.length === 1 ? '' : 's');
    $('file-name').textContent = id + '_GenomNZ.xlsx';
    $('file-note').textContent = note || '';
    $('preview').innerHTML = '<div class="prev h"><span>Birth Flock</span><span>Birth Tag</span><span>YOB</span><span>Breed</span><span>Sex</span><span>TSU</span></div>' +
      rows.slice(0, 5).map(function (r) {
        return '<div class="prev"><span>' + esc(birthFlock) + '</span><span class="mono">' + esc(r.animalKey) + '</span><span>' + esc(GenomNZExport.earliestYear(r.yob)) + '</span><span>' +
          esc(String(r.breed).toUpperCase()) + '</span><span>' + esc(r.sex) + '</span><span class="mono">' + esc(r.tsu) + '</span></div>';
      }).join('') + (rows.length > 5 ? '<div class="prev"><span class="muted" style="grid-column:1/-1">…and ' + (rows.length - 5) + ' more</span></div>' : '');
    $('shipdate').value = todayIso();
    $('made-err').classList.add('hidden');
    renderGroups();
  }

  $('again').onclick = function () {
    if (lastFile && current && lastFile.name.indexOf(current.id) === 0) { App.downloadBlob(lastFile.name, lastFile.blob); return; }
    redownload(current.id);
  };

  function redownload(id) {
    return Staff.call('batchRows', { batchId: id }).then(function (d) { return makeFile(d.batchId, d.rows, d.birthFlock); })
      .catch(function (e) { App.notice($('page-msg'), 'bad', esc(e.message)); });
  }

  $('ship').onclick = function () {
    if (!current) return;
    $('ship').disabled = true; $('ship').textContent = 'Saving…';
    Staff.call('markShipped', { batchId: current.id, shipDate: $('shipdate').value }).then(function (d) {
      panes('shipped-pane');
      var dt = new Date($('shipdate').value + 'T12:00:00');
      $('shipped-title').textContent = d.batchId + ' shipped ' + dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      $('shipped-list').innerHTML = '<li>' + current.n + ' samples marked At lab with batch ' + esc(d.batchId) + '</li>' +
        '<li>' + d.submissions + ' submission' + (d.submissions === 1 ? '' : 's') + ' moved to At lab on their status pages</li>' +
        '<li>' + d.emailed + ' producer email' + (d.emailed === 1 ? '' : 's') + ' sent' + (d.failed.length ? '; not sent for ' + esc(d.failed.join(', ')) + ' (check the Email_Log)' : '') + '</li>' +
        '<li>Shipped by ' + esc(Staff.name()) + '</li>';
      current = null;
      load();
    }).catch(function (e) {
      App.notice($('made-err'), 'bad', esc(e.message));
    }).then(function () { $('ship').disabled = false; $('ship').textContent = 'Mark as shipped'; });
  };

  $('cancel').onclick = function () {
    if (!current || !confirm('Cancel ' + current.id + '? Its samples go back to Ready to ship. Throw away the GenomNZ file you downloaded.')) return;
    Staff.call('cancelBatch', { batchId: current.id }).then(function () {
      current = null; off = {};
      panes('new-pane');
      load();
    }).catch(function (e) { App.notice($('made-err'), 'bad', esc(e.message)); });
  };

  $('restart').onclick = function () { off = {}; panes('new-pane'); renderGroups(); };

  // ---------------------------------------------------------------- history
  function renderHistory(list) {
    var cls = { Building: 'st-build', Shipped: 'st-ship', 'Results in': 'st-done', Cancelled: 'st-cancel' };
    $('history').innerHTML = list.length ? list.map(function (b) {
      var status = b.resultsIn && b.status !== 'Cancelled' ? 'Results in' : b.status;
      return '<div class="hist"><span class="mono">' + esc(b.id) + '</span><span><span class="st ' + (cls[status] || 'st-wait') + '">' + esc(status) + '</span></span>' +
        '<span class="opt">' + esc(b.createdBy) + '</span><span class="opt">' + esc(b.shipped) + '</span><span class="opt">' + b.samples + '</span><span class="opt">' + esc(b.resultsIn) + '</span>' +
        '<span class="opt">' + (b.status === 'Cancelled' ? '' : '<button type="button" class="linkbtn mono" data-dl="' + esc(b.id) + '" style="font-size:13px">' + esc(b.id) + '_GenomNZ.xlsx</button>') +
        (b.status === 'Building' ? ' <button type="button" class="linkbtn" data-open="' + esc(b.id) + '" style="font-size:13px">Open</button>' : '') + '</span></div>';
    }).join('') : '<div class="section muted">No batches yet.</div>';
    Array.prototype.forEach.call($('history').querySelectorAll('[data-dl]'), function (el) {
      el.onclick = function () { redownload(el.dataset.dl); };
    });
    Array.prototype.forEach.call($('history').querySelectorAll('[data-open]'), function (el) {
      el.onclick = function () {
        Staff.call('batchRows', { batchId: el.dataset.open }).then(function (d) {
          current = { id: d.batchId, rows: d.rows, n: d.rows.length };
          showMade(d.batchId, d.rows, 'Created earlier. Download again if you need the file.');
          window.scrollTo(0, 0);
        });
      };
    });
  }
})();
