/**
 * Invoices and partner bills.
 *  - An invoice is drafted when a box is received: one GENO line per cost-share program and level.
 *  - Animals.Billed_On records which invoice billed each animal, so nobody is billed twice and late
 *    originals go on their own invoice once the first one has been sent.
 *  - PDFs come from Google Docs templates (Templates folder) that you can edit in Docs.
 */

var OPEN_INVOICE = ['Draft', 'Ready for review'];

function nextInvoiceId_(invT, sid) {
  var n = filter_(invT, 'Submission_ID', sid).length;
  return 'INV-' + sid + (n ? '-' + (n + 1) : '');
}

/** Bill every received, not-yet-billed animal. Returns { id } or null when there is nothing to bill. */
function ensureInvoice_(sid) {
  var ctx = loadSubmission_(sid);
  var unbilled = ctx.animals.filter(function (a) { return yes_(a.Received) && !clean_(a.Billed_On); });
  if (!unbilled.length) return null;
  var invT = table_('Invoices');
  var open = filter_(invT, 'Submission_ID', sid).filter(function (i) { return OPEN_INVOICE.indexOf(clean_(i.Status)) >= 0; })[0];
  var id = open ? open.Invoice_ID : nextInvoiceId_(invT, sid);
  if (!open) append_(invT, [{ Invoice_ID: id, Submission_ID: sid, Invoice_Date: today_(), Status: 'Ready for review' }]);
  unbilled.forEach(function (a) { update_(ctx.animalsT, a, { Billed_On: id }); });
  rebuildGenoLines_(id);
  try { makeInvoicePdf_(id); } catch (e) { console.error('Invoice PDF ' + id + ': ' + e.message); }
  return { id: id };
}

/** Replace an unsent invoice's GENO lines with fresh ones from its animals' current cost-share. */
function rebuildGenoLines_(invId) {
  var invT = table_('Invoices');
  var inv = find_(invT, 'Invoice_ID', invId);
  if (!inv) throw httpError_('No invoice ' + invId + '.', 'not_found');
  if (OPEN_INVOICE.indexOf(clean_(inv.Status)) < 0) throw httpError_(invId + ' has been ' + clean_(inv.Status).toLowerCase() + ', so it can\'t change.', 'locked');
  var ctx = loadSubmission_(inv.Submission_ID);
  var billed = ctx.animals.filter(function (a) { return clean_(a.Billed_On) === invId; });
  var programs = programs_(), minAge = settings_().Proven_Min_Age;
  var groups = {}, order = [];
  billed.forEach(function (a) {
    var cs = costShareFor_(a, ctx.sub, programs, minAge);
    var k = cs.program + '|' + cs.level;
    if (!groups[k]) { groups[k] = { program: cs.program, level: cs.level, qty: 0 }; order.push(k); }
    groups[k].qty++;
  });
  var rank = function (g) { return g.level === 'None' ? 9 : (g.level === 'Full' ? 0 : 1) + (g.program === 'CS01' ? 0 : 2); };
  order.sort(function (x, y) { return rank(groups[x]) - rank(groups[y]) || (x < y ? -1 : 1); });

  var linesT = table_('Invoice_Lines');
  deleteRows_(linesT, filter_(linesT, 'Invoice_ID', invId).filter(function (l) { return l.Service_ID === 'GENO'; }));
  linesT = table_('Invoice_Lines');
  var price = servicePrice_('GENO');
  var note = 'TSUs received ' + fmtDate_(ctx.sub.Received_Date || today_());
  append_(linesT, order.map(function (k, i) {
    var g = groups[k];
    var prog = programs[g.program];
    var per = g.level === 'None' || !prog ? '' : Number(g.level === 'Full' ? prog.Full_Share : prog.Partial_Share) || 0;
    return { Invoice_ID: invId, Line_No: i + 1, Service_ID: 'GENO', Description: genoDescription_(g.program, g.level, programs),
      Qty: g.qty, Unit_Price: price, Cost_Share_Program: g.level === 'None' ? '' : g.program,
      Cost_Share_Level: g.level === 'None' ? '' : g.level, Share_Per_Unit: per, Notes: note };
  }));
}

/** The partner's share per unit on a line: the value stored when the line was made, else the program's current one. */
function sharePerUnit_(line, prog) {
  var stored = line.Share_Per_Unit;
  if (stored !== '' && stored !== null && stored !== undefined && !isNaN(Number(stored))) return Number(stored);
  return Number(line.Cost_Share_Level === 'Full' ? prog.Full_Share : prog.Partial_Share) || 0;
}

/** When an invoice is sent, write the share onto any line that doesn't have one (lines added by hand), so it never changes. */
function freezeShares_(invId) {
  var linesT = table_('Invoice_Lines'), programs = programs_();
  filter_(linesT, 'Invoice_ID', invId).forEach(function (l) {
    var prog = programs[clean_(l.Cost_Share_Program)];
    if (!prog || (l.Cost_Share_Level !== 'Full' && l.Cost_Share_Level !== 'Partial')) return;
    if (l.Share_Per_Unit === '' || l.Share_Per_Unit === null || l.Share_Per_Unit === undefined) update_(linesT, l, { Share_Per_Unit: sharePerUnit_(l, prog) });
  });
}

/** All the numbers for one invoice, computed from inputs (not from the sheet's formulas). */
function invoiceData_(invId) {
  var inv = find_(table_('Invoices'), 'Invoice_ID', invId);
  if (!inv) throw httpError_('No invoice ' + invId + '.', 'not_found');
  var ctx = loadSubmission_(inv.Submission_ID);
  var services = {};
  table_('Services').rows.forEach(function (r) { services[r.Service_ID] = r; });
  var programs = programs_();
  var lines = filter_(table_('Invoice_Lines'), 'Invoice_ID', invId)
    .sort(function (a, b) { return (Number(a.Line_No) || 0) - (Number(b.Line_No) || 0); });
  var subtotal = 0, cs = {}, csOrder = [], animalsBilled = 0;
  var out = lines.map(function (l) {
    var qty = Number(l.Qty) || 0, price = Number(l.Unit_Price) || 0, amount = qty * price;
    subtotal += amount;
    if (l.Service_ID === 'GENO') animalsBilled += qty;
    var prog = programs[clean_(l.Cost_Share_Program)];
    var eligible = services[l.Service_ID] && yes_(services[l.Service_ID].Cost_Share_Eligible);
    if (prog && eligible && (l.Cost_Share_Level === 'Full' || l.Cost_Share_Level === 'Partial')) {
      var per = sharePerUnit_(l, prog);
      var share = Math.min(amount, qty * per);
      var c = cs[prog.Program_ID];
      if (!c) { c = cs[prog.Program_ID] = { program: prog.Program_ID, name: clean_(prog.Program_Name), partner: clean_(prog.Partner_Organization),
        short: shortPartner_(prog), parts: [], full: 0, partial: 0, amount: 0 }; csOrder.push(prog.Program_ID); }
      c.amount += share;
      if (l.Cost_Share_Level === 'Full') c.full += qty; else c.partial += qty;
      c.parts.push(qty + ' × ' + money_(per));
    }
    var desc = clean_(l.Description), title = desc, sub = '';
    var m = desc.match(/^(.*?):\s+(.+)$/);
    if (m && l.Service_ID === 'GENO') { title = m[1]; sub = m[2].charAt(0).toUpperCase() + m[2].slice(1); }
    return { title: title, sub: sub, qty: qty, price: price, amount: amount };
  });
  var csList = csOrder.map(function (k) { return cs[k]; });
  var share = csList.reduce(function (t, c) { return t + c.amount; }, 0);
  var received = ctx.animals.filter(function (a) { return clean_(a.Billed_On) === invId; });
  var notBilled = ctx.animals.filter(function (a) { return !yes_(a.Received); })
    .map(function (a) { return (clean_(a.Flock_Tag) || clean_(a.EID)) + ', sample not received'; });
  return { inv: inv, ctx: ctx, lines: out, subtotal: subtotal, costShares: csList, share: share, due: subtotal - share,
    animalsBilled: animalsBilled, receivedCount: received.length, notBilled: notBilled };
}

// ------------------------------------------------------------------ Docs templates

function escRepl_(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\$/g, '\\$'); }
function escFind_(k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function replaceAll_(el, vars) {
  Object.keys(vars).forEach(function (k) { el.replaceText(escFind_('{{' + k + '}}'), escRepl_(vars[k])); });
}

/** Find the table row holding a placeholder: { table, index, row } or null. */
function templateRow_(body, marker) {
  var tables = body.getTables();
  for (var t = 0; t < tables.length; t++) {
    for (var r = 0; r < tables[t].getNumRows(); r++) {
      var row = tables[t].getRow(r);
      if (row.getText().indexOf(marker) >= 0) return { table: tables[t], index: r, row: row };
    }
  }
  return null;
}

/** Copy a template row once per item, fill each copy, then remove the template row. */
function fillRows_(body, marker, items, varsFor, optional) {
  var tr = templateRow_(body, marker);
  if (!tr) return;
  items.forEach(function (it, i) {
    var row = tr.table.insertTableRow(tr.index + 1 + i, tr.row.copy());
    var v = varsFor(it);
    (optional || []).forEach(function (key) {           // drop an empty second line (e.g. a line with no subtitle)
      if (v[key]) return;
      for (var c = 0; c < row.getNumCells(); c++) {
        var cell = row.getCell(c);
        for (var p = cell.getNumChildren() - 1; p >= 0; p--) {
          var child = cell.getChild(p);
          if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
          var para = child.asParagraph();
          if (para.getText().indexOf('{{' + key + '}}') >= 0 && cell.getNumChildren() > 1) para.removeFromParent();
        }
      }
    });
    replaceAll_(row, v);
  });
  tr.table.removeRow(tr.index);
}

function makePdfFromTemplate_(templateKey, name, folder, vars, rowSets) {
  var tplId = settings_()[templateKey];
  if (!tplId) throw new Error('No ' + templateKey + ' yet. In the tracker, choose Genotyping > Set up.');
  var copy = DriveApp.getFileById(String(tplId)).makeCopy(name + ' (working copy)', folder);
  var doc = DocumentApp.openById(copy.getId());
  var body = doc.getBody();
  (rowSets || []).forEach(function (rs) { fillRows_(body, rs.marker, rs.items, rs.vars, rs.optional); });
  replaceAll_(body, vars);
  doc.saveAndClose();
  var pdf = copy.getAs('application/pdf').setName(name + '.pdf');
  var it = folder.getFilesByName(name + '.pdf');
  while (it.hasNext()) it.next().setTrashed(true);
  var file = folder.createFile(pdf);
  copy.setTrashed(true);
  return file;
}

function makeInvoicePdf_(invId) {
  var d = invoiceData_(invId);
  var s = settings_(), p = d.ctx.producer, sub = d.ctx.sub;
  var folder = submissionFolder_(d.ctx.subs, sub);
  var vars = {
    'Invoice ID': invId, 'Invoice date': fmtDate_(d.inv.Invoice_Date || today_()), 'Submission ID': sub.Submission_ID,
    'Contact name': clean_(p.Contact_Name), 'Flock name': clean_(p.Flock_Name), 'Address': clean_(p.Mailing_Address),
    'Email': clean_(p.Email), 'Phone': clean_(p.Phone), 'Animal count': d.ctx.animals.length, 'Breed': clean_(sub.Breed),
    'Submitted date': fmtDate_(sub.Submitted_Date), 'TSUs received': d.receivedCount, 'Received date': fmtDate_(sub.Received_Date),
    'Not billed': d.notBilled.length ? 'Not billed: ' + d.notBilled.join('; ') : '',
    'subtotal': money_(d.subtotal), 'total': money_(d.due),
    'Checks payable to': s.Checks_Payable_To, 'Mailing address': s.Mailing_Address, 'Contact email': s.Contact_Email,
    'Contact phone': s.Contact_Phone
  };
  var file = makePdfFromTemplate_('Invoice_Template_ID', invId + ' ' + clean_(p.Flock_Name), folder, vars, [
    { marker: '{{line_desc}}', items: d.lines, optional: ['line_sub'], vars: function (l) {
      return { line_desc: l.title, line_sub: l.sub, line_qty: l.qty, line_price: money_(l.price), line_amount: money_(l.amount) }; } },
    { marker: '{{cs_label}}', items: d.costShares, optional: ['cs_detail'], vars: function (c) {
      return { cs_label: 'Cost-share paid by ' + c.short, cs_detail: c.parts.join(' + '), cs_amount: '−' + money_(c.amount) }; } }
  ]);
  update_(table_('Invoices'), find_(table_('Invoices'), 'Invoice_ID', invId), { PDF_Link: fileUrl_(file) });
  return file;
}

// ------------------------------------------------------------------ partner bills

/** Sent/paid producer invoice lines for a program in a period, grouped by invoice. */
function partnerBillData_(billId) {
  var pbT = table_('Partner_Billing');
  var bill = find_(pbT, 'Partner_Invoice_ID', billId);
  if (!bill) throw httpError_('No partner bill ' + billId + '.', 'not_found');
  var prog = programs_()[clean_(bill.Program_ID)];
  if (!prog) throw httpError_('Partner bill ' + billId + ' has no valid Program_ID.', 'invalid');
  var start = new Date(bill.Period_Start), end = new Date(bill.Period_End);
  var invoices = {};
  table_('Invoices').rows.forEach(function (i) { invoices[i.Invoice_ID] = i; });
  var subs = {};
  table_('Submissions').rows.forEach(function (x) { subs[x.Submission_ID] = x; });
  var prod = {};
  table_('Producers').rows.forEach(function (x) { prod[x.Producer_ID] = x; });
  var rows = {}, order = [], lineRows = [];
  var linesT = table_('Invoice_Lines');
  linesT.rows.forEach(function (l) {
    if (clean_(l.Cost_Share_Program) !== prog.Program_ID) return;
    if (clean_(l.Partner_Bill) && clean_(l.Partner_Bill) !== billId) return;     // already on another partner bill
    var inv = invoices[l.Invoice_ID];
    if (!inv || ['Sent', 'Paid'].indexOf(clean_(inv.Status)) < 0) return;
    var d = new Date(inv.Invoice_Date);
    if (isNaN(d.getTime()) || d < start || d > end) return;
    var r = rows[l.Invoice_ID];
    if (!r) {
      var sub = subs[inv.Submission_ID] || {};
      r = rows[l.Invoice_ID] = { invoice: l.Invoice_ID, flock: clean_((prod[sub.Producer_ID] || {}).Flock_Name), date: fmtDate_(d), full: 0, partial: 0, amount: 0 };
      order.push(l.Invoice_ID);
    }
    var qty = Number(l.Qty) || 0, per = sharePerUnit_(l, prog);
    if (l.Cost_Share_Level === 'Full') r.full += qty; else if (l.Cost_Share_Level === 'Partial') r.partial += qty; else return;
    r.amount += Math.min(qty * (Number(l.Unit_Price) || 0), qty * per);
    lineRows.push(l);
  });
  var list = order.map(function (k) { return rows[k]; });
  var tot = list.reduce(function (t, r) { t.full += r.full; t.partial += r.partial; t.amount += r.amount; return t; }, { full: 0, partial: 0, amount: 0 });
  return { bill: bill, pbT: pbT, prog: prog, rows: list, totals: tot, linesT: linesT, lineRows: lineRows };
}

function makePartnerBillPdf_(billId) {
  var d = partnerBillData_(billId);
  var s = settings_();
  var vars = {
    'Bill ID': billId, 'Bill date': fmtDate_(today_()), 'Partner organization': clean_(d.prog.Partner_Organization),
    'Partner contact': clean_(d.prog.Partner_Contact), 'Partner email': clean_(d.prog.Partner_Email), 'Program name': clean_(d.prog.Program_Name),
    'Period start': fmtDate_(d.bill.Period_Start), 'Period end': fmtDate_(d.bill.Period_End),
    'Full animals': d.totals.full, 'Partial animals': d.totals.partial, 'Amount due': money_(d.totals.amount),
    'Checks payable to': s.Checks_Payable_To, 'Mailing address': s.Mailing_Address, 'Contact email': s.Contact_Email, 'Contact phone': s.Contact_Phone
  };
  var file = makePdfFromTemplate_('Partner_Bill_Template_ID', billId + ' ' + shortPartner_(d.prog), settingFolder_('Partner_Bills_Folder_ID'), vars, [
    { marker: '{{pb_invoice}}', items: d.rows, vars: function (r) {
      return { pb_invoice: r.invoice, pb_flock: r.flock, pb_date: r.date, pb_full: r.full, pb_partial: r.partial, pb_amount: money_(r.amount) }; } }
  ]);
  update_(d.pbT, d.bill, { PDF_Link: fileUrl_(file) });
  return { file: file, data: d };
}

// ------------------------------------------------------------------ template documents (made once by Set up)

function styleText_(el, size, bold, color) {
  var t = el.editAsText ? el.editAsText() : el;
  if (t.getText && !t.getText()) return el;         // nothing to style in an empty element
  t.setFontFamily('Arial'); t.setFontSize(size); t.setBold(!!bold); t.setForegroundColor(color || '#16233A');
  return el;
}

function headerBlock_(body, title) {
  body.clear();
  body.setMarginTop(40).setMarginBottom(40).setMarginLeft(50).setMarginRight(50);
  styleText_(body.appendParagraph('Sheep Genotyping Service'), 14, true);
  styleText_(body.appendParagraph('Montana State University · Sheep Program · {{Mailing address}}'), 9, false, '#5A6474');
  styleText_(body.appendParagraph(title), 26, true).setSpacingBefore(14);
}

function plainTable_(body, rows, widths) {
  var t = body.appendTable(rows);
  t.setBorderWidth(0);
  for (var r = 0; r < t.getNumRows(); r++)
    for (var c = 0; c < t.getRow(r).getNumCells(); c++) {
      var cell = t.getRow(r).getCell(c);
      styleText_(cell.editAsText(), 10, false);
      if (widths && widths[c]) cell.setWidth(widths[c]);
    }
  return t;
}

function createInvoiceTemplate_(folder) {
  var doc = DocumentApp.create('Invoice template');
  var body = doc.getBody();
  headerBlock_(body, 'Invoice');
  plainTable_(body, [['Invoice no.', '{{Invoice ID}}'], ['Invoice date', '{{Invoice date}}'], ['Submission', '{{Submission ID}}']], [110, 200]);
  styleText_(body.appendParagraph('Bill to'), 9, true, '#4A5566').setSpacingBefore(10);
  styleText_(body.appendParagraph('{{Contact name}}\n{{Flock name}}\n{{Address}}\n{{Email}} · {{Phone}}'), 10);
  styleText_(body.appendParagraph('Submission'), 9, true, '#4A5566').setSpacingBefore(8);
  styleText_(body.appendParagraph('{{Animal count}} {{Breed}} listed, submitted {{Submitted date}}\n{{TSUs received}} TSUs received {{Received date}}\n{{Not billed}}'), 10);
  var items = plainTable_(body, [['Description', 'Qty', 'Unit price', 'Amount'], ['{{line_desc}}', '{{line_qty}}', '{{line_price}}', '{{line_amount}}']], [290, 50, 80, 80]);
  items.setBorderWidth(1).setBorderColor('#E2DED3');
  styleText_(items.getRow(0).editAsText(), 9, true, '#4A5566');
  for (var c = 0; c < 4; c++) items.getRow(0).getCell(c).setBackgroundColor('#F1EEE6');
  styleText_(items.getRow(1).getCell(0).editAsText(), 10, true);
  styleText_(items.getRow(1).getCell(0).appendParagraph('{{line_sub}}'), 9, false, '#5A6474');
  var totals = plainTable_(body, [['Subtotal', '{{subtotal}}'], ['{{cs_label}}', '{{cs_amount}}'], ['Total due from you', '{{total}}']], [290, 210]);
  styleText_(totals.getRow(1).getCell(0).appendParagraph('{{cs_detail}}'), 9, false, '#5A6474');
  styleText_(totals.getRow(2).editAsText(), 12, true);
  styleText_(body.appendParagraph('How to pay'), 9, true, '#4A5566').setSpacingBefore(12);
  styleText_(body.appendParagraph('Please make checks payable to {{Checks payable to}} and mail to {{Mailing address}}. Please write {{Invoice ID}} on your payment.'), 10);
  styleText_(body.appendParagraph('Questions'), 9, true, '#4A5566').setSpacingBefore(8);
  styleText_(body.appendParagraph('MSU Sheep Program · {{Contact email}} · {{Contact phone}}'), 10);
  styleText_(body.appendParagraph('Thank you for using the MSU Sheep Genotyping Service. Results will be posted to your private results link when testing is complete.'), 9, false, '#5A6474').setSpacingBefore(12);
  doc.saveAndClose();
  var f = DriveApp.getFileById(doc.getId());
  f.moveTo(folder);
  return f;
}

function createPartnerBillTemplate_(folder) {
  var doc = DocumentApp.create('Partner bill template');
  var body = doc.getBody();
  headerBlock_(body, 'Cost-share bill');
  plainTable_(body, [['Bill no.', '{{Bill ID}}'], ['Date', '{{Bill date}}'], ['Program', '{{Program name}}'], ['Period', '{{Period start}} to {{Period end}}']], [110, 260]);
  styleText_(body.appendParagraph('Bill to'), 9, true, '#4A5566').setSpacingBefore(10);
  styleText_(body.appendParagraph('{{Partner organization}}\n{{Partner contact}} · {{Partner email}}'), 10);
  var t = plainTable_(body, [['Producer invoice', 'Flock', 'Invoice date', 'Full', 'Partial', 'Amount'],
    ['{{pb_invoice}}', '{{pb_flock}}', '{{pb_date}}', '{{pb_full}}', '{{pb_partial}}', '{{pb_amount}}']], [100, 130, 80, 45, 50, 75]);
  t.setBorderWidth(1).setBorderColor('#E2DED3');
  styleText_(t.getRow(0).editAsText(), 9, true, '#4A5566');
  plainTable_(body, [['Animals covered in full', '{{Full animals}}'], ['Animals partly covered', '{{Partial animals}}'], ['Total due', '{{Amount due}}']], [290, 210]);
  styleText_(body.appendParagraph('Please make checks payable to {{Checks payable to}} and mail to {{Mailing address}}, writing {{Bill ID}} on your payment.'), 10).setSpacingBefore(12);
  styleText_(body.appendParagraph('Questions: {{Contact email}} · {{Contact phone}}'), 10);
  doc.saveAndClose();
  var f = DriveApp.getFileById(doc.getId());
  f.moveTo(folder);
  return f;
}
