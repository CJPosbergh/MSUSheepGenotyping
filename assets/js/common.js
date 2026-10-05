/* Shared page code: talking to the back end, header/footer, small helpers. */
(function () {
  'use strict';

  var LOGO = '<svg width="40" height="40" viewBox="0 0 32 32" fill="none" stroke-linecap="round" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#FFFFFF"/><path d="M12.4 7.6h7.2M13.2 12.8h5.6M13.2 19.2h5.6M12.4 24.4h7.2" stroke="#9AA9BF" stroke-width="1.3"/><path d="M20.5 5.5C20.5 11 11.5 10.5 11.5 16" stroke="#F7BD00" stroke-width="2.6"/><path d="M11.5 5.5C11.5 11 20.5 10.5 20.5 16" stroke="#003875" stroke-width="2.6"/><path d="M20.5 16C20.5 21.5 11.5 21 11.5 26.5" stroke="#003875" stroke-width="2.6"/><path d="M11.5 16C11.5 21.5 20.5 21 20.5 26.5" stroke="#F7BD00" stroke-width="2.6"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function param(name) {
    return new URLSearchParams(location.search).get(name) || '';
  }

  function newId() {
    var a = new Uint8Array(12), s = '';
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return s;
  }

  var RETRY_DELAYS = [1500, 4000, 8000, 15000];

  /**
   * POST { action, requestId, ...payload } to the Apps Script web app. Resolves with data, rejects with
   * Error(message). If Google's answer doesn't come back (an error page such as 404, or a dropped connection),
   * it asks again with the same requestId: the back end recognises it and returns the answer it already saved,
   * so nothing is done twice. Pass payload.requestId to keep one id across separate button presses.
   * Errors from the back end itself (e.code set) are not retried. A request that never got an answer has
   * e.transport = true: it may or may not have been saved.
   */
  function api(action, payload) {
    var url = (window.SITE_CONFIG || {}).API_URL;
    var body = JSON.stringify(Object.assign({ action: action, requestId: newId() }, payload || {}));
    var lastStatus = 0;
    function once() {
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' })
        .then(function (r) {
          lastStatus = r.status;
          if (!r.ok) throw { retry: true };
          return r.json().catch(function () { throw { retry: true }; }).then(function (d) {
            // Only accept an answer to this action (an answer without it, e.g. the GET health check, means it went astray)
            if (d && d.ok && d.action !== action) { lastStatus = 'stray'; throw { retry: true }; }
            return d;
          });
        }, function () { lastStatus = 0; throw { retry: true }; });
    }
    function attempt(i) {
      return once().catch(function (x) {
        if (!x || !x.retry || i >= RETRY_DELAYS.length) throw x;
        return new Promise(function (res) { setTimeout(res, RETRY_DELAYS[i]); }).then(function () { return attempt(i + 1); });
      });
    }
    return attempt(0).then(function (d) {
      if (!d.ok) { var e = new Error(d.error || 'Something went wrong.'); e.details = d.details; e.code = d.code; throw e; }
      return d;
    }, function (x) {
      if (x instanceof Error) throw x;
      var e = new Error(lastStatus === 'stray' ? 'The server sent back an unexpected answer. Please reload the page in a minute.'
        : lastStatus ? 'The server did not answer properly (' + lastStatus + ').' : 'Could not reach the server. Check your internet connection.');
      e.transport = true;
      throw e;
    });
  }

  var configPromise = null;
  function config() {
    if (!configPromise) {
      configPromise = api('config').then(function (d) { return d.config; }).catch(function () { return {}; });
    }
    return configPromise;
  }

  function header(opts) {
    opts = opts || {};
    var el = document.getElementById('site-header');
    if (!el) return;
    el.className = 'site-header';
    el.innerHTML = '<div class="inner"><a class="brand" href="' + (opts.home || './') + '">' + LOGO +
      '<span><b>Sheep Genotyping</b><small>Montana State University · Sheep Program</small></span></a>' +
      '<span class="header-note">' + (opts.note || '') + '</span></div>';
  }

  function footer() {
    var el = document.getElementById('site-footer');
    if (!el) return;
    el.className = 'site-footer';
    config().then(function (c) {
      el.innerHTML = '<div class="inner"><span>Questions? MSU Sheep Program · ' + esc(c.contactEmail || 'christian.posbergh@montana.edu') +
        ' · ' + esc(c.contactPhone || '406-994-3736') + '</span><span>Montana State University</span></div>';
    });
  }

  /** Show a message in an element: kind = info | warn | bad | good. */
  function notice(el, kind, html) {
    el.className = 'alert ' + kind;
    el.innerHTML = html;
    el.classList.remove('hidden');
  }

  function chipClass(cat) {
    return 'chip ' + ({ good: 'c-good', mid: 'c-mid', bad: 'c-bad' }[cat] || 'c-none');
  }

  function downloadBase64(name, mime, b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    downloadBlob(name, new Blob([bytes], { type: mime }));
  }

  function downloadBlob(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function mapsLink(label) {
    return '<a href="https://www.google.com/maps/search/?api=1&amp;query=45.66542402007136,-111.06337948096632" target="_blank" rel="noopener" style="font-weight:700">' + esc(label || 'Montana Wool Lab') + '</a>';
  }

  /** "Name, Street, Town, MT 59717" -> escaped HTML lines, keeping "Town, MT 59717" together. */
  function addressHtml(addr) {
    var parts = String(addr || '').split(/\s*,\s*/).filter(Boolean);
    if (parts.length > 2 && /^[A-Z]{2}\s*\d{5}/.test(parts[parts.length - 1])) parts.splice(-2, 2, parts[parts.length - 2] + ', ' + parts[parts.length - 1]);
    return parts.map(esc).join('<br>');
  }

  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  window.App = { newId: newId, esc: esc, param: param, api: api, config: config, header: header, footer: footer, notice: notice,
    chipClass: chipClass, downloadBase64: downloadBase64, downloadBlob: downloadBlob, mapsLink: mapsLink, joinList: joinList, addressHtml: addressHtml, LOGO: LOGO };
})();
