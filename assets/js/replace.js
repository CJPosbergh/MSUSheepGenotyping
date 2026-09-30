/* Register replacement TSUs for animals that failed the lab check or were missing from the box. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = App.esc, token = App.param('t');
  var statusUrl = 'status.html?t=' + encodeURIComponent(token);
  App.header({ note: '<a href="' + statusUrl + '">Back to your results</a>' });
  App.footer();
  Array.prototype.forEach.call(document.querySelectorAll('.back'), function (a) { a.href = statusUrl; });

  var items = [], busy = false;

  App.config().then(function (c) {
    $('help').innerHTML = esc(c.contactEmail || 'christian.posbergh@montana.edu') + '<br>' + esc(c.contactPhone || '406-994-3736');
    $('where').innerHTML = esc(c.mailingAddress || '') + ', or ' + App.mapsLink(c.dropoffLocation) + (c.dropoffHours ? ' (' + esc(c.dropoffHours) + ')' : '') + '.';
  });

  function sexLabel(s) { return s === 'M' ? 'Male' : s === 'F' ? 'Female' : s; }
  function norm(v) { return String(v || '').replace(/\s/g, '').toUpperCase(); }

  function render() {
    $('animals').innerHTML = items.map(function (it, i) {
      var a = it.a, tag = a.tag || a.eid, qc = a.attention === 'qc';
      var info = [sexLabel(a.sex), a.born, a.eid ? 'EID ' + a.eid : ''].filter(Boolean).join(' · ');
      var body = qc
        ? 'The sample in TSU <span class="mono">' + esc(a.tsu) + '</span> couldn\'t be genotyped. Take a new TSU from this animal.'
        : 'TSU <span class="mono">' + esc(a.tsu) + '</span> was on your form but not in the package we received.';
      var tsuBox = '<div class="tsu-row"><div class="stack-s"><label class="lbl" for="tsu' + i + '">New TSU barcode</label>' +
        '<input id="tsu' + i + '" class="field mono" data-i="' + i + '" placeholder="Scan or type" autocomplete="off" value="' + esc(it.tsu) + '"></div>' +
        (window.Scanner && Scanner.supported() ? '<button type="button" class="btn btn-ghost scan" data-i="' + i + '">Scan with camera</button>' : '') + '</div>';
      var choose = qc ? tsuBox
        : '<div class="stack-s" role="radiogroup" aria-label="Which TSU for ' + esc(tag) + '">' +
          '<label class="opt"><input type="radio" name="t' + i + '" value="orig" data-i="' + i + '"' + (it.useOriginal ? ' checked' : '') + '>I found the original TSU (<span class="mono">' + esc(a.tsu) + '</span>)</label>' +
          '<label class="opt"><input type="radio" name="t' + i + '" value="new" data-i="' + i + '"' + (it.useOriginal ? '' : ' checked') + '>I\'m taking a new TSU</label>' +
          (it.useOriginal ? '' : tsuBox) + '</div>';
      return '<div class="animal"><input type="checkbox" data-i="' + i + '" class="inc"' + (it.on ? ' checked' : '') + ' aria-label="Send a sample for ' + esc(tag) + '">' +
        '<div class="stack" style="flex:1;gap:10px"><div class="row" style="gap:10px"><b style="font-size:17px">' + esc(tag) + '</b><span class="small muted">' + esc(info) + '</span>' +
        '<span class="reason ' + (qc ? 'r-qc' : 'r-miss') + '">' + (qc ? 'Failed the lab check' : 'Not in your box') + '</span></div>' +
        '<span style="color:var(--ink2)">' + body + '</span>' + (it.on ? choose : '') + '</div></div>';
    }).join('');

    Array.prototype.forEach.call($('animals').querySelectorAll('.inc'), function (el) {
      el.onchange = function () { items[el.dataset.i].on = el.checked; render(); };
    });
    Array.prototype.forEach.call($('animals').querySelectorAll('input[type=radio]'), function (el) {
      el.onchange = function () { items[el.dataset.i].useOriginal = el.value === 'orig'; render(); };
    });
    Array.prototype.forEach.call($('animals').querySelectorAll('input.field'), function (el) {
      el.oninput = function () { items[el.dataset.i].tsu = el.value; refresh(); };
    });
    Array.prototype.forEach.call($('animals').querySelectorAll('.scan'), function (el) {
      el.onclick = function () {
        var i = el.dataset.i;
        Scanner.open(function (code) { items[i].tsu = norm(code); render(); });
      };
    });
    refresh();
  }

  function refresh() {
    var on = items.filter(function (it) { return it.on; });
    var missing = [], seen = {};
    on.forEach(function (it) {
      var tag = it.a.tag || it.a.eid, qc = it.a.attention === 'qc';
      if (!qc && it.useOriginal) return;
      var t = norm(it.tsu);
      if (!t) missing.push('the new TSU for ' + tag);
      else if (t === norm(it.a.tsu)) missing.push('a different TSU for ' + tag + (qc ? ' (that is the one that failed)' : ' (or choose "I found the original")'));
      else if (seen[t]) missing.push('a different TSU for ' + tag + ' (' + t + ' is used twice)');
      seen[t] = 1;
    });
    var n = on.length;
    $('go').disabled = busy || !n || missing.length > 0;
    $('go').textContent = busy ? 'Registering…' : 'Register ' + (n === 1 ? '1 TSU' : n + ' TSUs') + ' and print slip';
    $('hint').textContent = !n ? 'Tick at least one animal.' : missing.length ? 'Still needed: ' + missing.join(', ') + '.'
      : n === items.length ? (n > 1 ? 'All animals included.' : '') : 'You can send the others later from your results page.';
  }

  $('go').onclick = function () {
    if ($('go').disabled) return;
    busy = true; refresh();
    $('go-error').classList.add('hidden');
    var chosen = items.filter(function (it) { return it.on; });
    var payload = chosen.map(function (it) {
      var orig = it.a.attention === 'missing' && it.useOriginal;
      return { animalKey: it.a.key, useOriginal: orig, tsu: orig ? '' : norm(it.tsu) };
    });
    App.api('replace', { token: token, items: payload }).then(function (d) {
      $('pick').classList.add('hidden');
      $('done').classList.remove('hidden');
      $('done-title').textContent = 'Registered. Your reference is ' + d.replacementId;
      $('done-sub').textContent = chosen.map(function (it, k) {
        return (it.a.tag || it.a.eid) + ' with ' + (payload[k].useOriginal ? 'its original TSU ' + it.a.tsu : 'new TSU ' + payload[k].tsu);
      }).join('; ') + '. A confirmation is on its way to ' + d.email + '.';
      $('slip').href = 'slip.html?t=' + encodeURIComponent(token) + '&r=' + encodeURIComponent(d.replacementId);
      window.scrollTo(0, 0);
    }).catch(function (e) {
      busy = false; refresh();
      App.notice($('go-error'), 'bad', esc(e.message));
      $('go-error').classList.remove('hidden');
    });
  };

  if (!token) {
    $('loading').classList.add('hidden');
    App.notice($('load-error'), 'bad', 'This page needs the private link from your email. Please open the link in the email we sent you.');
    return;
  }
  App.api('status', { token: token }).then(function (d) {
    $('loading').classList.add('hidden');
    $('ref').textContent = d.submission.flock + ' · Submission ' + d.submission.id;
    items = d.animals.filter(function (a) { return a.attention && !a.replacement; })
      .map(function (a) { return { a: a, on: true, tsu: '', useOriginal: a.attention === 'missing' }; });
    if (!items.length) { $('nothing').classList.remove('hidden'); return; }
    $('pick').classList.remove('hidden');
    render();
  }).catch(function (e) {
    $('loading').classList.add('hidden');
    App.notice($('load-error'), 'bad', esc(e.message));
  });
})();
