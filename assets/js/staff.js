/* Shared by the staff pages: the sign-in gate, the header, and API calls that carry the passphrase and name.
   The passphrase is checked by the Apps Script back end; it is never written in the page code.
   This computer remembers the passphrase and name until someone presses Lock. */
(function () {
  'use strict';
  var KEY = 'msuGenoStaff';
  var esc = App.esc;
  var cred = load();

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(c) {
    cred = c;
    try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch (e) { /* private window: stays in memory */ }
  }

  function header(active) {
    var el = document.getElementById('site-header');
    el.className = 'site-header';
    var links = [['receive.html', 'Receiving'], ['batches.html', 'Batches']].map(function (l) {
      var on = l[0].indexOf(active) === 0;
      return '<a href="' + l[0] + '" style="color:#fff;font-weight:' + (on ? 700 : 500) + ';text-decoration:' + (on ? 'underline' : 'none') + '">' + l[1] + '</a>';
    }).join('');
    el.innerHTML = '<div class="inner"><a class="brand" href="receive.html">' + App.LOGO + '<span><b>Sheep Genotyping · Lab</b><small>Staff only</small></span></a>' +
      '<nav class="row" style="gap:20px;font-size:14px">' + links +
      (cred ? '<span class="header-note">' + esc((active === 'batches' ? 'Signed in as ' : 'Receiving as ') + cred.staff) + '</span>' +
        '<button type="button" id="lock" class="btn btn-sm" style="background:none;border:1px solid #6C7A92;color:#fff">Lock</button>' : '') +
      '</nav></div>';
    var lockBtn = document.getElementById('lock');
    if (lockBtn) lockBtn.onclick = function () { save(null); location.reload(); };
  }

  /** Shows the sign-in form in #gate until the passphrase is accepted, then calls onReady(staffName). */
  function gate(active, onReady) {
    header(active);
    var g = document.getElementById('gate'), app = document.getElementById('app');
    function show() {
      g.classList.remove('hidden'); app.classList.add('hidden');
      g.innerHTML = '<section class="card pad stack gate" aria-label="Staff sign-in">' +
        '<div class="stack-s"><h1 style="font-size:32px">Staff sign-in</h1><p style="color:var(--ink2)">Enter the staff passphrase and your name. This computer remembers both until you lock it.</p></div>' +
        '<div class="stack-s"><label class="lbl" for="pass">Staff passphrase</label><input id="pass" class="field" type="password" autocomplete="current-password"><span id="pass-err" class="small hidden" style="color:var(--bad);font-weight:600"></span></div>' +
        '<div class="stack-s"><label class="lbl" for="who">Your name</label><input id="who" class="field" type="text" autocomplete="name" value="' + esc(cred && cred.staff || '') + '"><span class="small muted">Recorded on each box you receive and each batch you ship.</span></div>' +
        '<button type="button" id="unlock" class="btn btn-primary" disabled>Unlock</button></section>';
      var pass = document.getElementById('pass'), who = document.getElementById('who'), btn = document.getElementById('unlock');
      var ok = function () { btn.disabled = !pass.value.trim() || !who.value.trim(); };
      pass.oninput = ok; who.oninput = ok;
      var go = function () {
        if (btn.disabled) return;
        btn.disabled = true; btn.textContent = 'Checking…';
        var c = { pass: pass.value.trim(), staff: who.value.trim() };
        App.api('staffCheck', { passphrase: c.pass, staff: c.staff }).then(function () {
          save(c); ready();
        }).catch(function (e) {
          btn.textContent = 'Unlock'; ok();
          var err = document.getElementById('pass-err');
          err.textContent = e.code === 'bad_passphrase' ? 'That passphrase didn\'t work. Check it with Christian.' : e.message;
          err.classList.remove('hidden');
          pass.classList.add('bad');
        });
      };
      btn.onclick = go;
      [pass, who].forEach(function (el) { el.onkeydown = function (e) { if (e.key === 'Enter') go(); }; });
      (cred && cred.staff ? pass : who).focus();
    }
    function ready() {
      header(active);
      g.classList.add('hidden'); app.classList.remove('hidden');
      onReady(cred.staff);
    }
    Staff.relock = function () { save(null); header(active); show(); };
    if (cred && cred.pass && cred.staff) ready(); else show();
  }

  /** Staff API call: adds passphrase and name; a rejected passphrase sends you back to sign-in. */
  function call(action, payload) {
    var p = Object.assign({}, payload || {}, { passphrase: cred && cred.pass, staff: cred && cred.staff });
    return App.api(action, p).catch(function (e) {
      if (e.code === 'bad_passphrase' && Staff.relock) Staff.relock();
      throw e;
    });
  }

  var Staff = window.Staff = { gate: gate, call: call, name: function () { return cred && cred.staff; } };
})();
