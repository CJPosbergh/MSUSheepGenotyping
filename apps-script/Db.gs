/**
 * Reading and writing the tracker's tabs by column name.
 * Rules:
 *  - The back end reads only input columns (blue, gold, green headers), never formula (grey) columns,
 *    so it never depends on a formula having recalculated.
 *  - New rows get the grey-column formulas from SCHEMA (Schema.gs, generated from the tracker).
 *  - Text columns (EID, TSU, IDs, birth years) are written as text so long numbers survive.
 */

var SS_ = null;
function ss_() {
  if (!SS_) {
    var id = PropertiesService.getScriptProperties().getProperty('TRACKER_ID');
    SS_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  }
  return SS_;
}

function formulaCols_(name) {
  return (SCHEMA.formulas[name] && Object.keys(SCHEMA.formulas[name])) || [];
}

/** Read a tab: { name, sheet, headers, rows: [{...values, _row}] }. Rows with no input values are skipped. */
function table_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('The tracker has no "' + name + '" tab.');
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var vals = lastRow ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var headers = vals[0].map(function (h) { return String(h).trim(); });
  var fcols = formulaCols_(name);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 }, has = false;
    for (var j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      var v = vals[i][j];
      o[headers[j]] = v;
      if (fcols.indexOf(headers[j]) < 0 && v !== '' && v !== null && v !== undefined) has = true;
    }
    if (has) rows.push(o);
  }
  return { name: name, sheet: sh, headers: headers, rows: rows };
}

function colIndex_(t, header) {
  var i = t.headers.indexOf(header);
  if (i < 0) throw new Error('The "' + t.name + '" tab has no "' + header + '" column.');
  return i + 1;
}

function find_(t, header, value) {
  var v = String(value);
  for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i][header]) === v) return t.rows[i];
  return null;
}

function filter_(t, header, value) {
  var v = String(value);
  return t.rows.filter(function (r) { return String(r[header]) === v; });
}

/** Append rows (objects keyed by header). Returns the objects with _row set. */
function append_(t, objs) {
  if (!objs.length) return [];
  var sh = t.sheet;
  var start = Math.max(sh.getLastRow(), 1) + 1;
  var fm = SCHEMA.formulas[t.name] || {};
  var formats = SCHEMA.formats[t.name] || { text: [], date: [], money: [] };
  var data = objs.map(function (o, k) {
    var r = start + k;
    return t.headers.map(function (h) {
      if (fm[h]) return fm[h].replace(/\{r\}/g, r);
      var v = o[h];
      if (v === undefined || v === null) return '';
      if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
      return safeText_(v);
    });
  });
  // Text columns first, so '840003307100001' and '2018-2020' stay as typed.
  formats.text.forEach(function (h) {
    var c = t.headers.indexOf(h);
    if (c >= 0) sh.getRange(start, c + 1, objs.length, 1).setNumberFormat('@');
  });
  formats.date.forEach(function (h) {
    var c = t.headers.indexOf(h);
    if (c >= 0) sh.getRange(start, c + 1, objs.length, 1).setNumberFormat('yyyy-mm-dd');
  });
  sh.getRange(start, 1, objs.length, t.headers.length).setValues(data);
  return objs.map(function (o, k) {
    var copy = Object.assign({}, o); copy._row = start + k; t.rows.push(copy); return copy;
  });
}

/** Write changed values into an existing row object (and keep the in-memory copy in step). */
function update_(t, row, changes) {
  var fm = SCHEMA.formulas[t.name] || {};
  Object.keys(changes).forEach(function (h) {
    if (fm[h]) throw new Error('Refusing to overwrite formula column ' + t.name + '.' + h);
    var v = changes[h];
    if (v === undefined || v === null) v = '';
    var out = (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') ? v : safeText_(v);
    var cell = t.sheet.getRange(row._row, colIndex_(t, h));
    if ((SCHEMA.formats[t.name] || { text: [] }).text.indexOf(h) >= 0) cell.setNumberFormat('@');
    cell.setValue(out);
    row[h] = v;
  });
  return row;
}

/** Delete rows (highest first so row numbers stay valid). */
function deleteRows_(t, rows) {
  rows.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (n) { t.sheet.deleteRow(n); });
}

/** Settings tab as { key: value }. */
function settings_() {
  var t = table_('Settings'), s = {};
  t.rows.forEach(function (r) { s[String(r.Setting).trim()] = r.Value; });
  return s;
}

function setSetting_(key, value) {
  var t = table_('Settings');
  var row = find_(t, 'Setting', key);
  if (row) update_(t, row, { Value: value });
  else append_(t, [{ Setting: key, Value: value, Notes: '' }]);
}
