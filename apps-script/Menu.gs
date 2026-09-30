/**
 * The Genotyping menu in the tracker: things only you do. Each "send" step opens a preview where you
 * can edit the subject and message before it goes.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Genotyping')
    .addItem('Send selected invoice…', 'menuSendInvoice')
    .addItem('Recalculate selected invoice', 'menuRecalcInvoice')
    .addSeparator()
    .addItem('Release results for selected submission…', 'menuRelease')
    .addItem('Resend private link for selected submission…', 'menuResendLink')
    .addSeparator()
    .addItem('Send selected partner bill…', 'menuPartnerBill')
    .addSeparator()
    .addItem('Send signature reminders now', 'dailyReminders')
    .addItem('Set up (folders, templates, reminders)', 'menuSetup')
    .addItem('Check tracker columns', 'menuCheckColumns')
    .addToUi();
}

function ui_() { return SpreadsheetApp.getUi(); }

function selected_(tab, idHeader) {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== tab) throw httpError_('Go to the ' + tab + ' tab and click a row first.');
  var r = SpreadsheetApp.getActiveRange().getRow();
  var t = table_(tab);
  var row = t.rows.filter(function (x) { return x._row === r; })[0];
  if (!row || !clean_(row[idHeader])) throw httpError_('Click a row with a ' + idHeader + ' on the ' + tab + ' tab first.');
  return { t: t, row: row };
}

function menuWrap_(fn) {
  try { withLock_(fn); } catch (e) { ui_().alert(e.userMessage || e.message); }
}

function openReview_(kind, id, title, to, draft, note, attachments) {
  var tpl = HtmlService.createTemplateFromFile('Review');
  // Escape < so text a producer typed (it ends up in the email body) can't close the <script> in Review.html
  tpl.data = JSON.stringify({ kind: kind, id: id, to: to, subject: draft.subject, body: draft.body, note: note || '',
    attachments: attachments || [] }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  ui_().showModalDialog(tpl.evaluate().setWidth(720).setHeight(620), title);
}

// ------------------------------------------------------------------ invoices

function invoiceEmail_(invId) {
  var d = invoiceData_(invId);
  var s = settings_();
  var c = d.costShares[0];
  var vars = Object.assign(producerVars_(d.ctx, s), {
    'Invoice ID': invId, 'Animals billed': d.animalsBilled, 'Producer due': money_(d.due), 'Subtotal': money_(d.subtotal),
    'Partner organization': c ? c.partner : '', 'Program name': c ? c.name : '', 'Full count': c ? c.full : 0,
    'Partial count': c ? c.partial : 0, 'Partner share': c ? money_(c.amount) : ''
  });
  return { d: d, draft: draftEmail_('E06', vars, { cost_share: !!c }) };
}

function menuSendInvoice() {
  menuWrap_(function () {
    var sel = selected_('Invoices', 'Invoice_ID');
    var id = sel.row.Invoice_ID;
    if (OPEN_INVOICE.indexOf(clean_(sel.row.Status)) < 0) throw httpError_(id + ' is already ' + clean_(sel.row.Status) + '.');
    var e = invoiceEmail_(id);
    var note = e.d.due <= 0 ? 'The total due is ' + money_(e.d.due) + '. You can still send it as a record.' : '';
    openReview_('invoice', id, 'Send ' + id, clean_(e.d.ctx.producer.Email), e.draft, note, [id + '.pdf (made fresh when you send)']);
  });
}

function menuRecalcInvoice() {
  menuWrap_(function () {
    var sel = selected_('Invoices', 'Invoice_ID');
    rebuildGenoLines_(sel.row.Invoice_ID);
    makeInvoicePdf_(sel.row.Invoice_ID);
    var d = invoiceData_(sel.row.Invoice_ID);
    ui_().alert(sel.row.Invoice_ID + ' recalculated: subtotal ' + money_(d.subtotal) + ', cost-share ' + money_(d.share) +
      ', due ' + money_(d.due) + '. The PDF was updated.');
  });
}

// ------------------------------------------------------------------ results

function releaseEmail_(sid) {
  var ctx = loadSubmission_(sid);
  var withResults = {};
  filter_(table_('Results'), 'Submission_ID', sid).forEach(function (r) { withResults[r.Animal_Key] = 1; });
  var tag = function (a) { return clean_(a.Flock_Tag) || clean_(a.EID); };
  var failed = ctx.animals.filter(function (a) { return a.Sample_Status === 'Failed QC'; }).map(tag);
  var missing = ctx.animals.filter(function (a) { return a.Sample_Status === 'Not received'; }).map(tag);
  var vars = Object.assign(producerVars_(ctx, settings_()), { 'Results complete': Object.keys(withResults).length,
    'Failed list': joinList_(failed), 'Not received list': joinList_(missing) });
  return { ctx: ctx, count: Object.keys(withResults).length, draft: draftEmail_('E08', vars, { failed: failed.length > 0, not_received: missing.length > 0 }) };
}

function menuRelease() {
  menuWrap_(function () {
    var sel = selected_('Submissions', 'Submission_ID');
    var sid = sel.row.Submission_ID;
    var e = releaseEmail_(sid);
    if (!e.count) throw httpError_(sid + ' has no results yet. Push them from R first.');
    var notes = [];
    if (!clean_(sel.row.Results_PDF)) notes.push('No results PDF yet (Results_PDF is empty).');
    if (!clean_(sel.row.Results_Excel)) notes.push('No Excel file yet (Results_Excel is empty).');
    openReview_('release', sid, 'Release results for ' + sid, clean_(e.ctx.producer.Email), e.draft,
      'Sending releases the results: they appear on the producer\'s page. ' + notes.join(' '));
  });
}

function releaseSubmission_(sid) {
  var resT = table_('Results'), parT = table_('Parentage');
  var keys = {};
  filter_(resT, 'Submission_ID', sid).forEach(function (r) { keys[r.Animal_Key] = 1; if (!yes_(r.Released)) update_(resT, r, { Released: 'Y' }); });
  filter_(parT, 'Submission_ID', sid).forEach(function (r) { if (!yes_(r.Released) && r.Sire_Result !== 'Pending') update_(parT, r, { Released: 'Y' }); });
  var ctx = loadSubmission_(sid);
  ctx.animals.forEach(function (a) {
    if (keys[a.Animal_Key] && ['Received', 'At lab'].indexOf(a.Sample_Status) >= 0) update_(ctx.animalsT, a, { Sample_Status: 'Complete' });
  });
  update_(ctx.subs, ctx.sub, { Results_Released_Date: today_(), Status: 'Results released' });
}

// ------------------------------------------------------------------ partner bills and links

function menuPartnerBill() {
  menuWrap_(function () {
    var sel = selected_('Partner_Billing', 'Partner_Invoice_ID');
    var id = sel.row.Partner_Invoice_ID;
    var d = partnerBillData_(id);
    if (!d.rows.length) throw httpError_('No sent or paid producer invoices use ' + d.prog.Program_ID + ' in this period.');
    if (!clean_(d.prog.Partner_Email)) throw httpError_('Add a Partner_Email for ' + d.prog.Program_ID + ' on the Cost_Share tab first.');
    var draft = draftEmail_('E11', { 'Partner contact': clean_(d.prog.Partner_Contact) || 'colleague', 'Partner invoice ID': id,
      'Program name': clean_(d.prog.Program_Name), 'Period start': fmtDate_(d.bill.Period_Start), 'Period end': fmtDate_(d.bill.Period_End),
      'Producer invoices': d.rows.length, 'Full animals': d.totals.full, 'Partial animals': d.totals.partial, 'Amount due': money_(d.totals.amount) });
    openReview_('partner', id, 'Send ' + id, clean_(d.prog.Partner_Email), draft, '', [id + '.pdf (made fresh when you send)']);
  });
}

function menuResendLink() {
  menuWrap_(function () {
    var sel = selected_('Submissions', 'Submission_ID');
    var ctx = loadSubmission_(sel.row.Submission_ID);
    openReview_('link', ctx.sub.Submission_ID, 'Resend link for ' + ctx.sub.Submission_ID, clean_(ctx.producer.Email),
      draftEmail_('E12', producerVars_(ctx, settings_())));
  });
}

/** Called from the Review dialog. Not private (no underscore) so the dialog can call it. */
function reviewSend(kind, id, subject, body) {
  return withLock_(function () { return reviewSend_(kind, id, subject, body); });
}

function reviewSend_(kind, id, subject, body) {
  subject = clean_(subject); body = String(body || '').trim();
  if (!subject || !body) throw new Error('The email needs a subject and a message.');
  if (kind === 'invoice') {
    var invT = table_('Invoices');
    var inv = find_(invT, 'Invoice_ID', id);
    if (OPEN_INVOICE.indexOf(clean_(inv.Status)) < 0) throw new Error(id + ' was already sent.');
    var pdf = makeInvoicePdf_(id);
    var ctx = loadSubmission_(inv.Submission_ID);
    sendEmail_(clean_(ctx.producer.Email), subject, body, { attachments: [pdf.getBlob()], submissionId: inv.Submission_ID, sentBy: 'You', emailId: 'E06' });
    update_(table_('Invoices'), find_(table_('Invoices'), 'Invoice_ID', id), { Status: 'Sent', Sent_Date: today_() });
    freezeShares_(id);
    return id + ' sent.';
  }
  if (kind === 'release') {
    releaseSubmission_(id);
    var c2 = loadSubmission_(id);
    sendEmail_(clean_(c2.producer.Email), subject, body, { submissionId: id, sentBy: 'You', emailId: 'E08' });
    return 'Results for ' + id + ' released and emailed.';
  }
  if (kind === 'partner') {
    var made = makePartnerBillPdf_(id);
    sendEmail_(clean_(made.data.prog.Partner_Email), subject, body, { attachments: [made.file.getBlob()], sentBy: 'You', emailId: 'E11' });
    update_(made.data.pbT, find_(table_('Partner_Billing'), 'Partner_Invoice_ID', id), { Status: 'Sent', Sent_Date: today_() });
    made.data.lineRows.forEach(function (l) { if (clean_(l.Partner_Bill) !== id) update_(made.data.linesT, l, { Partner_Bill: id }); });
    return id + ' sent to ' + clean_(made.data.prog.Partner_Email) + '.';
  }
  if (kind === 'link') {
    var c3 = loadSubmission_(id);
    sendEmail_(clean_(c3.producer.Email), subject, body, { submissionId: id, sentBy: 'You', emailId: 'E12' });
    return 'Link sent.';
  }
  throw new Error('Unknown action.');
}

/** Release without emailing (from the Review dialog). */
function reviewReleaseOnly(sid) {
  withLock_(function () { releaseSubmission_(sid); });
  return 'Results for ' + sid + ' released. No email was sent.';
}

// ------------------------------------------------------------------ reminders (daily trigger)

function dailyReminders() {
  return withLock_(dailyReminders_);
}

function dailyReminders_() {
  var s = settings_();
  var first = Number(s.Reminder_First_Days) || 7, every = Number(s.Reminder_Every_Days) || 7, max = Number(s.Reminder_Max) || 3;
  var now = today_(), sent = 0;
  var subs = table_('Submissions');
  subs.rows.forEach(function (sub) {
    if (sub.Status !== 'On hold' || isSigned_(sub) || !sub.Received_Date) return;
    var count = Number(sub.Reminders_Sent) || 0;
    if (count >= max) return;
    var days = function (d) { return Math.floor((now - new Date(d)) / 86400000); };
    if (days(sub.Received_Date) < first) return;
    if (sub.Last_Reminder_Date && days(sub.Last_Reminder_Date) < every) return;
    var ctx = loadSubmission_(sub.Submission_ID);
    try {
      sendTemplate_('E03', ctx.producer.Email, Object.assign(producerVars_(ctx, s), {
        'TSUs received': ctx.animals.filter(function (a) { return yes_(a.Received); }).length, 'Received date': fmtDate_(sub.Received_Date)
      }), {}, { submissionId: sub.Submission_ID });
      update_(subs, sub, { Reminders_Sent: count + 1, Last_Reminder_Date: now });
      sent++;
    } catch (e) { console.error('Reminder for ' + sub.Submission_ID + ': ' + e.message); }
  });
  return sent;
}

// ------------------------------------------------------------------ set up

function menuSetup() {
  menuWrap_(function () {
    var msg = setupAll_();
    ui_().alert('Set up finished', msg, ui_().ButtonSet.OK);
  });
}

function setupAll_() {
  var ss = ss_();
  PropertiesService.getScriptProperties().setProperty('TRACKER_ID', ss.getId());
  var s = settings_();
  var done = [];
  var root;
  try { root = s.Root_Folder_ID ? DriveApp.getFolderById(String(s.Root_Folder_ID)) : null; } catch (e) { root = null; }
  if (!root) {
    var it = DriveApp.getFoldersByName('MSU Sheep Genotyping');
    root = it.hasNext() ? it.next() : DriveApp.createFolder('MSU Sheep Genotyping');
    setSetting_('Root_Folder_ID', root.getId());
  }
  var folders = { Submissions_Folder_ID: 'Submissions', Batches_Folder_ID: 'Batches', Partner_Bills_Folder_ID: 'Partner bills', Templates_Folder_ID: 'Templates' };
  Object.keys(folders).forEach(function (k) { setSetting_(k, childFolder_(root, folders[k]).getId()); });
  childFolder_(root, 'Forms');
  try { DriveApp.getFileById(ss.getId()).moveTo(root); } catch (e) { /* leave the tracker where it is */ }
  done.push('Drive folders are in "MSU Sheep Genotyping".');

  s = settings_();
  var tplFolder = DriveApp.getFolderById(String(s.Templates_Folder_ID));
  var have = function (k) { try { return s[k] && DriveApp.getFileById(String(s[k])); } catch (e) { return null; } };
  if (!have('Invoice_Template_ID')) { setSetting_('Invoice_Template_ID', createInvoiceTemplate_(tplFolder).getId()); done.push('Created the invoice template (Templates folder).'); }
  if (!have('Partner_Bill_Template_ID')) { setSetting_('Partner_Bill_Template_ID', createPartnerBillTemplate_(tplFolder).getId()); done.push('Created the partner bill template.'); }

  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyReminders'; });
  if (!hasTrigger) { ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(8).create(); done.push('Signature reminders will run every morning around 8.'); }

  var problems = checkColumns_();
  done.push(problems.length ? 'Column problems: ' + problems.join('; ') : 'All tabs and columns match what the code expects.');
  done.push('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone), then put the web app URL in the website\'s assets/js/config.js.');
  return done.join('\n\n');
}

function checkColumns_() {
  var problems = [];
  Object.keys(SCHEMA.columns).forEach(function (tab) {
    var sh = ss_().getSheetByName(tab);
    if (!sh) { problems.push('missing tab ' + tab); return; }
    var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    SCHEMA.columns[tab].forEach(function (h, i) {
      if (headers[i] !== h) problems.push(tab + ' column ' + (i + 1) + ' should be ' + h + ' (found "' + (headers[i] || '') + '")');
    });
  });
  return problems;
}

function menuCheckColumns() {
  menuWrap_(function () {
    var p = checkColumns_();
    ui_().alert(p.length ? 'Fix these (the formulas depend on column positions):\n\n' + p.join('\n') : 'All tabs and columns are where the code expects them.');
  });
}
