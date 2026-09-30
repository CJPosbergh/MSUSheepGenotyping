/**
 * Browser test: drives the real website pages in Chromium against the local server (real Apps Script code,
 * mock tracker). Walks a season: submit online with a photo, submit on paper and sign later, packing slip,
 * staff receiving, a batch and its GenomNZ file, results, downloads, a replacement and receiving it.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { chromium } = require('playwright');
const { start } = require('./server');

const PASS = 'test-only-passphrase';
const FORM = path.join(__dirname, 'fixtures', 'MSU_Sheep_GenotypeSubmissionForm.xlsx');
const OUT = path.join(__dirname, 'out');
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

async function makeForm(file, submitter, animals) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FORM);
  const s = wb.getWorksheet('Submitter');
  submitter.forEach((v, i) => { s.getCell('B' + (4 + i)).value = v; });
  const a = wb.getWorksheet('Animals');
  a.spliceRows(2, 1);                                   // delete the EXAMPLE row, as producers are told to
  animals.forEach((r, i) => r.forEach((v, j) => { a.getRow(2 + i).getCell(j + 1).value = v; }));
  await wb.xlsx.writeFile(file);
  return file;
}

// A small valid PNG (solid red 16x16) for the photo upload
function makePng() {
  const zlib = require('zlib');
  const crc = buf => { let c, table = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    let x = 0xffffffff; for (const b of buf) x = table[(x ^ b) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(16 * (1 + 16 * 3)); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) raw[y * 49 + 1 + x * 3] = 200;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const year = new Date().getFullYear();
  const srv = await start({ passphrase: PASS });
  const { env, base } = srv;
  const g = env.ctx;
  const tab = n => g.table_(n);
  const rowOf = (n, k, v) => g.find_(tab(n), k, v);
  const launch = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  const text = sel => page.locator(sel).innerText();

  try {
    console.log('Submit online with a photo');
    const f1 = await makeForm(path.join(OUT, 'smith.xlsx'), ['Jane Smith', 'Smith Ranch', '6100', '12 Ranch Rd, Big Timber MT 59011', '406-555-0101', 'jane@example.com'], [
      ['Home', 'J01', '840003307100001', 'NE05200001', String(year - 3), 'Targhee', 'M', '610014202121T001', 'Y', 'Y', '', '', ''],
      ['Home', 'J02', '840003307100002', 'NE05200002', String(year), 'Targhee', 'F', '610014202626T002', 'Y', 'Y', '', 'J01', ''],
      ['Home', 'J03', '840003307100003', 'NE05200003', String(year), 'Targhee', 'M', '', 'Y', 'Y', '', 'J01', ''],
      ['Home', 'J04', '840003307100004', 'NE05200004', '2018-2020', 'Targhee', 'F', '', 'Y', 'N', '', '', ''],
    ]);
    await page.goto(base + 'index.html');
    await page.setInputFiles('#file', f1);
    await page.waitForSelector('#review:not(.hidden)');
    ok((await text('#sum-animals')) === '4 Targhee', 'form read in the browser: 4 Targhee');
    ok(await page.locator('#errors').isHidden(), 'no form errors');
    ok(await page.locator('#submit').isDisabled(), 'Submit disabled until signed');
    await page.click('#r-y');
    await page.check('#agree');
    await page.fill('#signer', 'Jane Smith');
    await page.setInputFiles('#animal-rows input[data-i="0"]', { name: 'J01.png', mimeType: 'image/png', buffer: PNG });
    ok((await text('#submit')) === 'Submit 4 animals and 1 photo', 'photo counted on the button');
    await page.click('#submit');
    await page.waitForSelector('#done:not(.hidden)');
    ok((await text('#done-title')).includes('P001-01'), 'submitted: ' + await text('#done-title'));
    await page.waitForFunction(() => /All 1 photos uploaded/.test(document.getElementById('photo-progress').innerText));
    ok(tab('Photos').rows.length === 1, 'photo resized and uploaded');
    const tok1 = rowOf('Submissions', 'Submission_ID', 'P001-01').Private_Link_Token;
    ok((await page.getAttribute('#status-link', 'href')).endsWith('status.html?t=' + tok1), 'status link uses the private token');

    console.log('Submit on paper, then sign online');
    const f2 = await makeForm(path.join(OUT, 'jones.xlsx'), ['Bob Jones', 'Jones Sheep Co', '', 'PO Box 4, Dillon MT 59725', '406-555-0199', 'bob@example.com'], [
      ['Home', 'C1', '840003307300001', 'NE05200201', String(year - 1), 'Columbia', 'F', '', 'Y', 'N', '', '', ''],
      ['Home', 'C2', '840003307300002', 'NE05200202', String(year - 1), 'Columbia', 'F', '', 'Y', 'N', '', '', ''],
    ]);
    await page.goto(base + 'index.html');
    await page.setInputFiles('#file', f2);
    await page.waitForSelector('#review:not(.hidden)');
    await page.click('#m-paper');
    ok(await page.locator('#submit').isDisabled(), 'paper route needs the "I\'ll put it in my box" tick');
    await page.check('#paper-ack');
    await page.click('#submit');
    await page.waitForSelector('#done:not(.hidden)');
    ok(await page.locator('#consent-link').isVisible(), 'paper submitters get a consent form link');
    const tok2 = rowOf('Submissions', 'Submission_ID', 'P002-01').Private_Link_Token;
    await page.goto(base + 'status.html?t=' + tok2);
    await page.waitForSelector('#view:not(.hidden)');
    ok(await page.locator('#sig-banner').isVisible(), 'status page asks for a signature');
    ok((await text('#title')).includes('waiting for your samples'), 'status title: ' + await text('#title'));
    await page.click('#sig-banner a');
    await page.waitForSelector('#unsigned:not(.hidden)');
    ok(await page.locator('#sign').isDisabled(), 'sign button waits for all three');
    await page.click('#r-n');
    await page.check('#agree');
    await page.fill('#fullname', 'Bob Jones');
    await page.click('#sign');
    await page.waitForSelector('#signed:not(.hidden)');
    ok(rowOf('Submissions', 'Submission_ID', 'P002-01').Signed_By === 'Bob Jones', 'signed online from the sign page');

    console.log('Packing slip');
    await page.goto(base + 'slip.html?t=' + tok1);
    await page.waitForSelector('#sheet:not(.hidden)');
    ok((await text('#ref')) === 'P001-01' && (await page.locator('.tr:not(.th)').count()) === 4, 'slip lists 4 TSUs');
    ok(await page.locator('#qr svg').count() === 1, 'QR code drawn');
    ok((await text('#from')).includes('Big Timber'), 'slip shows the sender');
    await page.pdf({ path: path.join(OUT, 'slip.pdf'), format: 'Letter' });

    console.log('Staff receiving');
    await page.goto(base + 'staff/receive.html');
    await page.fill('#pass', 'wrong');
    await page.fill('#who', 'Alex');
    await page.click('#unlock');
    await page.waitForSelector('#pass-err:not(.hidden)');
    ok(true, 'wrong passphrase refused');
    await page.fill('#pass', PASS);
    await page.click('#unlock');
    await page.waitForSelector('#app:not(.hidden)');
    const html = fs.readFileSync(path.join(__dirname, '..', 'staff', 'receive.html'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'staff.js'), 'utf8');
    ok(!html.includes(PASS), 'passphrase is not in the page code');
    await page.fill('#q', 'p001-01');
    await page.press('#q', 'Enter');
    await page.waitForSelector('#box:not(.hidden)');
    ok((await text('#b-title')).startsWith('P001-01'), 'box opened by reference');
    for (const t of ['NE05200001', 'ne05200002', 'NE05200003', 'NE05200002', 'NE05200201']) {
      await page.fill('#scan', t);
      await page.press('#scan', 'Enter');
    }
    await page.waitForFunction(() => document.querySelectorAll('#events .ev').length === 5);
    ok((await text('#got')) === '3', '3 of 4 received');
    const ev = await text('#events');
    ok(/scanned twice/.test(ev) && /Belongs to P002-01/.test(ev), 'duplicate and other-submission scans flagged');
    await page.click('#finish');
    await page.waitForSelector('#check-pane:not(.hidden)');
    ok(/J04 \(NE05200004\)/.test(await text('#check-list')), 'check step lists the missing TSU');
    await page.click('#commit');
    await page.waitForSelector('#mail-pane:not(.hidden)');
    ok(/P001-01/.test(await page.inputValue('#m-subj')) && /J04/.test(await page.inputValue('#m-body')), 'receipt email drafted');
    ok(/INV-P001-01/.test(await text('#saved-note')), 'invoice created at receiving');
    await page.fill('#m-body', (await page.inputValue('#m-body')) + '\n\nP.S. edited by staff');
    const before = env.outbox.length;
    await page.click('#send');
    await page.waitForSelector('#done-pane:not(.hidden)');
    ok(env.outbox.length === before + 1 && env.outbox[env.outbox.length - 1].body.includes('edited by staff'), 'edited receipt email sent');
    ok(rowOf('Animals', 'Animal_Key', 'P001-01-J04').Sample_Status === 'Not received', 'missing animal marked Not received');
    // receive Bob's box by scanning a TSU instead of the slip
    await page.click('#another');
    await page.fill('#q', 'NE05200201');
    await page.press('#q', 'Enter');
    await page.waitForSelector('#box:not(.hidden)');
    ok((await text('#b-title')).startsWith('P002-01'), 'box found from one of its TSUs');
    for (const t of ['NE05200201', 'NE05200202']) { await page.fill('#scan', t); await page.press('#scan', 'Enter'); }
    await page.waitForFunction(() => document.getElementById('got').textContent === '2');
    await page.click('#finish');
    await page.click('#commit');
    await page.waitForSelector('#mail-pane:not(.hidden)');
    await page.click('#skip');
    await page.waitForSelector('#done-pane:not(.hidden)');
    ok(/No email was sent/.test(await text('#done-list')), 'finish without emailing');

    console.log('Batch');
    await page.goto(base + 'staff/batches.html');
    await page.waitForSelector('#groups .pick input[data-id]');
    ok(await page.locator('#groups input[data-id]').count() === 2, 'two submissions ready to ship');
    await page.uncheck('#groups input[data-id="P002-01"]');
    ok(/3 TSUs/.test(await text('#sel')), 'selection counts TSUs');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#create')]);
    const file = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(file);
    ok(dl.suggestedFilename() === 'B' + year + '-01_GenomNZ.xlsx', 'GenomNZ file downloaded: ' + dl.suggestedFilename());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    ok(ws.getCell('B6').value === 'P001-01-J01' && ws.getCell('I8').value === 'NE05200003' && !ws.getCell('B9').value, 'file rows: Animal_Key and TSU, 3 rows');
    ok(ws.getCell('F6').value === 'TARGHEE' && ws.getCell('A6').value === 'Montana State University', 'breed and birth flock filled');
    await page.waitForFunction(() => /also saved/.test(document.getElementById('file-note').textContent));
    ok(/drive/.test(rowOf('Batches', 'Batch_ID', 'B' + year + '-01').Export_File), 'copy saved to Drive');
    await page.click('#ship');
    await page.waitForSelector('#shipped-pane:not(.hidden)');
    ok(rowOf('Submissions', 'Submission_ID', 'P001-01').Status === 'At lab', 'marked shipped: submission At lab');
    ok(/1 producer email sent/.test(await text('#shipped-list')), 'producer emailed');
    ok(await page.locator('#groups input[data-id="P002-01"]').count() === 1, 'unshipped submission still ready');

    console.log('Status while at the lab');
    await page.goto(base + 'status.html?t=' + tok1);
    await page.waitForSelector('#view:not(.hidden)');
    ok((await text('#title')).includes('at the lab'), 'status: at the lab');
    ok(await page.locator('#attn-banner').isVisible(), 'missing J04 flagged with a link to send it');

    console.log('Results released');
    g.append_(tab('Results'), [
      { Animal_Key: 'P001-01-J01', Submission_ID: 'P001-01', Condition_ID: 'SCRAPIE', Genotype: 'ARR/ARQ', Call: 'QR', Result_Label: 'Carries Q', Category: 'mid', Batch: 'B', Released: 'Y' },
      { Animal_Key: 'P001-01-J01', Submission_ID: 'P001-01', Condition_ID: 'OPP', Genotype: '1/1', Call: '1/1', Result_Label: 'Lower risk', Category: 'good', Batch: 'B', Released: 'Y' },
      { Animal_Key: 'P001-01-J02', Submission_ID: 'P001-01', Condition_ID: 'SCRAPIE', Genotype: 'ARR/ARR', Call: 'RR', Result_Label: 'Least susceptible', Category: 'good', Batch: 'B', Released: 'Y' },
      { Animal_Key: 'P001-01-J02', Submission_ID: 'P001-01', Condition_ID: 'OPP', Genotype: '2/3', Call: '2/3', Result_Label: 'Higher risk', Category: 'bad', Batch: 'B', Released: 'Y' },
    ]);
    g.append_(tab('Parentage'), [{ Animal_Key: 'P001-01-J02', Submission_ID: 'P001-01', Reported_Sire: 'J01', Sire_Result: 'Confirmed', Sire_Assigned: 'P001-01-J01', Dam_Result: 'Not genotyped', Released: 'Y' }]);
    ['J01', 'J02'].forEach(t => g.update_(tab('Animals'), rowOf('Animals', 'Animal_Key', 'P001-01-' + t), { Sample_Status: 'Complete' }));
    g.update_(tab('Animals'), rowOf('Animals', 'Animal_Key', 'P001-01-J03'), { Sample_Status: 'Failed QC' });
    const rel = g.releaseEmail_('P001-01');
    g.reviewSend('release', 'P001-01', rel.draft.subject, rel.draft.body);
    const folder = env.drive.api.getFolderById(g.folderIdFromUrl_(rowOf('Submissions', 'Submission_ID', 'P001-01').Drive_Folder));
    const pdf = folder.createFile(g.Utilities.newBlob([37, 80, 68, 70], 'application/pdf', 'P001-01_results.pdf'));
    g.update_(tab('Submissions'), rowOf('Submissions', 'Submission_ID', 'P001-01'), { Results_PDF: g.fileUrl_(pdf) });
    await page.goto(base + 'status.html?t=' + tok1);
    await page.waitForSelector('#view:not(.hidden)');
    ok((await text('#title')) === 'Smith Ranch results', 'results title');
    const stats = await text('#stats');
    ok(/Results complete\s*2/.test(stats) && /Resample needed\s*1/.test(stats) && /Sample not received\s*1/.test(stats), 'summary tiles');
    const rows = await text('#rows');
    ok(/QR · Carries Q/.test(rows) && /Higher risk/.test(rows) && /Sire confirmed/.test(rows), 'scrapie, OPP and parentage shown');
    ok(/Resample needed/.test(rows) && /Sample not received/.test(rows), 'attention rows for J03 and J04');
    ok(await page.locator('#dl-xlsx').isHidden(), 'no Excel button until R uploads one');
    const [pdl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-pdf')]);
    ok(pdl.suggestedFilename() === 'P001-01_results.pdf', 'results PDF downloads');
    await page.click('.pill[data-f="attention"]');
    ok((await page.locator('#rows .tbl-row').count()) === 2, 'Needs attention filter shows 2');
    await page.pdf({ path: path.join(OUT, 'status-results.pdf'), format: 'Letter' });

    console.log('Phone layout');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const u of ['status.html?t=' + tok1, 'index.html', 'sign.html?t=' + tok2, 'staff/receive.html', 'staff/batches.html']) {
      await page.goto(base + u);
      await page.waitForTimeout(300);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      ok(w <= 392, u.split('?')[0] + ' fits a phone (' + w + 'px)');
    }
    await page.goto(base + 'status.html?t=' + tok1);
    await page.waitForSelector('#view:not(.hidden)');
    await page.screenshot({ path: path.join(OUT, 'status-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    console.log('Replacement');
    await page.goto(base + 'replace.html?t=' + tok1);
    await page.waitForSelector('#pick:not(.hidden)');
    ok((await page.locator('.animal').count()) === 2, 'J03 and J04 need samples');
    ok(await page.locator('#go').isDisabled(), 'needs the new TSU for the failed sample');
    await page.fill('#animals input.field', 'NE05200003');
    ok(/that is the one that failed/.test(await text('#hint')), 'same TSU refused in the browser');
    await page.fill('#animals input.field', 'NE05200099');
    await page.click('#go');
    await page.waitForSelector('#done:not(.hidden)');
    ok((await text('#done-title')).includes('P001-01-R1'), 'replacement registered');
    await page.click('#slip');
    const slipPage = await context.waitForEvent('page').catch(() => null);
    const sp = slipPage || page;
    if (slipPage) await sp.waitForLoadState();
    else await page.goto(base + 'slip.html?t=' + tok1 + '&r=P001-01-R1');
    await sp.waitForSelector('#sheet:not(.hidden)');
    ok((await sp.locator('#count').innerText()) === '2 replacement TSUs in this shipment', 'replacement slip');
    if (slipPage) await slipPage.close();

    console.log('Receive the replacement');
    await page.goto(base + 'staff/receive.html');
    await page.waitForSelector('#app:not(.hidden)');
    await page.fill('#q', 'NE05200099');
    await page.press('#q', 'Enter');
    await page.waitForSelector('#box:not(.hidden)');
    ok((await text('#b-title')).startsWith('P001-01-R1'), 'new TSU finds the replacement');
    for (const t of ['NE05200099', 'NE05200004']) { await page.fill('#scan', t); await page.press('#scan', 'Enter'); }
    await page.waitForFunction(() => document.getElementById('got').textContent === '2');
    await page.click('#finish');
    await page.click('#commit');
    await page.waitForSelector('#mail-pane:not(.hidden)');
    await page.click('#send');
    await page.waitForSelector('#done-pane:not(.hidden)');
    const j03 = rowOf('Animals', 'Animal_Key', 'P001-01-J03');
    ok(j03.TSU_Barcode === 'NE05200099' && j03.Replaced_TSU === 'NE05200003' && !j03.Batch && j03.Sample_Status === 'Received', 'J03 now carries the new TSU, ready for the next batch');
    ok(rowOf('Animals', 'Animal_Key', 'P001-01-J04').Sample_Status === 'Received', 'late original J04 received');
    await page.goto(base + 'staff/batches.html');
    await page.waitForSelector('#groups .pick input[data-id]');
    ok(/includes 1 replacement/.test(await text('#groups')), 'replacement ready for the next batch');

    console.log('Staff lock');
    await page.click('#lock');
    await page.waitForSelector('#gate:not(.hidden)');
    ok(await page.evaluate(() => !localStorage.getItem('msuGenoStaff')), 'Lock forgets the passphrase');

    ok(errors.length === 0, 'no script errors in any page' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nAll ' + passed + ' browser checks passed.');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('\nFAILED after ' + passed + ' checks: ' + e.message + (errors.length ? '\nPage errors: ' + errors.join(' | ') : ''));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await srv.close();
  }
})();
