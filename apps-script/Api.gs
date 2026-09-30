/**
 * Web app entry point. The website sends POST requests with a JSON body { action, ... } as text/plain
 * (which avoids a CORS preflight) and gets JSON back.
 *
 * Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
 */

// Built on first use: in Apps Script, files load in order, so a top-level map could name functions that
// another file has not defined yet.
function actions_() {
  return {
    pub: { config: apiConfig_, submit: apiSubmit_, uploadPhoto: apiUploadPhoto_, status: apiStatus_, sign: apiSign_,
      replace: apiRegisterReplacement_, download: apiDownload_, slip: apiSlip_ },
    staff: { staffCheck: function () { return { ok: true }; }, lookup: apiLookup_, scan: apiScan_, finish: apiFinish_,
      sendReceipt: apiSendReceipt_, ready: apiReadySamples_, createBatch: apiCreateBatch_, saveBatchFile: apiSaveBatchFile_,
      markShipped: apiMarkShipped_, cancelBatch: apiCancelBatch_, batches: apiBatches_, batchRows: apiBatchRows_ }
  };
}
var READ_ONLY = { config: 1, status: 1, slip: 1, download: 1, staffCheck: 1, lookup: 1, ready: 1, batches: 1, batchRows: 1 };

function doGet(e) {
  return json_({ ok: true, service: 'MSU Sheep Genotyping', time: new Date().toISOString() });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'The request could not be read.' });
  }
  return json_(handle_(req));
}

/** Also called directly by tests. */
function handle_(req) {
  var action = String(req.action || '');
  var A = actions_();
  var fn = A.pub[action] || A.staff[action];
  if (!fn) return { ok: false, error: 'Unknown action.' };
  var lock = null;
  try {
    if (A.staff[action]) checkPassphrase_(req.passphrase);
    if (!READ_ONLY[action]) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }
    var data = fn(req) || {};
    data.ok = true;
    return data;
  } catch (err) {
    console.error(action + ': ' + (err && err.stack || err));
    var out = { ok: false, error: err.userMessage || 'Something went wrong on our side. Please try again, or email ' +
      (safeSetting_('Contact_Email') || 'us') + '.', code: err.code || 'server' };
    if (err.details) out.details = err.details;
    return out;
  } finally {
    if (lock) lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeSetting_(k) {
  try { return settings_()[k]; } catch (e) { return ''; }
}

var PASS_FAIL_LIMIT = 20;          // wrong passphrases allowed in 10 minutes before staff pages pause

function checkPassphrase_(p) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pass_fails')) || 0;
  if (fails >= PASS_FAIL_LIMIT) throw httpError_('Too many wrong passphrases. Staff pages are paused for 10 minutes.', 'bad_passphrase');
  var want = String(settings_().Staff_Passphrase || '');
  if (!want || String(p || '') !== want) {
    cache.put('pass_fails', String(fails + 1), 600);
    throw httpError_('That passphrase is not right.', 'bad_passphrase');
  }
}

/** Public settings the pages show (addresses, hours, links). Never includes the passphrase. */
function apiConfig_() {
  var s = settings_();
  return { config: {
    contactEmail: s.Contact_Email, contactPhone: s.Contact_Phone, mailingAddress: s.Mailing_Address,
    dropoffLocation: s.Dropoff_Location, dropoffHours: s.Dropoff_Hours, blankForm: s.Blank_Submission_Form,
    paperForm: s.Paper_Consent_Form, resamplePolicy: s.Resample_Policy, birthFlock: s.GenomNZ_Birth_Flock,
    price: servicePrice_('GENO')
  } };
}

function servicePrice_(id) {
  var row = find_(table_('Services'), 'Service_ID', id);
  return row ? Number(row.Unit_Price) || 0 : 0;
}
