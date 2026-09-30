/* Camera barcode scanning with the browser's BarcodeDetector (Chrome and Edge on Android, Windows and Mac).
   Scanner.supported() says whether to show a "Scan with camera" button; USB/Bluetooth scanners
   just type into the focused box and need nothing from here. */
(function () {
  'use strict';
  var WANT = ['code_128', 'code_39', 'data_matrix', 'qr_code', 'ean_13', 'itf', 'codabar'];

  function supported() {
    return 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /** Opens a full-screen camera view and calls onCode(text) once, then closes; with opts.keepOpen it keeps
      reading (each new code once) until Done. Returns a close function. */
  function open(onCode, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Scan a barcode');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(10,18,32,.92);z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:16px';
    wrap.innerHTML = '<video playsinline muted style="width:min(640px,100%);max-height:70vh;border-radius:12px;background:#000"></video>' +
      '<span style="color:#fff;font-size:15px">' + (opts.prompt || 'Point the camera at the TSU barcode') + '</span>' +
      '<button type="button" class="btn btn-ghost">' + (opts.keepOpen ? 'Done' : 'Cancel') + '</button>';
    document.body.appendChild(wrap);
    var video = wrap.querySelector('video'), stream = null, timer = null, closed = false, last = '', lastAt = 0;

    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      wrap.remove();
    }
    wrap.querySelector('button').onclick = close;

    Promise.resolve(window.BarcodeDetector.getSupportedFormats ? window.BarcodeDetector.getSupportedFormats() : WANT)
      .then(function (have) {
        var formats = WANT.filter(function (f) { return have.indexOf(f) >= 0; });
        var detector = new window.BarcodeDetector(formats.length ? { formats: formats } : undefined);
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
          stream = s;
          if (closed) { close(); return; }
          video.srcObject = s;
          return video.play().then(function () {
            (function tick() {
              if (closed) return;
              detector.detect(video).then(function (codes) {
                if (closed) return;
                var c = codes && codes[0] && codes[0].rawValue;
                c = c ? String(c).trim() : '';
                if (c && opts.keepOpen) {
                  var now = Date.now();
                  if (c !== last || now - lastAt > 2500) {
                    if (navigator.vibrate) navigator.vibrate(60);
                    wrap.querySelector('span').textContent = 'Read ' + c + '. Scan the next one, or press Done.';
                    onCode(c);
                  }
                  last = c; lastAt = now;
                  timer = setTimeout(tick, 600);
                } else if (c) { if (navigator.vibrate) navigator.vibrate(60); close(); onCode(c); }
                else timer = setTimeout(tick, 200);
              }).catch(function () { timer = setTimeout(tick, 400); });
            })();
          });
        });
      })
      .catch(function (e) {
        wrap.querySelector('span').textContent = 'The camera could not start (' + (e && e.name || 'error') + '). Allow camera access, or type the barcode instead.';
      });
    return close;
  }

  window.Scanner = { supported: supported, open: open };
})();
