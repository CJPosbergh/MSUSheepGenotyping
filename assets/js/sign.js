/* Sign page: for submissions that arrived without a signature (or were submitted with the paper option). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = App.esc, token = App.param('t');
  App.header({ note: 'Private link · do not share publicly' });
  App.footer();
  var st = { research: '', sub: null, busy: false };
  $('status-link').href = 'status.html?t=' + encodeURIComponent(token);

  App.config().then(function (c) {
    if (c.paperForm) $('paper-link').href = c.paperForm;
    if (c.contactEmail) $('paper-email').textContent = c.contactEmail;
  });

  function showSigned(signer, date, research, boxArrived, email) {
    $('unsigned').classList.add('hidden');
    $('signed').classList.remove('hidden');
    $('signed-msg').textContent = (boxArrived ? 'Your samples for ' + st.sub.id + ' can now go to the lab in the next batch.'
      : 'Your submission ' + st.sub.id + ' is signed. Send your TSUs when you are ready.') +
      (email ? ' A copy of what you signed is on its way to ' + email + '.' : '');
    $('signed-detail').innerHTML = '<span><b>Signed by:</b> ' + esc(signer) + (date ? ', ' + esc(date) : '') + '</span>' +
      (research ? '<span><b>MSU research use:</b> ' + esc(research) + '</span>' : '');
  }

  function refresh() {
    var missing = [];
    if (!st.research) missing.push('answer the research question');
    if (!$('agree').checked) missing.push('tick "I agree"');
    if (!$('fullname').value.trim()) missing.push('type your name');
    $('sign').disabled = st.busy || missing.length > 0;
    $('todo').textContent = missing.length ? 'To sign, ' + App.joinList(missing) + '.' : '';
  }

  function pick(v) {
    st.research = v;
    $('r-y').setAttribute('aria-pressed', v === 'Y');
    $('r-n').setAttribute('aria-pressed', v === 'N');
    refresh();
  }
  $('r-y').onclick = function () { pick('Y'); };
  $('r-n').onclick = function () { pick('N'); };
  $('agree').onchange = refresh;
  $('fullname').oninput = refresh;

  $('sign').onclick = function () {
    if ($('sign').disabled) return;
    st.busy = true; refresh();
    $('sign').textContent = 'Signing…';
    $('sign-error').classList.add('hidden');
    App.api('sign', { token: token, research: st.research, agree: true, name: $('fullname').value.trim() }).then(function (d) {
      showSigned(d.signer, d.signedDate, st.research === 'Y' ? 'Yes' : 'No', d.boxArrived, d.email);
    }).catch(function (e) {
      st.busy = false; $('sign').textContent = 'Sign submission'; refresh();
      App.notice($('sign-error'), 'bad', esc(e.message));
    });
  };

  if (!token) {
    $('loading').classList.add('hidden');
    App.notice($('load-error'), 'bad', 'This page needs the private link from your email. Please open the link in the email we sent you.');
    return;
  }
  App.api('status', { token: token }).then(function (d) {
    var s = d.submission;
    st.sub = s;
    $('loading').classList.add('hidden');
    document.title = 'Sign ' + s.id + ' · MSU Sheep Genotyping';
    $('ref').textContent = s.id + ' · ' + s.flock;
    $('paper-ref').textContent = s.id;
    if (s.signed) {
      showSigned('the submitter', s.signedDate, '', false, '');
      $('signed').querySelector('h1').textContent = 'This submission is already signed';
      $('signed-msg').textContent = 'Nothing more to do here. Thank you!';
      $('signed-detail').innerHTML = '<span><b>Signed:</b> ' + esc(s.signedDate || '') + (s.signatureMethod ? ' (' + esc(s.signatureMethod.toLowerCase()) + ')' : '') + '</span>';
    } else {
      $('unsigned').classList.remove('hidden');
      refresh();
    }
  }).catch(function (e) {
    $('loading').classList.add('hidden');
    App.notice($('load-error'), 'bad', esc(e.message));
  });
})();
