/** Generated from assets/js/validate.js by tools/sync.sh. Edit that file, not this one. */
/**
 * Submission form rules, shared by the website (checks before upload) and the Apps Script back end
 * (checks again on arrival). tools/sync.sh copies this file to apps-script/Validate.gs, so edit it here.
 */
var FORM_RULES = {
  maxAnimals: 200,
  firstYear: 1990,
  headerMap: {
    birthflock: 'birthFlock', flocktag: 'flockTag', tag: 'flockTag', eid: 'eid', tsubarcode: 'tsu', tsu: 'tsu',
    yearofbirth: 'yob', yob: 'yob', birthyear: 'yob', breed: 'breed', sex: 'sex', nsipid: 'nsipId', nsip: 'nsipId',
    testconditions: 'testConditions', testparentage: 'testParentage', dam: 'dam', sire: 'sire', comments: 'comments',
    comment: 'comments', notes: 'comments'
  },
  submitterMap: {
    submittername: 'name', name: 'name', flockname: 'flock', nsipflockid: 'nsipFlockId', address: 'address',
    mailingaddress: 'address', phone: 'phone', emailtoreceiveresults: 'email', email: 'email'
  },
  labels: {
    birthFlock: 'Birth_Flock', flockTag: 'Flock Tag', eid: 'EID', tsu: 'TSU_Barcode', yob: 'Year of Birth', breed: 'Breed',
    sex: 'Sex', nsipId: 'NSIP_ID', testConditions: 'Test_Conditions', testParentage: 'Test_Parentage', dam: 'DAM',
    sire: 'SIRE', comments: 'Comments'
  }
};

function formKey_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formText_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** Map an Animals header row to field names: returns [{col, field}] and the headers it did not know. */
function mapAnimalHeaders(headerRow) {
  var cols = [], unknown = [];
  (headerRow || []).forEach(function (h, i) {
    var f = FORM_RULES.headerMap[formKey_(h)];
    if (f) cols.push({ col: i, field: f });
    else if (formText_(h)) unknown.push(formText_(h));
  });
  return { cols: cols, unknown: unknown };
}

/** One Animals row (array of cell values) to an object, or null for blank and EXAMPLE rows. */
function mapAnimalRow(mapping, rowArr, excelRow) {
  var o = { row: excelRow };
  var any = false;
  mapping.cols.forEach(function (c) {
    var v = formText_(rowArr[c.col]);
    o[c.field] = v;
    if (v) any = true;
  });
  if (!any) return null;
  if (/^example$/i.test(o.comments || '')) return null;
  return o;
}

/** Submitter tab rows ([[label, value], ...]) to { name, flock, nsipFlockId, address, phone, email }. */
function mapSubmitter(rows) {
  var s = { name: '', flock: '', nsipFlockId: '', address: '', phone: '', email: '' };
  (rows || []).forEach(function (r) {
    var f = FORM_RULES.submitterMap[formKey_(r[0])];
    if (f && !s[f]) s[f] = formText_(r[1]);
  });
  return s;
}

/**
 * Check a parsed form. Returns { ok, errors: [{row, field, message}], warnings: [..], animals, submitter }
 * with values cleaned (TSUs upper case, sex M/F, Y/N flags filled in).
 */
function validateSubmission(submitter, animals, currentYear) {
  var errors = [], warnings = [];
  var yearNow = currentYear || new Date().getFullYear();
  var sub = {};
  Object.keys(submitter || {}).forEach(function (k) { sub[k] = formText_(submitter[k]); });
  if (!sub.name) errors.push({ row: null, field: 'Submitter Name', message: 'Submitter name is missing on the Submitter tab.' });
  if (!sub.flock) errors.push({ row: null, field: 'Flock Name', message: 'Flock name is missing on the Submitter tab.' });
  if (!sub.email) errors.push({ row: null, field: 'Email', message: 'The email to receive results is missing on the Submitter tab.' });
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sub.email)) errors.push({ row: null, field: 'Email', message: 'The email "' + sub.email + '" doesn\'t look right.' });
  if (!sub.address) errors.push({ row: null, field: 'Address', message: 'The mailing address is missing on the Submitter tab (it goes on your invoice).' });
  sub.email = (sub.email || '').toLowerCase();

  var list = (animals || []).filter(Boolean);
  if (!list.length) errors.push({ row: null, field: 'Animals', message: 'No animals found on the Animals tab.' });
  if (list.length > FORM_RULES.maxAnimals) errors.push({ row: null, field: 'Animals', message: 'A form can hold at most ' + FORM_RULES.maxAnimals + ' animals. Please split it into two submissions.' });

  var seenTsu = {}, seenTag = {}, seenEid = {}, blankFlags = 0;
  var out = list.map(function (a) {
    var r = a.row;
    var x = {
      row: r, birthFlock: formText_(a.birthFlock), flockTag: formText_(a.flockTag), eid: formText_(a.eid).replace(/\s/g, ''),
      tsu: formText_(a.tsu).replace(/\s/g, '').toUpperCase(), yob: formText_(a.yob).replace(/\s/g, ''),
      breed: formText_(a.breed), sex: formText_(a.sex).toUpperCase(), nsipId: formText_(a.nsipId).replace(/\s/g, '').toUpperCase(),
      testConditions: formText_(a.testConditions).toUpperCase(), testParentage: formText_(a.testParentage).toUpperCase(),
      dam: formText_(a.dam), sire: formText_(a.sire), comments: formText_(a.comments)
    };
    function err(field, msg) { errors.push({ row: r, field: field, message: msg }); }

    if (!x.tsu) err('TSU_Barcode', 'TSU barcode is missing.');
    else if (!/^[A-Z0-9-]{4,24}$/.test(x.tsu)) err('TSU_Barcode', 'TSU barcode "' + x.tsu + '" has characters a TSU barcode shouldn\'t.');
    else if (seenTsu[x.tsu]) err('TSU_Barcode', 'TSU ' + x.tsu + ' is also on row ' + seenTsu[x.tsu] + '.');
    else seenTsu[x.tsu] = r;

    if (!x.flockTag && !x.eid) err('Flock Tag', 'Needs a flock tag, an EID, or both.');
    if (x.eid) {
      if (/e\+?\d/i.test(x.eid)) err('EID', 'EID shows as ' + x.eid + '. Format the EID column as Text in Excel and re-enter it.');
      else if (!/^\d{15,16}$/.test(x.eid)) err('EID', 'EID "' + x.eid + '" should be 15 digits (16 at most).');
      else if (seenEid[x.eid]) err('EID', 'EID ' + x.eid + ' is also on row ' + seenEid[x.eid] + '.');
      else seenEid[x.eid] = r;
    }
    if (x.flockTag) {
      var tk = x.flockTag.toUpperCase();
      if (seenTag[tk]) err('Flock Tag', 'Flock tag ' + x.flockTag + ' is also on row ' + seenTag[tk] + '.');
      else seenTag[tk] = r;
    }

    if (!x.yob) err('Year of Birth', 'Year of birth is missing (a range like 2018-2020 is fine).');
    else {
      var m = x.yob.match(/^(\d{4})(?:-(\d{4}))?$/);
      if (!m) err('Year of Birth', 'Year of birth "' + x.yob + '" should be a year like 2024 or a range like 2018-2020.');
      else {
        var y1 = Number(m[1]), y2 = m[2] ? Number(m[2]) : y1;
        if (y1 < FORM_RULES.firstYear || y2 > yearNow || y2 < y1) err('Year of Birth', 'Year of birth "' + x.yob + '" is out of range.');
      }
    }
    if (!x.breed) err('Breed', 'Breed is missing.');
    if (x.sex === 'MALE' || x.sex === 'RAM') x.sex = 'M';
    if (x.sex === 'FEMALE' || x.sex === 'EWE') x.sex = 'F';
    if (x.sex !== 'M' && x.sex !== 'F') err('Sex', x.sex ? 'Sex "' + x.sex + '" should be M or F.' : 'Sex is missing (M or F).');

    ['testConditions', 'testParentage'].forEach(function (f) {
      if (!x[f]) { x[f] = 'Y'; blankFlags++; }
      else if (x[f] === 'YES') x[f] = 'Y';
      else if (x[f] === 'NO') x[f] = 'N';
      if (x[f] !== 'Y' && x[f] !== 'N') err(FORM_RULES.labels[f], FORM_RULES.labels[f] + ' should be Y or N.');
    });
    x.animalId = x.flockTag || x.eid;
    return x;
  });
  if (blankFlags) warnings.push('Some Test_Conditions or Test_Parentage cells were blank; they are treated as Y.');
  return { ok: errors.length === 0, errors: errors, warnings: warnings, animals: out, submitter: sub };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FORM_RULES: FORM_RULES, mapAnimalHeaders: mapAnimalHeaders, mapAnimalRow: mapAnimalRow,
    mapSubmitter: mapSubmitter, validateSubmission: validateSubmission };
}
