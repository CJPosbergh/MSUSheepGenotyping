/**
 * What producers do with their private link: see status and results, sign, register replacement TSUs,
 * download the report files.
 */

var STATUS_LABEL = {
  'Awaiting sample': 'Waiting for sample', 'Received': 'Received', 'Not received': 'Sample not received',
  'At lab': 'At the lab', 'Complete': 'Complete', 'Failed QC': 'Resample needed', 'Awaiting replacement': 'Replacement on its way'
};

function apiStatus_(req) {
  var found = submissionByToken_(req.token);
  var sub = found.row;
  var ctx = loadSubmission_(sub.Submission_ID);
  var released = sub.Status === 'Results released' || !!sub.Results_Released_Date;
  var conds = table_('Conditions').rows.filter(function (c) { return yes_(c.Active); })
    .sort(function (a, b) { return (Number(a.Sort_Order) || 99) - (Number(b.Sort_Order) || 99); });
  var condMap = {};
  conds.forEach(function (c) { condMap[c.Condition_ID] = c; });

  var results = released ? filter_(table_('Results'), 'Submission_ID', sub.Submission_ID).filter(function (r) { return yes_(r.Released); }) : [];
  var parentage = released ? filter_(table_('Parentage'), 'Submission_ID', sub.Submission_ID).filter(function (r) { return yes_(r.Released); }) : [];
  var repl = filter_(table_('Replacements'), 'Submission_ID', sub.Submission_ID);
  var batches = {};
  table_('Batches').rows.forEach(function (b) { batches[b.Batch_ID] = b; });

  var shipped = null;
  var animals = ctx.animals.map(function (a) {
    var b = batches[a.Batch];
    if (b && b.Shipped_Date && (!shipped || new Date(b.Shipped_Date) < shipped)) shipped = new Date(b.Shipped_Date);
    var pending = repl.filter(function (r) { return r.Animal_Key === a.Animal_Key && !yes_(r.Received); })[0];
    var attention = a.Sample_Status === 'Failed QC' ? 'qc' : a.Sample_Status === 'Not received' ? 'missing' : null;
    if (pending) attention = null;
    var res = results.filter(function (r) { return r.Animal_Key === a.Animal_Key; }).map(function (r) {
      var c = condMap[r.Condition_ID] || {};
      return { condition: r.Condition_ID, name: c.Display_Name || r.Condition_ID, genotype: clean_(r.Genotype), call: clean_(r.Call),
        label: clean_(r.Result_Label), category: clean_(r.Category), showOnWeb: yes_(c.Show_On_Web) };
    });
    var par = parentage.filter(function (p) { return p.Animal_Key === a.Animal_Key; })[0];
    return {
      key: a.Animal_Key, tag: clean_(a.Flock_Tag), eid: clean_(a.EID), nsip: clean_(a.NSIP_ID), tsu: clean_(a.TSU_Barcode),
      sex: clean_(a.Sex), born: clean_(a.Year_of_Birth), breed: clean_(a.Breed), batch: clean_(a.Batch),
      sampleStatus: clean_(a.Sample_Status), stateLabel: STATUS_LABEL[a.Sample_Status] || clean_(a.Sample_Status),
      attention: attention, replacement: pending ? { id: pending.Replacement_ID, tsu: clean_(pending.New_TSU), reason: clean_(pending.Reason) } : null,
      parentageRequested: yes_(a.Test_Parentage), results: res,
      parentage: par ? { sire: { reported: clean_(par.Reported_Sire), result: clean_(par.Sire_Result), assigned: clean_(par.Sire_Assigned) },
                         dam: { reported: clean_(par.Reported_Dam), result: clean_(par.Dam_Result), assigned: clean_(par.Dam_Assigned) },
                         notes: clean_(par.Notes) } : null
    };
  });

  var replacements = {};
  repl.forEach(function (r) {
    var g = replacements[r.Replacement_ID] || (replacements[r.Replacement_ID] = { id: r.Replacement_ID, requested: fmtDate_(r.Requested_Date), items: [] });
    var a = find_(ctx.animalsT, 'Animal_Key', r.Animal_Key) || {};
    g.items.push({ key: r.Animal_Key, tag: clean_(a.Flock_Tag) || clean_(a.EID), reason: clean_(r.Reason),
      tsu: clean_(r.New_TSU), original: clean_(r.Original_TSU) === clean_(r.New_TSU), received: yes_(r.Received) });
  });

  var signed = isSigned_(sub);
  var who = contactOf_(sub, ctx.producer);
  return {
    submission: {
      id: sub.Submission_ID, flock: who.flock, contact: who.name,
      email: clean_(ctx.producer.Email), submitted: fmtDate_(sub.Submitted_Date), breed: clean_(sub.Breed),
      animalCount: ctx.animals.length, status: clean_(sub.Status), received: fmtDate_(sub.Received_Date),
      receivedCount: ctx.animals.filter(function (a) { return yes_(a.Received); }).length,
      shipped: fmtDate_(shipped), released: fmtDate_(sub.Results_Released_Date), signatureMethod: clean_(sub.Signature_Method),
      signed: signed, signedDate: fmtDate_(sub.Signed_Date), needsSignature: !signed,
      files: { pdf: released && !!clean_(sub.Results_PDF), excel: released && !!clean_(sub.Results_Excel) }
    },
    animals: animals,
    conditions: conds.map(function (c) { return { id: c.Condition_ID, name: clean_(c.Display_Name), showOnWeb: yes_(c.Show_On_Web), explanation: clean_(c.Explanation) }; }),
    replacements: Object.keys(replacements).map(function (k) { return replacements[k]; })
  };
}

function apiSign_(req) {
  var found = submissionByToken_(req.token);
  var sub = found.row;
  if (isSigned_(sub)) throw httpError_('This submission is already signed. Thank you!', 'already_signed');
  if (req.research !== 'Y' && req.research !== 'N') throw httpError_('Please answer the research question.', 'invalid');
  if (!req.agree) throw httpError_('Please tick "I agree" to sign.', 'invalid');
  var name = clean_(req.name);
  if (!name) throw httpError_('Please type your full name to sign.', 'invalid');
  var changes = { Signed_By: name, Signed_Date: new Date(), Research_Use: req.research, Signature_Method: 'Online' };
  var boxArrived = !!sub.Received_Date;
  if (sub.Status === 'On hold') changes.Status = 'Received';
  update_(found.t, sub, changes);
  var ctx = loadSubmission_(sub.Submission_ID);
  var s = settings_();
  try {
    sendTemplate_('E04', ctx.producer.Email, Object.assign(producerVars_(ctx, s), {
      'Signer name': name, 'Signed date': fmtDate_(new Date()), 'Research answer': req.research === 'Y' ? 'Yes' : 'No'
    }), { box_arrived: boxArrived }, { submissionId: sub.Submission_ID });
  } catch (e) { console.error('E04 for ' + sub.Submission_ID + ': ' + e.message); }
  return { signed: true, signer: name, signedDate: fmtDate_(new Date()), boxArrived: boxArrived, email: ctx.producer.Email };
}

function allTsus_() {
  var used = {};
  table_('Animals').rows.forEach(function (a) { used[clean_(a.TSU_Barcode).toUpperCase()] = a.Animal_Key; if (a.Replaced_TSU) used[clean_(a.Replaced_TSU).toUpperCase()] = a.Animal_Key; });
  table_('Replacements').rows.forEach(function (r) { used[clean_(r.New_TSU).toUpperCase()] = r.Animal_Key; used[clean_(r.Original_TSU).toUpperCase()] = r.Animal_Key; });
  delete used[''];
  return used;
}

function apiRegisterReplacement_(req) {
  var found = submissionByToken_(req.token);
  var sub = found.row;
  var ctx = loadSubmission_(sub.Submission_ID);
  var replT = table_('Replacements');
  var existing = filter_(replT, 'Submission_ID', sub.Submission_ID);
  var used = allTsus_();
  var items = (req.items || []).filter(function (i) { return i && i.animalKey; });
  if (!items.length) throw httpError_('Tick at least one animal.', 'invalid');

  var rows = [], lines = [], seen = {};
  items.forEach(function (it) {
    var a = find_(ctx.animalsT, 'Animal_Key', it.animalKey);
    if (!a || a.Submission_ID !== sub.Submission_ID) throw httpError_('That animal is not on this submission.', 'invalid');
    var open = existing.filter(function (r) { return r.Animal_Key === a.Animal_Key && !yes_(r.Received); })[0];
    if (open) throw httpError_('A replacement for ' + (a.Flock_Tag || a.EID) + ' is already on its way (' + open.Replacement_ID + ').', 'invalid');
    var reason = a.Sample_Status === 'Failed QC' ? 'Failed QC' : a.Sample_Status === 'Not received' ? 'Not received' : '';
    if (!reason) throw httpError_((a.Flock_Tag || a.EID) + ' doesn\'t need a replacement.', 'invalid');
    var original = clean_(a.TSU_Barcode).toUpperCase();
    var tsu = reason === 'Not received' && it.useOriginal ? original : clean_(it.tsu).replace(/\s/g, '').toUpperCase();
    var tag = clean_(a.Flock_Tag) || clean_(a.EID);
    if (!tsu) throw httpError_('Enter the new TSU barcode for ' + tag + '.', 'invalid');
    if (!/^[A-Z0-9-]{4,24}$/.test(tsu)) throw httpError_('TSU barcode "' + tsu + '" doesn\'t look right.', 'invalid');
    if (reason === 'Failed QC' && tsu === original) throw httpError_('Use a new TSU for ' + tag + ' (' + tsu + ' is the one that failed).', 'invalid');
    if (tsu !== original && used[tsu]) throw httpError_('TSU ' + tsu + ' has already been used. Please use a new one.', 'invalid');
    if (seen[tsu]) throw httpError_('TSU ' + tsu + ' is listed twice.', 'invalid');
    seen[tsu] = 1;
    rows.push({ a: a, reason: reason, original: original, tsu: tsu });
    lines.push('- ' + tag + ': ' + (tsu === original ? 'original TSU ' : 'new TSU ') + tsu);
  });

  var ids = {};
  existing.forEach(function (r) { ids[r.Replacement_ID] = 1; });
  var rid = sub.Submission_ID + '-R' + (Object.keys(ids).length + 1);
  append_(replT, rows.map(function (x) {
    return { Replacement_ID: rid, Animal_Key: x.a.Animal_Key, Submission_ID: sub.Submission_ID, Reason: x.reason,
      Original_TSU: x.original, New_TSU: x.tsu, Original_Batch: clean_(x.a.Batch), Requested_Date: today_(), Received: '' };
  }));
  rows.forEach(function (x) { update_(ctx.animalsT, x.a, { Sample_Status: 'Awaiting replacement' }); });

  var s = settings_();
  var slip = siteUrl_(s, 'slip.html', { t: sub.Private_Link_Token, r: rid });
  try {
    sendTemplate_('E09', ctx.producer.Email, Object.assign(producerVars_(ctx, s), {
      'Replacement ID': rid, 'Replacement list': lines.join('\n'), 'Slip link': slip
    }), {}, { submissionId: sub.Submission_ID });
  } catch (e) { console.error('E09 for ' + rid + ': ' + e.message); }
  return { replacementId: rid, slipUrl: slip, email: ctx.producer.Email, count: rows.length };
}

function apiDownload_(req) {
  var found = submissionByToken_(req.token);
  var sub = found.row;
  if (!(sub.Status === 'Results released' || sub.Results_Released_Date)) throw httpError_('Results are not ready yet.', 'not_ready');
  var url = req.kind === 'excel' ? sub.Results_Excel : sub.Results_PDF;
  var id = folderIdFromUrl_(url);
  if (!id) throw httpError_('That file is not available yet.', 'not_ready');
  var file = DriveApp.getFileById(id);
  var blob = file.getBlob();
  return { name: file.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

/** Everything the printable packing slip needs: the submission's TSUs, or one replacement's (req.r). */
function apiSlip_(req) {
  var found = submissionByToken_(req.token);
  var sub = found.row;
  var ctx = loadSubmission_(sub.Submission_ID);
  var p = contactOf_(sub, ctx.producer);
  var byKey = {};
  ctx.animals.forEach(function (a) { byKey[a.Animal_Key] = a; });
  var item = function (a, tsu) {
    return { tag: clean_(a.Flock_Tag), tsu: clean_(tsu), eid: clean_(a.EID), sex: clean_(a.Sex), born: clean_(a.Year_of_Birth) };
  };
  var out = {
    kind: 'original', ref: sub.Submission_ID, submissionId: sub.Submission_ID, flock: p.flock,
    contact: p.name, address: p.address, phone: p.phone,
    date: fmtDate_(sub.Submitted_Date), signed: isSigned_(sub), signatureMethod: clean_(sub.Signature_Method), items: []
  };
  var rid = clean_(req.r);
  if (rid) {
    var rows = filter_(table_('Replacements'), 'Submission_ID', sub.Submission_ID).filter(function (r) { return r.Replacement_ID === rid; });
    if (!rows.length) throw httpError_('We could not find replacement ' + rid + ' on this submission.', 'not_found');
    out.kind = 'replacement';
    out.ref = rid;
    out.date = fmtDate_(rows[0].Requested_Date);
    out.items = rows.map(function (r) { return item(byKey[r.Animal_Key] || {}, r.New_TSU); });
  } else {
    // Animals re-sampled later keep their first TSU in Replaced_TSU; the original slip lists what was on the form.
    out.items = ctx.animals.map(function (a) { return item(a, clean_(a.Replaced_TSU) || a.TSU_Barcode); });
  }
  return out;
}
