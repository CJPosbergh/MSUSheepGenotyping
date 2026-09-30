/**
 * Small helpers shared by every other file. No Google services are called here except Utilities
 * for dates and random IDs, so these functions are easy to test.
 */

var TZ = 'America/Denver';

/** Today's date as a Date at midnight (Mountain time). */
function today_() {
  var s = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return dateFromIso_(s);
}

function dateFromIso_(s) {
  var p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

/** '6 Oct 2026' style dates for emails and pages. */
function fmtDate_(d) {
  if (!d) return '';
  if (!(d instanceof Date)) d = new Date(d);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, TZ, 'd MMM yyyy');
}

function isoDate_(d) {
  if (!d) return '';
  if (!(d instanceof Date)) d = new Date(d);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function money_(v) {
  var n = Number(v) || 0;
  var neg = n < 0; n = Math.abs(n);
  var s = n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + s;
}

/** Trim, drop non-breaking spaces, and turn numbers into plain digit strings (no 8.4E+14). */
function clean_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }
  if (v instanceof Date) return isoDate_(v);
  return String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** Random token for private links: 12 letters and digits. */
function newToken_() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  var out = '';
  for (var i = 0; i < 12; i++) out += alphabet.charAt(((bytes[i] % 256) + 256) % 256 % alphabet.length);
  return out;
}

function firstName_(full) {
  var s = clean_(full);
  return s ? s.split(' ')[0] : 'there';
}

/** Earliest year in '2018-2020' or '2021'; null when there is none. */
function earliestYear_(yob) {
  var m = String(yob || '').match(/\d{4}/g);
  if (!m) return null;
  return Math.min.apply(null, m.map(Number));
}

/** 'J05 (TSU NE05200205) and J06 (TSU NE05200206)' */
function joinList_(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/** Guard text written to the sheet so it is never read as a formula. */
function safeText_(v) {
  var s = clean_(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function yes_(v) {
  return String(v || '').trim().toUpperCase() === 'Y';
}

function httpError_(message, code) {
  var e = new Error(message);
  e.userMessage = message;
  e.code = code || 'bad_request';
  return e;
}

/** Run fn while holding the script lock the web app uses, so menu actions and website actions never interleave. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}
