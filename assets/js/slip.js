/* Printable packing slip for a submission, or for one replacement (?r=). The QR code holds the reference,
   which the receiving page looks up when staff scan it. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = App.esc, token = App.param('t'), rid = App.param('r');
  $('back').href = 'status.html?t=' + encodeURIComponent(token);
  $('back').textContent = 'Back to your submission page';

  function row(r) {
    return '<div class="tr"><span class="box"></span><b>' + esc(r.tag) + '</b><span class="mono">' + esc(r.tsu) + '</span><span class="mono">' + esc(r.eid) +
      '</span><span>' + esc([r.sex, r.born].filter(Boolean).join(' · ')) + '</span></div>';
  }
  function table(list) {
    return '<div class="tbl"><div class="tr th"><span></span><span>Tag</span><span>TSU</span><span>EID</span><span>Sex · born</span></div>' + list.map(row).join('') + '</div>';
  }

  if (!token) { App.notice($('msg'), 'bad', 'This page needs the private link from your email.'); return; }

  Promise.all([App.api('slip', { token: token, r: rid }), App.config()]).then(function (res) {
    var d = res[0], c = res[1] || {};
    var rep = d.kind === 'replacement';
    document.title = (rep ? 'Replacement slip ' : 'Packing slip ') + d.ref;
    $('kind').textContent = 'MSU Sheep Genotyping · ' + (rep ? 'Replacement slip' : 'Packing slip');
    $('ref').textContent = d.ref;
    $('subline').textContent = [d.flock, d.contact, rep ? 'replacements for ' + d.submissionId + ' · registered ' + d.date : 'submitted ' + d.date].filter(Boolean).join(' · ');

    var qr = qrcode(0, 'M');
    qr.addData(d.ref);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });

    var addr = String(c.mailingAddress || 'MSU Sheep Genotyping, 311 Animal Biosciences Building, Bozeman, MT 59717');
    $('mail').innerHTML = App.addressHtml(addr);
    $('drop').innerHTML = App.mapsLink(c.dropoffLocation) + '<br>' + esc(c.dropoffHours ? 'Open: ' + c.dropoffHours : '');
    $('from').innerHTML = [esc([d.contact, d.flock].filter(Boolean).join(', ')), esc(d.address), esc(d.phone)].filter(Boolean).join('<br>');

    var n = d.items.length, half = Math.ceil(n / 2);
    $('count').textContent = n + (rep ? ' replacement TSU' : ' TSU') + (n === 1 ? '' : 's') + ' in this shipment';
    $('cols').innerHTML = table(d.items.slice(0, half)) + (n > 1 ? table(d.items.slice(half)) : '');
    $('missing-line').textContent = 'Missing a TSU, or packing one not listed here? Email ' + (c.contactEmail || 'us') + ' with your reference ' + d.ref + ' before you mail the box.';
    $('rep-line').classList.toggle('hidden', !rep);
    if (!rep && !d.signed) {
      $('consent-line').textContent = 'Put your signed consent form in this box too. Your samples can\'t go to the lab until we have it.';
      $('consent-line').classList.remove('hidden');
    }
    $('printed').textContent = 'Printed from the MSU Sheep Genotyping ' + (rep ? 'results page' : 'submission page') + ' · reference ' + d.ref;
    $('sheet').classList.remove('hidden');
    $('print').disabled = false;
  }).catch(function (e) {
    App.notice($('msg'), 'bad', esc(e.message));
  });
})();
