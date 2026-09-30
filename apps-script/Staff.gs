/**
 * Staff pages: receiving boxes and building batches. Every call carries the passphrase (checked in Api.gs)
 * and the staff member's typed name, which is written to Received_By / Created_By.
 */

function staffName_(req) {
  var n = clean_(req.staff);
  if (!n) throw httpError_('Enter your name first.', 'invalid');
  return n;
}

function normTsu_(v) { return clean_(v).replace(/\s/g, '').toUpperCase(); }

/** Find what a typed or scanned reference means: a submission ID, a replacement ID, or a TSU. */
function resolveRef_(query) {
  var q = clean_(query).toUpperCase();
  if (!q) throw httpError_('Scan a TSU or type a reference number.', 'invalid');
  var subs = table_('Submissions');
  if (/^P\d+-\d+-R\d+$/.test(q)) {
    var sid = q.replace(/-R\d+$/, '');
    if (filter_(table_('Replacements'), 'Replacement_ID', q).length) return { kind: 'replacement', ref: q, sid: sid };
  }
  if (find_(subs, 'Submission_ID', q)) return { kind: 'submission', ref: q, sid: q };
  var pend = table_('Replacements').rows.filter(function (r) { return normTsu_(r.New_TSU) === q && !yes_(r.Received); })[0];
  if (pend) return { kind: 'replacement', ref: pend.Replacement_ID, sid: pend.Submission_ID };
  var a = table_('Animals').rows.filter(function (x) { return normTsu_(x.TSU_Barcode) === q; })[0];
  if (a) return { kind: 'submission', ref: a.Submission_ID, sid: a.Submission_ID };
  throw httpError_('Nothing matches "' + q + '". Check the reference number on the packing slip.', 'not_found');
}

function expected_(kind, ref, ctx) {
  if (kind === 'replacement') {
    return filter_(table_('Replacements'), 'Replacement_ID', ref).map(function (r) {
      var a = find_(ctx.animalsT, 'Animal_Key', r.Animal_Key) || {};
      return { key: r.Animal_Key, tag: clean_(a.Flock_Tag) || clean_(a.EID), tsu: normTsu_(r.New_TSU), eid: clean_(a.EID),
        sexBorn: clean_(a.Sex) + ' · ' + clean_(a.Year_of_Birth), received: yes_(r.Received), reason: clean_(r.Reason) };
    });
  }
  return ctx.animals.map(function (a) {
    return { key: a.Animal_Key, tag: clean_(a.Flock_Tag) || clean_(a.EID), tsu: normTsu_(a.TSU_Barcode), eid: clean_(a.EID),
      sexBorn: clean_(a.Sex) + ' · ' + clean_(a.Year_of_Birth), received: yes_(a.Received) };
  });
}

/** "12 Ranch Rd, Big Timber MT 59011" -> "Big Timber MT 59011"; "1 Main St, Dillon, MT 59725" -> "Dillon, MT 59725" */
function townOf_(address) {
  var parts = clean_(address).split(/\s*,\s*/);
  if (parts.length > 2 && /^[A-Z]{2}\s*\d{5}/.test(parts[parts.length - 1])) return parts.slice(-2).join(', ');
  return parts[parts.length - 1] || '';
}

function receivingView_(kind, ref, sid) {
  var ctx = loadSubmission_(sid);
  var sub = ctx.sub;
  var who = contactOf_(sub, ctx.producer);
  return {
    kind: kind, ref: ref,
    submission: { id: sid, flock: who.flock, contact: who.name,
      town: townOf_(who.address), animalCount: ctx.animals.length,
      breed: clean_(sub.Breed), status: clean_(sub.Status), receivedDate: fmtDate_(sub.Received_Date) },
    consent: { method: clean_(sub.Signature_Method), signed: isSigned_(sub) },
    expected: expected_(kind, ref, ctx)
  };
}

function apiLookup_(req) {
  var r = resolveRef_(req.query);
  return receivingView_(r.kind, r.ref, r.sid);
}

function apiScan_(req) {
  var staff = staffName_(req);
  var r = resolveRef_(req.ref);
  var tsu = normTsu_(req.tsu);
  if (!tsu) throw httpError_('No barcode read.', 'invalid');
  var ctx = loadSubmission_(r.sid);
  if (r.kind === 'replacement') {
    var replT = table_('Replacements');
    var row = filter_(replT, 'Replacement_ID', r.ref).filter(function (x) { return normTsu_(x.New_TSU) === tsu; })[0];
    if (row) {
      var a1 = find_(ctx.animalsT, 'Animal_Key', row.Animal_Key) || {};
      var tag1 = clean_(a1.Flock_Tag) || clean_(a1.EID);
      if (yes_(row.Received)) return { result: 'dup', tag: tag1, tsu: tsu };
      update_(replT, row, { Received: 'Y', Received_Date: today_(), Received_By: staff });
      return { result: 'ok', tag: tag1, tsu: tsu, key: row.Animal_Key };
    }
  } else {
    var a = ctx.animals.filter(function (x) { return normTsu_(x.TSU_Barcode) === tsu; })[0];
    if (a) {
      var tag = clean_(a.Flock_Tag) || clean_(a.EID);
      if (yes_(a.Received)) return { result: 'dup', tag: tag, tsu: tsu };
      var ch = { Received: 'Y', Received_By: staff };
      if (a.Sample_Status === 'Awaiting sample' || a.Sample_Status === 'Not received' || !a.Sample_Status) ch.Sample_Status = 'Received';
      if (a.Sample_Status === 'Awaiting replacement') {
        // The producer registered this same (original) TSU as a replacement, then it came in the original box
        var rT = table_('Replacements');
        var open = filter_(rT, 'Animal_Key', a.Animal_Key).filter(function (x) { return !yes_(x.Received) && normTsu_(x.New_TSU) === tsu; })[0];
        if (open) {
          update_(rT, open, { Received: 'Y', Received_Date: today_(), Received_By: staff });
          ch.Sample_Status = 'Received';
        }
      }
      update_(ctx.animalsT, a, ch);
      return { result: 'ok', tag: tag, tsu: tsu, key: a.Animal_Key };
    }
  }
  // Not expected here: say where it belongs so staff can set it aside
  try {
    var other = resolveRef_(tsu);
    var octx = loadSubmission_(other.sid);
    var oa = octx.animals.filter(function (x) { return normTsu_(x.TSU_Barcode) === tsu; })[0];
    return { result: 'other', tsu: tsu, belongs: other.ref + ' · ' + clean_(octx.producer.Flock_Name) +
      (oa ? ' (' + (clean_(oa.Flock_Tag) || clean_(oa.EID)) + ')' : '') };
  } catch (e) {
    return { result: 'unknown', tsu: tsu };
  }
}

function apiFinish_(req) {
  var staff = staffName_(req);
  var r = resolveRef_(req.ref);
  var s = settings_();
  var ctx = loadSubmission_(r.sid);
  var sub = ctx.sub;
  var vars = Object.assign(producerVars_(ctx, s), { 'Staff name': staff });
  var flags = {}, invoiceId = '', invoiceNote = '';

  if (r.kind === 'replacement') {
    var replT = table_('Replacements');
    var rows = filter_(replT, 'Replacement_ID', r.ref);
    var missing = [];
    rows.forEach(function (x) {
      var a = find_(ctx.animalsT, 'Animal_Key', x.Animal_Key);
      if (!a) return;
      var tag = clean_(a.Flock_Tag) || clean_(a.EID);
      if (!yes_(x.Received)) { missing.push(tag + ' (TSU ' + normTsu_(x.New_TSU) + ')'); return; }
      if (a.Sample_Status !== 'Awaiting replacement') return;          // already applied
      var ch = { Received: 'Y', Sample_Status: 'Received', Received_By: clean_(x.Received_By) || staff };
      if (normTsu_(x.New_TSU) !== normTsu_(a.TSU_Barcode)) { ch.Replaced_TSU = normTsu_(a.TSU_Barcode); ch.TSU_Barcode = normTsu_(x.New_TSU); }
      if (x.Reason === 'Failed QC') ch.Batch = '';                     // history stays in Replacements.Original_Batch
      update_(ctx.animalsT, a, ch);
    });
    var got = rows.filter(function (x) { return yes_(x.Received); }).length;
    Object.assign(vars, { 'Replacement ID': r.ref, 'Replacements received': got, 'Replacements listed': rows.length,
      'Missing list': joinList_(missing) });
    flags.missing = missing.length > 0;
    try { var inv = ensureInvoice_(r.sid); invoiceId = inv ? inv.id : ''; } catch (e) { invoiceNote = e.message; }
    var d = draftEmail_('E10', vars, flags);
    return { draft: { to: clean_(ctx.producer.Email), subject: d.subject, body: d.body }, invoiceId: invoiceId, invoiceNote: invoiceNote };
  }

  // A box for a submission
  var changes = {};
  if (!sub.Received_Date) changes.Received_Date = today_();
  var paper = req.paper || {};
  var paperIn = false;
  if (!isSigned_(sub) && paper.present) {
    if (paper.research !== 'Y' && paper.research !== 'N') throw httpError_('Record the research answer from the paper form.', 'invalid');
    Object.assign(changes, { Signed_By: clean_(paper.signer) || 'Signed paper form', Signed_Date: today_(),
      Research_Use: paper.research, Signature_Method: 'Paper' });
    paperIn = true;
  }
  var signedNow = isSigned_(sub) || paperIn;
  if (['Submitted', 'On hold', 'Received', ''].indexOf(clean_(sub.Status)) >= 0) changes.Status = signedNow ? 'Received' : 'On hold';
  update_(ctx.subs, sub, changes);

  var missingA = ctx.animals.filter(function (a) { return !yes_(a.Received); });
  missingA.forEach(function (a) { if (a.Sample_Status === 'Awaiting sample' || !a.Sample_Status) update_(ctx.animalsT, a, { Sample_Status: 'Not received' }); });
  var received = ctx.animals.length - missingA.length;
  var many = missingA.length > 1;
  var list = missingA.map(function (a) { return (clean_(a.Flock_Tag) || clean_(a.EID)) + ' (TSU ' + normTsu_(a.TSU_Barcode) + ')'; });
  var note = [];
  if (missingA.length) note.push(missingA.length + ' TSU' + (many ? 's' : '') + ' missing');
  if (!signedNow) note.push('form needs signing');
  Object.assign(vars, { 'TSUs received': received, 'TSUs listed': ctx.animals.length, 'Missing list': joinList_(list),
    'Were/was': many ? 'were' : 'was', 'them/it': many ? 'them' : 'it', 'Subject note': note.join(', ') });
  flags = { missing: missingA.length > 0, signed: signedNow && !paperIn, paper_in: paperIn, unsigned: !signedNow, subject_note: note.length > 0 };

  try { var inv2 = ensureInvoice_(r.sid); invoiceId = inv2 ? inv2.id : ''; } catch (e) { invoiceNote = e.message; console.error(e.stack || e); }
  var d2 = draftEmail_('E05', vars, flags);
  return { draft: { to: clean_(ctx.producer.Email), subject: d2.subject, body: d2.body }, status: changes.Status || sub.Status,
    invoiceId: invoiceId, invoiceNote: invoiceNote, received: received, listed: ctx.animals.length };
}

function apiSendReceipt_(req) {
  var staff = staffName_(req);
  var r = resolveRef_(req.ref);
  var ctx = loadSubmission_(r.sid);
  var subject = clean_(req.subject), body = String(req.body || '').trim();
  if (!subject || !body) throw httpError_('The email needs a subject and a message.', 'invalid');
  sendEmail_(clean_(ctx.producer.Email), subject, body, { submissionId: r.sid, sentBy: staff, emailId: r.kind === 'replacement' ? 'E10' : 'E05' });
  return { sent: true, to: clean_(ctx.producer.Email) };
}

// ---------------------------------------------------------------- batches

function readyAnimals_() {
  var subs = table_('Submissions');
  var signed = {};
  subs.rows.forEach(function (s) { if (isSigned_(s)) signed[s.Submission_ID] = s; });
  return table_('Animals').rows.filter(function (a) {
    return yes_(a.Received) && a.Sample_Status === 'Received' && !clean_(a.Batch) && signed[a.Submission_ID];
  });
}

function apiReadySamples_() {
  var prod = {};
  table_('Producers').rows.forEach(function (p) { prod[p.Producer_ID] = p; });
  var subs = {};
  table_('Submissions').rows.forEach(function (s) { subs[s.Submission_ID] = s; });
  var groups = {};
  readyAnimals_().forEach(function (a) {
    var s = subs[a.Submission_ID];
    var g = groups[a.Submission_ID] || (groups[a.Submission_ID] = { submissionId: a.Submission_ID,
      flock: clean_((prod[s.Producer_ID] || {}).Flock_Name), received: fmtDate_(s.Received_Date), animals: [] });
    g.animals.push({ key: a.Animal_Key, tag: clean_(a.Flock_Tag) || clean_(a.EID), tsu: normTsu_(a.TSU_Barcode), replacement: !!clean_(a.Replaced_TSU),
      yob: clean_(a.Year_of_Birth), breed: clean_(a.Breed) || clean_(s.Breed), sex: clean_(a.Sex) });
  });
  var list = Object.keys(groups).map(function (k) { return groups[k]; })
    .sort(function (a, b) { return a.submissionId < b.submissionId ? -1 : 1; });
  var onHold = table_('Submissions').rows.filter(function (s) { return s.Status === 'On hold'; })
    .map(function (s) { return { submissionId: s.Submission_ID, flock: clean_((prod[s.Producer_ID] || {}).Flock_Name), received: fmtDate_(s.Received_Date),
      reminders: Number(s.Reminders_Sent) || 0, lastReminder: fmtDate_(s.Last_Reminder_Date) }; });
  return { groups: list, onHold: onHold };
}

function exportRows_(batchId) {
  var subs = {};
  table_('Submissions').rows.forEach(function (x) { subs[x.Submission_ID] = x; });
  return table_('Animals').rows.filter(function (a) { return a.Batch === batchId; })
    .sort(function (x, y) { return x.Submission_ID < y.Submission_ID ? -1 : x.Submission_ID > y.Submission_ID ? 1 : x._row - y._row; })
    .map(function (a) { return { animalKey: a.Animal_Key, yob: clean_(a.Year_of_Birth), breed: clean_(a.Breed) || clean_((subs[a.Submission_ID] || {}).Breed),
      sex: clean_(a.Sex), tsu: normTsu_(a.TSU_Barcode) }; });
}

function apiCreateBatch_(req) {
  var staff = staffName_(req);
  var keys = (req.keys || []).map(String);
  if (!keys.length) throw httpError_('Pick at least one sample.', 'invalid');
  var ready = {};
  readyAnimals_().forEach(function (a) { ready[a.Animal_Key] = a; });
  var bad = keys.filter(function (k) { return !ready[k]; });
  if (bad.length) throw httpError_('Some samples are no longer ready (already batched or not received): ' + bad.slice(0, 5).join(', '), 'invalid');

  var batchesT = table_('Batches');
  var year = today_().getFullYear(), max = 0;
  batchesT.rows.forEach(function (b) { var m = String(b.Batch_ID).match(new RegExp('^B' + year + '-(\\d+)$')); if (m) max = Math.max(max, Number(m[1])); });
  var id = 'B' + year + '-' + ('0' + (max + 1)).slice(-2);
  var s = settings_();
  append_(batchesT, [{ Batch_ID: id, Lab: s.Genotyping_Lab || 'GenomNZ', Status: 'Building', Created_Date: today_(), Created_By: staff }]);
  var animalsT = table_('Animals'), replT = table_('Replacements');
  keys.forEach(function (k) {
    var a = find_(animalsT, 'Animal_Key', k);
    update_(animalsT, a, { Batch: id });
    filter_(replT, 'Animal_Key', k).forEach(function (r) { if (yes_(r.Received) && !clean_(r.New_Batch)) update_(replT, r, { New_Batch: id }); });
  });
  return { batchId: id, birthFlock: s.GenomNZ_Birth_Flock, rows: exportRows_(id) };
}

function apiSaveBatchFile_(req) {
  staffName_(req);
  var batchesT = table_('Batches');
  var b = find_(batchesT, 'Batch_ID', clean_(req.batchId));
  if (!b) throw httpError_('No batch ' + req.batchId + '.', 'not_found');
  var f = saveBase64_(settingFolder_('Batches_Folder_ID'), b.Batch_ID + '_GenomNZ.xlsx', req.base64,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  update_(batchesT, b, { Export_File: fileUrl_(f) });
  return { saved: true };
}

function apiBatchRows_(req) {
  var b = find_(table_('Batches'), 'Batch_ID', clean_(req.batchId));
  if (!b) throw httpError_('No batch ' + req.batchId + '.', 'not_found');
  return { batchId: b.Batch_ID, birthFlock: settings_().GenomNZ_Birth_Flock, rows: exportRows_(b.Batch_ID) };
}

function apiMarkShipped_(req) {
  var staff = staffName_(req);
  var batchesT = table_('Batches');
  var b = find_(batchesT, 'Batch_ID', clean_(req.batchId));
  if (!b) throw httpError_('No batch ' + req.batchId + '.', 'not_found');
  if (b.Status !== 'Building') throw httpError_(b.Batch_ID + ' is already marked ' + b.Status + '.', 'invalid');
  var shipDate = req.shipDate && /^\d{4}-\d{2}-\d{2}$/.test(req.shipDate) ? dateFromIso_(req.shipDate) : today_();
  update_(batchesT, b, { Status: 'Shipped', Shipped_Date: shipDate, Notes: (clean_(b.Notes) ? clean_(b.Notes) + ' ' : '') + 'Shipped by ' + staff });
  var animalsT = table_('Animals');
  var bySub = {};
  animalsT.rows.filter(function (a) { return a.Batch === b.Batch_ID; }).forEach(function (a) {
    update_(animalsT, a, { Sample_Status: 'At lab' });
    bySub[a.Submission_ID] = (bySub[a.Submission_ID] || 0) + 1;
  });
  var s = settings_(), emailed = 0, failed = [];
  Object.keys(bySub).forEach(function (sid) {
    var ctx = loadSubmission_(sid);
    if (['Received', 'Submitted'].indexOf(ctx.sub.Status) >= 0) update_(ctx.subs, ctx.sub, { Status: 'At lab' });
    try {
      sendTemplate_('E07', ctx.producer.Email, Object.assign(producerVars_(ctx, s), { 'Animal count': bySub[sid], 'Shipped date': fmtDate_(shipDate) }),
        {}, { submissionId: sid, sentBy: staff });
      emailed++;
    } catch (e) { failed.push(sid); }
  });
  return { batchId: b.Batch_ID, submissions: Object.keys(bySub).length, emailed: emailed, failed: failed };
}

function apiCancelBatch_(req) {
  var staff = staffName_(req);
  var batchesT = table_('Batches');
  var b = find_(batchesT, 'Batch_ID', clean_(req.batchId));
  if (!b) throw httpError_('No batch ' + req.batchId + '.', 'not_found');
  if (b.Status !== 'Building') throw httpError_('Only a batch that has not shipped can be cancelled.', 'invalid');
  var animalsT = table_('Animals'), replT = table_('Replacements'), n = 0;
  animalsT.rows.filter(function (a) { return a.Batch === b.Batch_ID; }).forEach(function (a) { update_(animalsT, a, { Batch: '' }); n++; });
  replT.rows.filter(function (r) { return r.New_Batch === b.Batch_ID; }).forEach(function (r) { update_(replT, r, { New_Batch: '' }); });
  update_(batchesT, b, { Status: 'Cancelled', Notes: (clean_(b.Notes) ? clean_(b.Notes) + ' ' : '') + 'Cancelled by ' + staff });
  return { batchId: b.Batch_ID, released: n };
}

function apiBatches_() {
  var t = table_('Batches');
  var counts = {};
  table_('Animals').rows.forEach(function (a) { if (a.Batch) counts[a.Batch] = (counts[a.Batch] || 0) + 1; });
  return { batches: t.rows.slice().reverse().slice(0, 25).map(function (b) {
    return { id: b.Batch_ID, status: clean_(b.Status), created: fmtDate_(b.Created_Date), createdBy: clean_(b.Created_By),
      shipped: fmtDate_(b.Shipped_Date), resultsIn: fmtDate_(b.Results_Received_Date), samples: counts[b.Batch_ID] || 0, hasFile: !!clean_(b.Export_File) };
  }) };
}
