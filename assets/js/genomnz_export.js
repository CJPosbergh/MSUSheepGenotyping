/*
 * genomnz_export.js
 * Fills GenomNZ's "Sheep Animal Info" template with the samples in one batch.
 * Used by the staff Batches page (browser, with ExcelJS from a CDN) and testable in Node.
 *
 * Columns written (everything else is left blank):
 *   A Birth Flock  = Settings > GenomNZ_Birth_Flock ("Montana State University")
 *   B Birth Tag    = Animal_Key
 *   C YOB          = year of birth (earliest year when a range like 2018-2020 was given)
 *   F Breed        = the animal's breed from the form (falls back to the submission's), in capitals like GenomNZ's example
 *   H Sex          = M / F
 *   I TSU Barcode  = the TSU in this batch (the new one for replacements)
 */
(function (root) {
  'use strict';

  var FIRST_ROW = 6;          // row 6 holds GenomNZ's green example row, which is replaced
  var STYLE_ROW = 7;          // a plain bordered data row to copy styles from
  var LAST_COL = 13;          // A..M
  var COL = { flock: 1, tag: 2, yob: 3, breed: 6, sex: 8, tsu: 9 };

  function earliestYear(yob) {
    var m = String(yob || '').match(/\d{4}/);
    return m ? m[0] : '';
  }

  /* rows: [{ animalKey, yob, breed, sex, tsu }] -> checked, cleaned rows (throws with every problem listed) */
  function prepareRows(rows) {
    var problems = [], seenTsu = {}, seenKey = {};
    var out = rows.map(function (r, i) {
      var row = {
        animalKey: String(r.animalKey || '').trim(),
        yob: earliestYear(r.yob),
        breed: String(r.breed || '').trim().toUpperCase(),
        sex: String(r.sex || '').trim().toUpperCase(),
        tsu: String(r.tsu || '').trim()
      };
      var label = row.animalKey || ('row ' + (i + 1));
      if (!row.animalKey) problems.push(label + ': no Animal_Key');
      if (!row.yob) problems.push(label + ': no year of birth');
      if (!row.breed) problems.push(label + ': no breed');
      if (row.sex !== 'M' && row.sex !== 'F') problems.push(label + ': sex must be M or F');
      if (!row.tsu) problems.push(label + ': no TSU barcode');
      if (row.tsu && seenTsu[row.tsu]) problems.push(label + ': TSU ' + row.tsu + ' is also on ' + seenTsu[row.tsu]);
      if (row.animalKey && seenKey[row.animalKey]) problems.push(label + ': listed twice');
      seenTsu[row.tsu] = label; seenKey[row.animalKey] = true;
      return row;
    });
    if (!out.length) problems.push('The batch has no samples');
    if (problems.length) {
      var err = new Error('Cannot make the GenomNZ file:\n  ' + problems.join('\n  '));
      err.problems = problems;
      throw err;
    }
    return out;
  }

  function copyStyle(from, to) {
    to.style = JSON.parse(JSON.stringify(from.style || {}));
  }

  /*
   * fill(ExcelJS, templateBuffer, rows, options) -> Promise<ArrayBuffer|Buffer> of the finished .xlsx
   *   options.birthFlock  defaults to "Montana State University"
   */
  function fill(ExcelJS, templateBuffer, rows, options) {
    options = options || {};
    var birthFlock = options.birthFlock || 'Montana State University';
    var data = prepareRows(rows);
    var wb = new ExcelJS.Workbook();
    return wb.xlsx.load(templateBuffer).then(function () {
      var ws = wb.getWorksheet('Sheet1') || wb.worksheets[0];
      var styleRow = ws.getRow(STYLE_ROW);
      var lastUsed = Math.max(ws.rowCount, FIRST_ROW + data.length);
      // clear the example row and anything below it, keeping the template's plain row style
      for (var r = FIRST_ROW; r <= lastUsed; r++) {
        var row = ws.getRow(r);
        for (var c = 1; c <= LAST_COL; c++) {
          var cell = row.getCell(c);
          cell.value = null;
          if (r < FIRST_ROW + data.length || r === FIRST_ROW) copyStyle(styleRow.getCell(c), cell);
        }
      }
      data.forEach(function (d, i) {
        var row = ws.getRow(FIRST_ROW + i);
        row.getCell(COL.flock).value = birthFlock;
        row.getCell(COL.tag).value = d.animalKey;
        row.getCell(COL.yob).value = d.yob;
        row.getCell(COL.breed).value = d.breed;
        row.getCell(COL.sex).value = d.sex;
        row.getCell(COL.tsu).value = d.tsu;
        row.commit && row.commit();
      });
      return wb.xlsx.writeBuffer();
    });
  }

  /*
   * rowsForBatch(batchId, tracker) -> rows for fill()
   *   tracker: { animals: [...Animals rows], submissions: [...Submissions rows], replacements: [...Replacements rows] }
   *   An animal is in the batch when Animals.Batch = batchId. For a replacement the Animals row already
   *   carries the new TSU, so nothing special is needed here.
   */
  function rowsForBatch(batchId, tracker) {
    var breedOf = {};
    (tracker.submissions || []).forEach(function (s) { breedOf[s.Submission_ID] = s.Breed; });
    return (tracker.animals || [])
      .filter(function (a) { return a.Batch === batchId; })
      .map(function (a, i) { return { a: a, i: i }; })
      .sort(function (x, y) { return x.a.Submission_ID < y.a.Submission_ID ? -1 : x.a.Submission_ID > y.a.Submission_ID ? 1 : x.i - y.i; })
      .map(function (x) { return x.a; })
      .map(function (a) {
        return { animalKey: a.Animal_Key, yob: a.Year_of_Birth, breed: a.Breed || breedOf[a.Submission_ID], sex: a.Sex, tsu: a.TSU_Barcode };
      });
  }

  var api = { fill: fill, prepareRows: prepareRows, rowsForBatch: rowsForBatch, earliestYear: earliestYear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GenomNZExport = api;
})(typeof window !== 'undefined' ? window : this);
