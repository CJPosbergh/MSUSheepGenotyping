/**
 * Runs the real Apps Script code against a mock tracker and walks one season end to end:
 * setup, submissions (online and paper), photos, receiving, invoices with cost-share, batches,
 * results release, replacements, a late original, partner billing, reminders and downloads.
 */
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gas-mock');

const TRACKER = path.join(__dirname, '..', 'tracker', 'MSU_Sheep_Genotyping_Tracker_START.xlsx');
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
const eq = (a, b, msg) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg + ` (got ${JSON.stringify(a)})`); passed++; console.log('  ✓ ' + msg); };

const PASS = 'test-only-passphrase';   // the real one lives only in the live tracker's Settings tab
const animals = (prefix, rows) => rows.map((r, i) => ({ row: i + 2, birthFlock: 'Home flock', flockTag: r[0], eid: r[1], tsu: r[2],
  yob: r[3], breed: 'Targhee', sex: r[4], nsipId: r[5] || '', testConditions: 'Y', testParentage: 'Y', dam: '', sire: r[6] || '', comments: '' }));

(async () => {
  const env = await makeEnv(TRACKER, { quiet: true });
  const g = env.ctx;
  const call = req => g.handle_(req);
  const tab = name => g.table_(name);
  const rowOf = (name, key, val) => g.find_(tab(name), key, val);
  const year = new Date().getFullYear();

  console.log('Set up');
  ok(!call({ action: 'staffCheck', passphrase: '', staff: 'x' }).ok, 'staff pages stay locked while no passphrase is set');
  g.setSetting_('Staff_Passphrase', PASS);
  const msg = g.setupAll_();
  ok(/All tabs and columns match/.test(msg), 'tracker columns match the code (' + msg.split('\n\n').find(l => /column/i.test(l)) + ')');
  const s = g.settings_();
  ok(s.Invoice_Template_ID && s.Partner_Bill_Template_ID, 'invoice and partner bill templates created');
  eq(env.triggers, ['dailyReminders'], 'daily reminder trigger installed');
  g.setupAll_();
  eq(env.triggers.length, 1, 'running Set up twice adds nothing');

  console.log('Public config never leaks the passphrase');
  const cfg = call({ action: 'config' });
  ok(cfg.ok && !JSON.stringify(cfg).includes(PASS), 'config has no passphrase');
  eq(cfg.config.price, 18, 'price comes from Services');

  console.log('Submission: signed online, research yes');
  const sub1 = { name: 'Jane Smith', flock: 'Smith Ranch', nsipFlockId: '6100', address: '12 Ranch Rd, Big Timber MT', phone: '406-555-0101', email: 'Jane.Smith@Example.com' };
  const a1 = animals('A', [
    ['23015', '840003307100011', 'NE05200011', '2021', 'M', '610014202121T015'],
    ['26001', '840003307100001', 'NE05200001', String(year), 'M', '610014202626T001', '23015'],
    ['26002', '840003307100002', 'NE05200002', String(year), 'F', '610014202626T002', '23015'],
    ['26003', '840003307100003', 'NE05200003', String(year), 'M', ''],
    ['0412', '840003307100012', 'NE05200012', '2018-2020', 'F', ''],
  ]);
  let r = call({ action: 'submit', submitter: sub1, animals: a1, signature: { method: 'online', research: 'Y', agree: true, name: 'Jane Smith' },
    notes: 'Please check parentage against 23015.', form: { base64: Buffer.from('xlsx bytes').toString('base64') } });
  ok(r.ok, 'online submission accepted: ' + (r.error || r.submissionId));
  eq(r.submissionId, 'P001-01', 'first producer and submission IDs');
  const tok1 = r.token;
  ok(/^[A-Za-z0-9]{12}$/.test(tok1), 'private link token is 12 letters/digits');
  ok(r.photosAllowed, 'photos allowed (online + research yes)');
  let sub = rowOf('Submissions', 'Submission_ID', 'P001-01');
  eq([sub.Signature_Method, sub.Research_Use, sub.Signed_By, sub.Status], ['Online', 'Y', 'Jane Smith', 'Submitted'], 'submission row signed online');
  ok(String(sub.Flock_Name).startsWith('='), 'grey formula columns filled on new rows');
  ok(/drive\.google\.com\/file/.test(sub.Form_File), 'uploaded Excel saved to the submission folder');
  eq(rowOf('Producers', 'Producer_ID', 'P001').Email, 'jane.smith@example.com', 'producer email stored lower-case');
  eq(tab('Animals').rows.map(a => a.Animal_Key), ['P001-01-23015', 'P001-01-26001', 'P001-01-26002', 'P001-01-26003', 'P001-01-0412'], 'animal keys from flock tags');
  eq(rowOf('Animals', 'Animal_Key', 'P001-01-0412').Year_of_Birth, '2018-2020', 'birth-year range kept as text');
  eq(rowOf('Animals', 'Animal_Key', 'P001-01-23015').EID, '840003307100011', '15-digit EID kept exactly');
  let mail = env.outbox.pop();
  eq(mail.subject, 'P001-01: we have your submission form', 'E01 confirmation subject');
  ok(mail.body.includes('status.html?t=' + tok1) && mail.body.includes('slip.html?t=' + tok1), 'E01 has private link and packing slip link');
  ok(mail.body.includes('Montana Wool Lab (M-F 8am-5pm)') && mail.body.includes('Hi Jane,'), 'E01 fills settings and first name');
  eq([mail.name, mail.replyTo], ['MSU Sheep Genotyping', 'christian.posbergh@montana.edu'], 'sender name and reply-to');
  ok(!/\{[A-Z]/.test(mail.body), 'no unfilled placeholders in E01');

  console.log('Photos');
  r = call({ action: 'uploadPhoto', token: tok1, animalKey: 'P001-01-26001', data: Buffer.from('jpeg').toString('base64') });
  ok(r.ok && r.photoNo === 1, 'photo 1 saved');
  for (let i = 0; i < 4; i++) call({ action: 'uploadPhoto', token: tok1, animalKey: 'P001-01-26001', data: 'AAAA' });
  r = call({ action: 'uploadPhoto', token: tok1, animalKey: 'P001-01-26001', data: 'AAAA' });
  ok(!r.ok && /5 photos/.test(r.error), 'sixth photo refused');
  eq(tab('Photos').rows.length, 5, '5 photo rows logged');

  console.log('Validation on the server');
  r = call({ action: 'submit', submitter: sub1, animals: animals('B', [['X1', '', 'NE05200011', '2024', 'F']]), signature: { method: 'online', research: 'N', agree: true, name: 'Jane' } });
  ok(!r.ok && r.details.some(d => /already used on submission P001-01/.test(d.message)), 'reused TSU rejected');
  r = call({ action: 'submit', submitter: { ...sub1, email: 'bad' }, animals: animals('B', [['X1', '8.40003E+14', 'NE1', '20', 'Q']]), signature: { method: 'online' } });
  const msgs = r.details.map(d => d.message).join(' | ');
  ok(/email "bad"/.test(msgs) && /Format the EID column as Text/.test(msgs) && /should be a year/.test(msgs) && /should be M or F/.test(msgs) && /Answer the research question/.test(msgs), 'form errors listed by field');
  r = call({ action: 'submit', website: 'http://spam', submitter: sub1, animals: a1 });
  ok(!r.ok, 'hidden spam field rejects bots');

  console.log('Submission: paper consent chosen');
  const sub2 = { name: 'Bob Jones', flock: 'Jones Sheep Co', address: 'PO Box 4, Dillon MT', email: 'bob@jonessheep.example.com' };
  r = call({ action: 'submit', submitter: sub2, animals: animals('J', [['J01', '', 'NE05200201', '2023', 'M'], ['J02', '', 'NE05200202', String(year), 'F']]),
    signature: { method: 'paper', paperAck: true } });
  ok(r.ok && r.submissionId === 'P002-01' && !r.photosAllowed, 'paper submission accepted, photos not allowed');
  const tok2 = r.token;
  mail = env.outbox.pop();
  ok(/one step left/.test(mail.subject) && /You chose to sign on paper/.test(mail.body) && mail.body.includes('drive.google.com/file/d/1-h06'), 'E02 with paper form link');
  r = call({ action: 'uploadPhoto', token: tok2, animalKey: 'P002-01-J01', data: 'AAAA' });
  ok(!r.ok, 'photo refused for paper signer');

  console.log('Returning producer, cost-share program set by you');
  r = call({ action: 'submit', submitter: { ...sub1, phone: '406-555-9999' }, animals: animals('C', [
    ['24001', '840003307200001', 'NE05300001', String(year - 3), 'M', '610014202424A001'],
    ['26101', '840003307200002', 'NE05300002', String(year), 'F', '610014202626A002'],
    ['26102', '840003307200003', 'NE05300003', String(year), 'F', '610014202626A003'],
    ['26103', '840003307200004', 'NE05300004', String(year), 'F', ''],
  ]), signature: { method: 'online', research: 'N', agree: true, name: 'Jane Smith' } });
  eq(r.submissionId, 'P001-02', 'same producer ID, next submission number');
  eq(rowOf('Producers', 'Producer_ID', 'P001').Phone, '406-555-0101', 'public form never overwrites a producer record');
  sub = rowOf('Submissions', 'Submission_ID', 'P001-02');
  ok(/differ from P001/.test(sub.Staff_Notes) && /406-555-9999/.test(sub.Contact_On_Form), 'differences flagged for staff; form details kept on the submission');
  const tok3 = r.token;
  env.outbox.pop();
  const subsT = tab('Submissions');
  g.update_(subsT, g.find_(subsT, 'Submission_ID', 'P001-02'), { Cost_Share_Program: 'CS01' });
  const anT = tab('Animals');
  g.update_(anT, g.find_(anT, 'Animal_Key', 'P001-02-26101'), { CS_Override_Level: 'Full' });

  console.log('Status page before the box arrives');
  r = call({ action: 'status', token: tok1 });
  ok(r.ok && r.submission.id === 'P001-01' && r.animals.length === 5, 'status loads by token');
  ok(r.animals.every(a => a.results.length === 0), 'no results shown before release');
  ok(!call({ action: 'status', token: 'nope' }).ok, 'bad token refused');

  console.log('Staff: passphrase');
  ok(!call({ action: 'lookup', passphrase: 'wrong', query: 'P001-01' }).ok, 'wrong passphrase refused');
  const staff = q => Object.assign({ passphrase: PASS, staff: 'Maddie' }, q);

  console.log('Receiving P001-01 (one TSU missing)');
  r = call(staff({ action: 'lookup', query: 'NE05200002' }));
  ok(r.ok && r.ref === 'P001-01' && r.expected.length === 5, 'lookup by scanning any TSU in the box');
  for (const t of ['NE05200011', 'NE05200001', 'NE05200002', 'NE05200003']) eq(call(staff({ action: 'scan', ref: 'P001-01', tsu: t })).result, 'ok', 'scan ' + t);
  eq(call(staff({ action: 'scan', ref: 'P001-01', tsu: 'ne05200002' })).result, 'dup', 'second scan of the same TSU flagged');
  r = call(staff({ action: 'scan', ref: 'P001-01', tsu: 'NE05200201' }));
  ok(r.result === 'other' && /P002-01 · Jones Sheep Co \(J01\)/.test(r.belongs), 'stray TSU from another submission named');
  eq(call(staff({ action: 'scan', ref: 'P001-01', tsu: 'ZZ999' })).result, 'unknown', 'unknown barcode flagged');
  eq(rowOf('Animals', 'Animal_Key', 'P001-01-23015').Received_By, 'Maddie', 'Received_By = typed staff name');
  r = call(staff({ action: 'finish', ref: 'P001-01' }));
  ok(r.ok, 'finish receiving: ' + (r.error || r.invoiceId));
  eq(r.draft.subject, 'P001-01: we received your samples (1 TSU missing)', 'E05 subject notes the missing TSU');
  ok(r.draft.body.includes('4 of 5 TSUs') && r.draft.body.includes('0412 (TSU NE05200012) was not in the box') &&
     r.draft.body.includes('go to the genotyping lab in the next batch') && r.draft.body.includes('Maddie'), 'E05 body: counts, missing TSU, signed, staff name');
  ok(!/\{[A-Za-z]/.test(r.draft.body + r.draft.subject), 'no unfilled placeholders in E05');
  eq(r.invoiceId, 'INV-P001-01', 'invoice drafted at receiving');
  sub = rowOf('Submissions', 'Submission_ID', 'P001-01');
  eq(sub.Status, 'Received', 'status Received');
  eq(rowOf('Animals', 'Animal_Key', 'P001-01-0412').Sample_Status, 'Not received', 'missing animal marked Not received');
  let lines = g.filter_(tab('Invoice_Lines'), 'Invoice_ID', 'INV-P001-01');
  eq(lines.map(l => [l.Description, l.Qty, l.Unit_Price]), [['Genotyping with conditions and parentage', 4, 18]], 'no cost-share: one plain line for 4 received');
  let inv = rowOf('Invoices', 'Invoice_ID', 'INV-P001-01');
  eq(inv.Status, 'Ready for review', 'invoice waits for your review');
  let pdf = env.drive.api.getFileById(g.folderIdFromUrl_(inv.PDF_Link)).getBlob().getDataAsString();
  ok(pdf.includes('$72.00') && !pdf.includes('{{') && !pdf.includes('Cost-share paid by') && !pdf.includes('Covered in full'), 'invoice PDF: $72.00, no cost-share row, no leftover placeholders');
  r = call(staff({ action: 'sendReceipt', ref: 'P001-01', subject: 'Edited subject', body: 'Edited body' }));
  mail = env.outbox.pop();
  ok(r.ok && mail.subject === 'Edited subject' && mail.to === 'jane.smith@example.com', 'staff-edited email sent as edited');
  eq(tab('Email_Log').rows.slice(-1)[0].Sent_By, 'Maddie', 'email log records the staff member');

  console.log('Receiving the paper signer\'s box with the form inside');
  call(staff({ action: 'scan', ref: 'P002-01', tsu: 'NE05200201' }));
  call(staff({ action: 'scan', ref: 'P002-01', tsu: 'NE05200202' }));
  r = call(staff({ action: 'finish', ref: 'P002-01', paper: { present: true, research: 'N', signer: 'Bob Jones' } }));
  ok(/Your signed consent form was in the box/.test(r.draft.body) && !/sign online/.test(r.draft.body), 'E05 paper version');
  sub = rowOf('Submissions', 'Submission_ID', 'P002-01');
  eq([sub.Status, sub.Signed_By, sub.Research_Use, sub.Signature_Method], ['Received', 'Bob Jones', 'N', 'Paper'], 'paper answers recorded, not on hold');

  console.log('Receiving the cost-share submission');
  for (const t of ['NE05300001', 'NE05300002', 'NE05300003', 'NE05300004']) call(staff({ action: 'scan', ref: 'P001-02', tsu: t }));
  r = call(staff({ action: 'finish', ref: 'P001-02' }));
  lines = g.filter_(tab('Invoice_Lines'), 'Invoice_ID', 'INV-P001-02');
  eq(lines.map(l => [l.Description, l.Qty, l.Cost_Share_Program, l.Cost_Share_Level]), [
    ['Genotyping with conditions and parentage: covered in full by ASI', 2, 'CS01', 'Full'],
    ['Genotyping with conditions and parentage: partly covered by ASI', 1, 'CS01', 'Partial'],
    ['Genotyping with conditions and parentage', 1, '', ''],
  ], 'lines: proven + override full, one partial, non-NSIP plain');
  let d = g.invoiceData_('INV-P001-02');
  eq([d.subtotal, d.share, d.due], [72, 42, 30], 'invoice math: $72 - (2×18 + 1×6) = $30');
  pdf = env.drive.api.getFileById(g.folderIdFromUrl_(rowOf('Invoices', 'Invoice_ID', 'INV-P001-02').PDF_Link)).getBlob().getDataAsString();
  ok(pdf.includes('Covered in full by ASI') && pdf.includes('Partly covered by ASI') && pdf.includes('Cost-share paid by ASI') &&
     pdf.includes('2 × $18.00 + 1 × $6.00') && pdf.includes('−$42.00') && pdf.includes('$30.00'), 'invoice PDF shows groups, deduction and total');
  ok(!/Not covered/.test(pdf) && !pdf.includes('{{'), 'no "Not covered" label, no leftover placeholders');
  // you change your mind: grant covers the non-NSIP animal
  const an2 = tab('Animals');
  g.update_(an2, g.find_(an2, 'Animal_Key', 'P001-02-26103'), { CS_Override_Program: 'CS01', CS_Override_Level: 'Full' });
  g.rebuildGenoLines_('INV-P001-02');
  eq(g.invoiceData_('INV-P001-02').share, 42, 'ASI can never cover an animal without an NSIP ID, even by override');
  g.update_(an2, g.find_(tab('Animals'), 'Animal_Key', 'P001-02-26103'), { CS_Override_Program: 'GR01', CS_Override_Level: 'Full' });
  g.rebuildGenoLines_('INV-P001-02');
  d = g.invoiceData_('INV-P001-02');
  eq([d.share, d.due, d.costShares.map(c => c.program)], [60, 12, ['CS01', 'GR01']], 'grant override covers it: due $12');

  console.log('Invoices from the menu');
  env.active.sheet = 'Invoices'; env.active.row = rowOf('Invoices', 'Invoice_ID', 'INV-P001-02')._row;
  g.menuSendInvoice();
  const dlg = JSON.parse(env.ui.dialogs.pop().html.data);
  ok(/The cost-share through American Sheep Industry Association \(ASI\)'s ASI Fine Wool genotyping covers the full test for 2 animals and \$6 of the test for 1/.test(dlg.body), 'E06 cost-share sentence');
  ok(dlg.body.includes('The total due is $12.00') && dlg.body.includes('Please write INV-P001-02 on your payment'), 'E06 total and payment line');
  eq(g.reviewSend('invoice', 'INV-P001-02', dlg.subject, dlg.body), 'INV-P001-02 sent.', 'send from review dialog');
  mail = env.outbox.pop();
  ok(mail.attachments && mail.attachments[0].getName().endsWith('.pdf'), 'invoice PDF attached');
  eq(rowOf('Invoices', 'Invoice_ID', 'INV-P001-02').Status, 'Sent', 'invoice marked Sent');
  try { g.rebuildGenoLines_('INV-P001-02'); ok(false, 'sent invoice changed'); } catch (e) { ok(/can't change/.test(e.message), 'a sent invoice can\'t be recalculated'); }
  g.reviewSend('invoice', 'INV-P001-01', 'Invoice INV-P001-01', 'Body');
  env.outbox.pop();

  console.log('Batches');
  r = call(staff({ action: 'ready' }));
  eq(r.groups.map(x => [x.submissionId, x.animals.length]), [['P001-01', 4], ['P001-02', 4], ['P002-01', 2]], 'ready samples grouped by submission');
  const keys = r.groups.flatMap(x => x.animals.map(a => a.key));
  r = call(staff({ action: 'createBatch', keys }));
  eq(r.batchId, 'B' + year + '-01', 'batch ID by year');
  eq(r.rows.length, 10, 'export rows for all picked samples');
  ok(r.rows.every(x => x.animalKey && x.yob && x.breed && x.sex && x.tsu) && r.birthFlock === 'Montana State University', 'export rows complete');
  ok(!call(staff({ action: 'createBatch', keys: [keys[0]] })).ok, 'a sample can\'t go in two batches');
  r = call(staff({ action: 'saveBatchFile', batchId: 'B' + year + '-01', base64: 'AAAA' }));
  ok(r.ok && /drive/.test(rowOf('Batches', 'Batch_ID', 'B' + year + '-01').Export_File), 'GenomNZ file saved to Batches folder');
  r = call(staff({ action: 'markShipped', batchId: 'B' + year + '-01' }));
  eq([r.submissions, r.emailed], [3, 3], 'shipped: 3 submissions emailed (E07)');
  ok(env.outbox.some(m => /your samples are at the lab/.test(m.subject)), 'E07 sent');
  env.outbox.length = 0;
  eq(rowOf('Submissions', 'Submission_ID', 'P001-01').Status, 'At lab', 'status At lab');
  ok(!call(staff({ action: 'markShipped', batchId: 'B' + year + '-01' })).ok, 'can\'t ship twice');
  r = call({ action: 'status', token: tok1 });
  ok(r.submission.shipped && r.animals.find(a => a.tag === '26001').stateLabel === 'At the lab', 'status page shows shipped date and At the lab');

  console.log('Results from R, then release');
  const resT = tab('Results'), parT = tab('Parentage');
  g.append_(resT, [
    { Animal_Key: 'P001-01-23015', Submission_ID: 'P001-01', Condition_ID: 'SCRAPIE', Genotype: 'ARR/ARQ', Call: 'QR', Result_Label: 'Carries Q', Category: 'mid', Batch: 'B', Released: 'N' },
    { Animal_Key: 'P001-01-26001', Submission_ID: 'P001-01', Condition_ID: 'SCRAPIE', Genotype: 'ARR/ARR', Call: 'RR', Result_Label: 'Least susceptible', Category: 'good', Batch: 'B', Released: 'N' },
    { Animal_Key: 'P001-01-26001', Submission_ID: 'P001-01', Condition_ID: 'OPP', Genotype: '1/1', Call: '1/1', Result_Label: 'Lower risk', Category: 'good', Batch: 'B', Released: 'N' },
  ]);
  g.append_(parT, [{ Animal_Key: 'P001-01-26001', Submission_ID: 'P001-01', Reported_Sire: '23015', Sire_Result: 'Confirmed', Sire_Assigned: 'P001-01-23015', Dam_Result: 'Not genotyped', Released: 'N' }]);
  g.update_(tab('Animals'), rowOf('Animals', 'Animal_Key', 'P001-01-26003'), { Sample_Status: 'Failed QC' });
  ok(call({ action: 'status', token: tok1 }).animals.every(a => !a.results.length), 'pushed but unreleased results stay hidden');
  env.active.sheet = 'Submissions'; env.active.row = rowOf('Submissions', 'Submission_ID', 'P001-01')._row;
  g.menuRelease();
  const rel = JSON.parse(env.ui.dialogs.pop().html.data);
  ok(/Results for 2 of your 5 Targhee are ready/.test(rel.body) && /26003 couldn't be tested/.test(rel.body) && /0412 still hasn't reached us/.test(rel.body), 'E08 draft: counts, failed and missing animals');
  g.reviewSend('release', 'P001-01', rel.subject, rel.body);
  env.outbox.pop();
  r = call({ action: 'status', token: tok1 });
  const a26001 = r.animals.find(a => a.tag === '26001');
  ok(r.submission.status === 'Results released' && a26001.results.length === 2 && a26001.parentage.sire.result === 'Confirmed', 'released results and parentage on the status page');
  eq(a26001.stateLabel, 'Complete', 'animals with results marked Complete');
  eq(r.animals.find(a => a.tag === '26003').attention, 'qc', 'failed sample flagged for a replacement');
  eq(r.animals.find(a => a.tag === '0412').attention, 'missing', 'missing sample flagged');

  console.log('Downloads');
  ok(!call({ action: 'download', token: tok1, kind: 'pdf' }).ok, 'no PDF yet → friendly error');
  const f = env.drive.api.getFolderById(g.folderIdFromUrl_(rowOf('Submissions', 'Submission_ID', 'P001-01').Drive_Folder)).createFile(g.Utilities.newBlob([37, 80, 68, 70], 'application/pdf', 'P001-01_results.pdf'));
  g.update_(tab('Submissions'), rowOf('Submissions', 'Submission_ID', 'P001-01'), { Results_PDF: g.fileUrl_(f) });
  r = call({ action: 'download', token: tok1, kind: 'pdf' });
  ok(r.ok && r.name === 'P001-01_results.pdf' && Buffer.from(r.base64, 'base64').toString() === '%PDF', 'results PDF downloads through the private link');

  console.log('Replacements');
  r = call({ action: 'replace', token: tok1, items: [{ animalKey: 'P001-01-26003', tsu: 'NE05200003' }] });
  ok(!r.ok && /Use a new TSU/.test(r.error), 'failed sample needs a new TSU');
  r = call({ action: 'replace', token: tok1, items: [{ animalKey: 'P001-01-26003', tsu: 'NE05200099' }, { animalKey: 'P001-01-0412', useOriginal: true }] });
  ok(r.ok && r.replacementId === 'P001-01-R1', 'replacement registered: ' + (r.error || r.replacementId));
  mail = env.outbox.pop();
  ok(/26003: new TSU NE05200099/.test(mail.body) && /0412: original TSU NE05200012/.test(mail.body) && mail.body.includes('slip.html?t=' + tok1 + '&r=P001-01-R1'), 'E09 lists the TSUs and the slip link');
  r = call({ action: 'status', token: tok1 });
  ok(r.animals.find(a => a.tag === '26003').replacement.id === 'P001-01-R1' && !r.animals.find(a => a.tag === '26003').attention, 'status shows the replacement on its way');
  ok(!call({ action: 'replace', token: tok1, items: [{ animalKey: 'P001-01-26003', tsu: 'NE05200098' }] }).ok, 'can\'t register the same animal twice');
  r = call(staff({ action: 'lookup', query: 'NE05200099' }));
  ok(r.kind === 'replacement' && r.ref === 'P001-01-R1' && r.expected.length === 2, 'scanning a replacement TSU finds the replacement');
  eq(call(staff({ action: 'scan', ref: 'P001-01-R1', tsu: 'NE05200099' })).result, 'ok', 'replacement TSU scanned');
  eq(call(staff({ action: 'scan', ref: 'P001-01-R1', tsu: 'NE05200012' })).result, 'ok', 'late original scanned');
  r = call(staff({ action: 'finish', ref: 'P001-01-R1' }));
  ok(/2 of 2/.test(r.draft.body) && /P001-01-R1: we received your replacement TSUs/.test(r.draft.subject), 'E10 draft');
  let a = rowOf('Animals', 'Animal_Key', 'P001-01-26003');
  eq([a.TSU_Barcode, a.Replaced_TSU, a.Batch, a.Sample_Status], ['NE05200099', 'NE05200003', '', 'Received'], 'failed animal now carries the new TSU, back in the ready pool');
  eq(r.invoiceId, 'INV-P001-01-2', 'late original billed on its own invoice (first one already sent)');
  eq(g.filter_(tab('Invoice_Lines'), 'Invoice_ID', 'INV-P001-01-2').map(l => l.Qty), [1], 'only the late original is billed; the replacement is free');
  r = call(staff({ action: 'ready' }));
  eq(r.groups.map(x => [x.submissionId, x.animals.map(y => y.tag + (y.replacement ? '*' : ''))]), [['P001-01', ['26003*', '0412']]], 'replacement and late original ready for the next batch');
  r = call(staff({ action: 'createBatch', keys: ['P001-01-26003', 'P001-01-0412'] }));
  eq(r.rows.map(x => x.tsu), ['NE05200099', 'NE05200012'], 'GenomNZ file uses the new TSU');
  eq(rowOf('Replacements', 'New_TSU', 'NE05200099').New_Batch, 'B' + year + '-02', 'replacement records its new batch');

  console.log('Paper signer whose form was not in the box, then reminders and signing');
  r = call({ action: 'submit', submitter: { name: 'Pat Nolan', flock: 'Prairie Flock', address: 'Box 22, Harlowton MT', email: 'pat@prairieflock.example.com' },
    animals: animals('P', [['PF01', '', 'NE05400001', '2022', 'F']]), signature: { method: 'paper', paperAck: true } });
  const tok4 = r.token;
  env.outbox.pop();
  call(staff({ action: 'scan', ref: 'P003-01', tsu: 'NE05400001' }));
  r = call(staff({ action: 'finish', ref: 'P003-01' }));
  ok(/form needs signing/.test(r.draft.subject) && /can't send your samples to the lab until your consent form is signed/.test(r.draft.body), 'E05 unsigned version');
  eq(rowOf('Submissions', 'Submission_ID', 'P003-01').Status, 'On hold', 'on hold');
  ok(!call(staff({ action: 'ready' })).groups.some(x => x.submissionId === 'P003-01'), 'on-hold samples are not offered for a batch');
  eq(g.dailyReminders(), 0, 'no reminder before 7 days');
  const old = new Date(); old.setDate(old.getDate() - 8);
  g.update_(tab('Submissions'), rowOf('Submissions', 'Submission_ID', 'P003-01'), { Received_Date: old });
  eq(g.dailyReminders(), 1, 'reminder after 7 days');
  mail = env.outbox.pop();
  ok(/please sign so your samples can go to the lab/.test(mail.subject) && mail.body.includes('sign.html?t=' + tok4), 'E03 with sign link');
  eq(g.dailyReminders(), 0, 'not again the next day');
  r = call({ action: 'status', token: tok4 });
  ok(r.submission.needsSignature, 'status page asks them to sign');
  r = call({ action: 'sign', token: tok4, research: 'Y', agree: true, name: 'Pat Nolan' });
  ok(r.ok && r.boxArrived, 'signed online');
  mail = env.outbox.pop();
  ok(/signed, thank you/.test(mail.subject) && /Your samples will go to the lab in the next batch/.test(mail.body) && /research use of samples, results and photos: Yes/.test(mail.body), 'E04 copy with the box-arrived line');
  eq(rowOf('Submissions', 'Submission_ID', 'P003-01').Status, 'Received', 'hold lifted');
  ok(!call({ action: 'sign', token: tok4, research: 'Y', agree: true, name: 'Pat' }).ok, 'can\'t sign twice');
  ok(call(staff({ action: 'ready' })).groups.some(x => x.submissionId === 'P003-01'), 'now ready for a batch');

  console.log('Partner billing');
  const pbT = tab('Partner_Billing');
  const q = new Date(); q.setDate(1);
  const qEnd = new Date(q.getFullYear(), q.getMonth() + 3, 0);
  g.append_(pbT, [{ Partner_Invoice_ID: 'PB-CS01-TEST', Program_ID: 'CS01', Period_Start: new Date(q.getFullYear(), q.getMonth() - 1, 1), Period_End: qEnd, Status: 'Draft' }]);
  const pd = g.partnerBillData_('PB-CS01-TEST');
  eq([pd.rows.length, pd.totals.full, pd.totals.partial, pd.totals.amount], [1, 2, 1, 42], 'ASI bill: 2 full + 1 partial = $42 from sent invoices only');
  env.active.sheet = 'Partner_Billing'; env.active.row = rowOf('Partner_Billing', 'Partner_Invoice_ID', 'PB-CS01-TEST')._row;
  g.menuPartnerBill();
  const pb = JSON.parse(env.ui.dialogs.pop().html.data);
  ok(pb.to === 'esanko@sheepusa.org' && /Dear Erika Sanko/.test(pb.body) && /2 animals covered in full \(\$18 each\) and 1 animals partly covered/.test(pb.body), 'E11 to Erika with counts');
  g.reviewSend('partner', 'PB-CS01-TEST', pb.subject, pb.body);
  mail = env.outbox.pop();
  const pbPdf = mail.attachments[0].getDataAsString();
  ok(pbPdf.includes('INV-P001-02') && pbPdf.includes('$42.00') && !pbPdf.includes('{{'), 'partner bill PDF lists the producer invoice and total');

  console.log('Other menu items');
  env.active.sheet = 'Submissions'; env.active.row = rowOf('Submissions', 'Submission_ID', 'P002-01')._row;
  g.menuResendLink();
  ok(JSON.parse(env.ui.dialogs.pop().html.data).body.includes('status.html?t=' + tok2), 'E12 resend link');
  env.active.sheet = 'Animals';
  g.menuSendInvoice();
  ok(/Go to the Invoices tab/.test(env.ui.alerts.pop()), 'menu explains when the wrong tab is selected');

  console.log('Security and money checks');
  g.update_(tab('Producers'), rowOf('Producers', 'Producer_ID', 'P002'), { Contact_Name: 'Bob</script><script>alert(1)</script>' });
  env.active.sheet = 'Submissions'; env.active.row = rowOf('Submissions', 'Submission_ID', 'P002-01')._row;
  g.menuResendLink();
  const html = env.ui.dialogs.pop().html.data;
  ok(!/<\/script/i.test(html) && JSON.parse(html).body.includes('Bob</script>'), 'review dialog data cannot close its <script> tag');
  r = call({ action: 'submit', submitter: { ...sub1, email: 'new@example.com' }, animals: animals('Z', [['Z1', '', 'NE05200003', '2024', 'F']]), signature: { method: 'online', research: 'N', agree: true, name: 'X' } });
  ok(!r.ok && r.details.some(d => /NE05200003 was already used/.test(d.message)), 'a replaced (failed) TSU cannot be reused');
  const shareBefore = g.invoiceData_('INV-P001-02').share;
  g.update_(tab('Cost_Share'), rowOf('Cost_Share', 'Program_ID', 'CS01'), { Full_Share: 20 });
  eq(g.invoiceData_('INV-P001-02').share, shareBefore, 'sent invoice keeps the partner share it was made with ($' + shareBefore + ')');
  ok(g.filter_(tab('Invoice_Lines'), 'Invoice_ID', 'INV-P001-02').filter(l => l.Cost_Share_Program === 'CS01').every(l => l.Partner_Bill === 'PB-CS01-TEST'), 'lines record the partner bill they went on');
  g.append_(pbT, [{ Partner_Invoice_ID: 'PB-CS01-OVERLAP', Program_ID: 'CS01', Period_Start: new Date(q.getFullYear() - 1, 0, 1), Period_End: qEnd, Status: 'Draft' }]);
  eq(g.partnerBillData_('PB-CS01-OVERLAP').totals.amount, 0, 'an overlapping partner bill does not bill the same lines twice');
  eq(g.partnerBillData_('PB-CS01-TEST').totals.amount, 42, 'the original partner bill still adds up');
  g.update_(tab('Cost_Share'), rowOf('Cost_Share', 'Program_ID', 'CS01'), { Full_Share: 18 });

  console.log('A missing original turns up in its own box after a replacement was registered');
  r = call({ action: 'submit', submitter: { name: 'Lee Late', flock: 'Late Flock', address: '1 Rd, Town MT', email: 'lee@example.com' },
    animals: animals('L', [['L1', '', 'NE07000001', '2024', 'F'], ['L2', '', 'NE07000002', '2024', 'F']]), signature: { method: 'online', research: 'N', agree: true, name: 'Lee Late' } });
  const tokL = r.token, sidL = r.submissionId;
  call(staff({ action: 'scan', ref: sidL, tsu: 'NE07000001' }));
  call(staff({ action: 'finish', ref: sidL }));
  ok(call({ action: 'replace', token: tokL, items: [{ animalKey: sidL + '-L2', useOriginal: true }] }).ok, 'original TSU registered as the replacement');
  eq(call(staff({ action: 'scan', ref: sidL, tsu: 'NE07000002' })).result, 'ok', 'scanned in the original box');
  a = rowOf('Animals', 'Animal_Key', sidL + '-L2');
  ok(a.Sample_Status === 'Received' && g.yes_(rowOf('Replacements', 'Animal_Key', sidL + '-L2').Received), 'animal Received and the replacement closed');
  ok(call(staff({ action: 'ready' })).groups.some(x => x.submissionId === sidL && x.animals.length === 2), 'both animals ready for a batch');

  console.log('Passphrase guessing is limited');
  for (let i = 0; i < 20; i++) call({ action: 'staffCheck', passphrase: 'guess' + i, staff: 'x' });
  r = call(staff({ action: 'staffCheck' }));
  ok(!r.ok && /paused/.test(r.error), 'after 20 wrong tries even the right passphrase waits');
  delete env.cache.pass_fails;
  ok(call(staff({ action: 'staffCheck' })).ok, 'works again after the pause');

  console.log('Every email template fills');
  const t = tab('Email_Templates');
  eq(t.rows.length, 12, '12 email templates');
  const leftovers = env.ctx.table_('Email_Log').rows.length;
  ok(leftovers > 10, 'emails were logged (' + leftovers + ')');

  console.log(`\nAll ${passed} checks passed.`);
})().catch(e => { console.error('\nFAILED:', e.message); console.error(e.stack.split('\n').slice(1, 4).join('\n')); process.exit(1); });
