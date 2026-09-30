/**
 * Producer submissions and research photos.
 */

function apiSubmit_(req) {
  if (clean_(req.website)) throw httpError_('Submission rejected.', 'spam');   // hidden field only bots fill in

  var v = validateSubmission(req.submitter || {}, req.animals || [], today_().getFullYear());
  var errors = v.errors.slice();
  var sig = req.signature || {};
  var method = sig.method === 'paper' ? 'Paper' : 'Online';
  if (method === 'Online') {
    if (sig.research !== 'Y' && sig.research !== 'N') errors.push({ row: null, field: 'Consent', message: 'Answer the research question.' });
    if (!sig.agree) errors.push({ row: null, field: 'Consent', message: 'Tick "I agree" to sign.' });
    if (!clean_(sig.name)) errors.push({ row: null, field: 'Consent', message: 'Type your full name to sign.' });
  } else if (!sig.paperAck) {
    errors.push({ row: null, field: 'Consent', message: 'Tick that you will put the signed consent form in your box.' });
  }

  // TSUs already used on another submission (originals or replacements)
  var animalsT = table_('Animals');
  var used = allTsus_();         // every TSU on Animals (current and replaced) and Replacements
  v.animals.forEach(function (a) {
    var k = a.tsu && used[String(a.tsu).toUpperCase()];
    if (k) errors.push({ row: a.row, field: 'TSU_Barcode', message: 'TSU ' + a.tsu + ' was already used on submission ' + String(k).replace(/^(P\d+-\d+).*$/, '$1') + '. Each TSU can only be used once.' });
  });
  if (errors.length) {
    var e = httpError_('Your form needs a few fixes before it can be submitted.', 'invalid');
    e.details = errors;
    throw e;
  }

  var s = settings_();
  var sub = v.submitter;
  var prodT = table_('Producers');
  var producer = prodT.rows.filter(function (p) { return clean_(p.Email).toLowerCase() === sub.email; })[0];
  var profile = { Flock_Name: sub.flock, Contact_Name: sub.name, Email: sub.email, Phone: sub.phone,
    Mailing_Address: sub.address, NSIP_Flock_ID: sub.nsipFlockId };
  // An existing producer's record is never changed from the public form (anyone could type their email).
  // What this form said is kept on the submission, and differences are flagged for staff.
  var staffNote = '';
  if (producer) {
    var differ = Object.keys(profile).filter(function (k) { return profile[k] && clean_(producer[k]).toLowerCase() !== String(profile[k]).toLowerCase(); });
    if (differ.length) staffNote = 'Form contact details differ from ' + producer.Producer_ID + ' on Producers (' + differ.join(', ').replace(/_/g, ' ') +
      '). See Contact_On_Form; update Producers if they really changed.';
  } else {
    producer = append_(prodT, [Object.assign({ Producer_ID: nextProducerId_(prodT), First_Submitted: today_(), Notes: '' }, profile)])[0];
  }

  var subsT = table_('Submissions');
  var sid = nextSubmissionId_(subsT, producer.Producer_ID);
  var token = newToken_();
  var online = method === 'Online';
  var subRow = append_(subsT, [{
    Submission_ID: sid, Producer_ID: producer.Producer_ID, Submitted_Date: today_(), Breed: breedSummary_(v.animals),
    Research_Use: online ? sig.research : '', Signed_By: online ? clean_(sig.name) : '', Signed_Date: online ? new Date() : '',
    Producer_Notes: clean_(req.notes), Form_File: '', Private_Link_Token: token, Status: 'Submitted',
    Signature_Method: method, Reminders_Sent: 0, Staff_Notes: staffNote,
    Contact_On_Form: [sub.name, sub.flock, sub.address, sub.phone].map(function (x) { return clean_(x).replace(/\|/g, '/'); }).join(' | ')
  }])[0];

  var keys = {};
  append_(animalsT, v.animals.map(function (a) {
    var key = animalKey_(sid, a);
    keys[a.row] = key;
    return {
      Animal_Key: key, Submission_ID: sid, Flock_Tag: a.flockTag, EID: a.eid, NSIP_ID: a.nsipId, TSU_Barcode: a.tsu,
      Sex: a.sex, Year_of_Birth: a.yob, Reported_Sire: a.sire, Reported_Dam: a.dam, Test_Conditions: a.testConditions,
      Test_Parentage: a.testParentage, Received: '', Sample_Status: 'Awaiting sample', Notes: a.comments,
      Breed: a.breed, Birth_Flock: a.birthFlock
    };
  }));

  // Save the uploaded Excel file (skipped, not fatal, if Drive is not set up yet)
  try {
    if (req.form && req.form.base64) {
      var folder = submissionFolder_(subsT, subRow);
      var f = saveBase64_(folder, sid + '_form.xlsx', req.form.base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      update_(subsT, subRow, { Form_File: fileUrl_(f) });
    }
  } catch (err) { console.error('Saving form for ' + sid + ': ' + err.message); }

  var emailed = true;
  try {
    var ctx = { sub: subRow, producer: producer, animals: v.animals };
    sendTemplate_(online ? 'E01' : 'E02', producer.Email, producerVars_(ctx, s), {}, { submissionId: sid });
  } catch (err) { emailed = false; console.error('Confirmation email for ' + sid + ': ' + err.message); }

  return { submissionId: sid, token: token, emailed: emailed, email: producer.Email,
    photosAllowed: online && sig.research === 'Y', animalKeys: keys };
}

function apiUploadPhoto_(req) {
  var found = submissionByToken_(req.token);
  var sub = found.row;
  if (sub.Signature_Method !== 'Online' || !yes_(sub.Research_Use))
    throw httpError_('Photos can only be added when you sign online and allow research use.', 'not_allowed');
  var animal = find_(table_('Animals'), 'Animal_Key', clean_(req.animalKey));
  if (!animal || animal.Submission_ID !== sub.Submission_ID) throw httpError_('That animal is not on this submission.', 'not_found');
  var photosT = table_('Photos');
  var existing = filter_(photosT, 'Animal_Key', animal.Animal_Key);
  if (existing.length >= 5) throw httpError_('This animal already has 5 photos.', 'limit');
  var data = String(req.data || '');
  if (!data || data.length > 8 * 1024 * 1024) throw httpError_('That photo is too large. Please try a smaller one.', 'too_large');
  var n = existing.length + 1;
  var folder = childFolder_(submissionFolder_(found.t, sub), 'Photos');
  var file = saveBase64_(folder, animal.Animal_Key + '-' + n + '.jpg', data, 'image/jpeg');
  append_(photosT, [{ Animal_Key: animal.Animal_Key, Submission_ID: sub.Submission_ID, Photo_No: n,
    Drive_Link: fileUrl_(file), Uploaded_Date: today_() }]);
  return { animalKey: animal.Animal_Key, photoNo: n };
}
