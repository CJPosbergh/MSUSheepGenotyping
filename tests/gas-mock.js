/**
 * In-memory stand-ins for the Google Apps Script services the back end uses, so the real .gs files can
 * run in Node. Loads the tracker .xlsx into fake sheets (formulas kept as text, never evaluated: the back
 * end is written not to read formula columns).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

// ------------------------------------------------------------------ Blob / Utilities
class Blob {
  constructor(bytes, type, name) { this.bytes = Buffer.from(bytes || []); this.type = type || 'application/octet-stream'; this.name = name || ''; }
  getBytes() { return Array.from(this.bytes); }
  getContentType() { return this.type; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getDataAsString() { return this.bytes.toString('utf8'); }
  getAs(t) { return new Blob(this.bytes, t, this.name); }
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256' },
  formatDate(d, tz, fmt) {
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    if (fmt === 'yyyy-MM-dd') return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (fmt === 'd MMM yyyy') return `${day} ${MONTHS[m]} ${y}`;
    throw new Error('mock formatDate: ' + fmt);
  },
  computeDigest(alg, s) { return Array.from(crypto.createHash('sha256').update(String(s)).digest()).map(b => (b > 127 ? b - 256 : b)); },
  getUuid() { return crypto.randomUUID(); },
  base64Decode(s) { return Array.from(Buffer.from(s, 'base64')); },
  base64Encode(bytes) { return Buffer.from(bytes.map(b => (b + 256) % 256)).toString('base64'); },
  newBlob(bytes, type, name) { return new Blob(typeof bytes === 'string' ? Buffer.from(bytes) : bytes.map(b => (b + 256) % 256), type, name); },
};

// ------------------------------------------------------------------ Sheets
class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      out.push(Array.from({ length: this.nc }, (_, j) => (row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j])));
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error(`setValues size ${v.length}x${v[0].length} into ${this.nr}x${this.nc}`);
    v.forEach((row, i) => row.forEach((x, j) => this.sheet.set(this.r + i, this.c + j, x)));
    return this;
  }
  setValue(x) { this.sheet.set(this.r, this.c, x); return this; }
  setNumberFormat() { return this; }
  getRow() { return this.r; }
}
class Sheet {
  constructor(name, data) { this.name = name; this.data = data; }
  getName() { return this.name; }
  set(r, c, x) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    if (typeof x === 'string' && x.startsWith("'")) x = x.slice(1);
    row[c - 1] = x;
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => v !== '' && v !== null && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() { return (this.data[0] || []).length; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), this.getLastColumn()); }
  deleteRow(n) { this.data.splice(n - 1, 1); }
}
class Spreadsheet {
  constructor(sheets) { this.sheets = sheets; this.id = 'SPREADSHEET_ID_12345678901'; }
  getSheetByName(n) { return this.sheets[n] || null; }
  getId() { return this.id; }
}

async function loadTracker(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = {};
  wb.eachSheet(ws => {
    const data = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        let v = row.getCell(c).value;
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          if (v.formula !== undefined) v = '=' + v.formula;
          else if (v.richText) v = v.richText.map(t => t.text).join('');
          else if (v.text !== undefined) v = v.text;
          else if (v.result !== undefined) v = v.result;
        }
        if (v instanceof Date) v = new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
        vals.push(v === null || v === undefined ? '' : v);
      }
      data[r - 1] = vals;
    });
    for (let i = 0; i < data.length; i++) if (!data[i]) data[i] = [];
    // drop trailing empty rows
    let last = data.length;
    while (last > 1 && !data[last - 1].some(v => v !== '')) last--;
    // header width
    const width = data[0].length;
    sheets[ws.name] = new Sheet(ws.name, data.slice(0, last).map(r => { const x = r.slice(0, width); while (x.length < width) x.push(''); return x; }));
  });
  return new Spreadsheet(sheets);
}

// ------------------------------------------------------------------ Drive
let nextId = 1;
const newId = p => `${p}_${String(nextId++).padStart(28, '0')}`;
class File {
  constructor(drive, name, blob, parent, doc) { Object.assign(this, { drive, name, blob, parent, doc, trashed: false, id: newId('FILE') }); drive.files[this.id] = this; }
  getId() { return this.id; }
  getName() { return this.name; }
  setTrashed(t) { this.trashed = t; }
  isTrashed() { return this.trashed; }
  getBlob() { return this.blob ? new Blob(this.blob.bytes, this.blob.type, this.name) : this.getAs('application/pdf'); }
  getAs(type) {
    if (this.doc) return new Blob(Buffer.from(this.doc.render()), type, this.name + '.pdf');
    return new Blob(this.blob.bytes, type, this.name);
  }
  makeCopy(name, folder) {
    const f = new File(this.drive, name, this.blob, folder, this.doc ? this.doc.clone(this.drive) : null);
    if (f.doc) { f.doc.id = f.id; this.drive.docs[f.id] = f.doc; }
    return f;
  }
  moveTo(folder) { this.parent = folder; return this; }
}
class Folder {
  constructor(drive, name, parent) { Object.assign(this, { drive, name, parent, id: newId('FOLDER') }); drive.folders[this.id] = this; }
  getId() { return this.id; }
  getName() { return this.name; }
  createFolder(n) { return new Folder(this.drive, n, this); }
  getFoldersByName(n) { return iter(Object.values(this.drive.folders).filter(f => f.parent === this && f.name === n)); }
  getFilesByName(n) { return iter(Object.values(this.drive.files).filter(f => f.parent === this && f.name === n && !f.trashed)); }
  createFile(blob) { return new File(this.drive, blob.getName(), blob, this); }
  files() { return Object.values(this.drive.files).filter(f => f.parent === this && !f.trashed); }
}
const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
function makeDrive() {
  const drive = { folders: {}, files: {}, docs: {} };
  drive.root = new Folder(drive, 'My Drive', null);
  drive.api = {
    getFolderById: id => { const f = drive.folders[id]; if (!f) throw new Error('No folder ' + id); return f; },
    getFileById: id => { const f = drive.files[id]; if (!f) throw new Error('No file ' + id); return f; },
    createFolder: n => drive.root.createFolder(n),
    getFoldersByName: n => drive.root.getFoldersByName(n),
  };
  return drive;
}

// ------------------------------------------------------------------ Docs (just the parts the templates use)
class TextEl {
  constructor(owner) { this.owner = owner; }
  getText() { return this.owner.getText(); }
  setFontFamily() { return this; } setFontSize() { return this; } setBold() { return this; } setForegroundColor() { return this; }
}
function replaceIn(obj, pattern, repl) {
  const re = new RegExp(pattern, 'g');
  const r = repl.replace(/\\\$/g, '$$$$').replace(/\\\\/g, '\\');
  obj.text = obj.text.replace(re, r);
}
class Para {
  constructor(text, parent) { this.text = text; this.parent = parent; }
  getText() { return this.text; }
  getType() { return 'PARAGRAPH'; }
  asParagraph() { return this; }
  editAsText() { return new TextEl(this); }
  setSpacingBefore() { return this; }
  replaceText(p, r) { replaceIn(this, p, r); }
  removeFromParent() { const a = this.parent.paras; a.splice(a.indexOf(this), 1); }
  clone(parent) { return new Para(this.text, parent); }
}
class Cell {
  constructor(text) { this.paras = [new Para(text, this)]; }
  getText() { return this.paras.map(p => p.text).join('\n'); }
  getNumChildren() { return this.paras.length; }
  getChild(i) { return this.paras[i]; }
  appendParagraph(t) { const p = new Para(t, this); this.paras.push(p); return p; }
  editAsText() { return new TextEl(this); }
  setWidth() { return this; } setBackgroundColor() { return this; }
  replaceText(p, r) { this.paras.forEach(x => x.replaceText(p, r)); }
  clone() { const c = new Cell(''); c.paras = this.paras.map(p => p.clone(c)); return c; }
}
class Row {
  constructor(cells) { this.cells = cells; }
  getNumCells() { return this.cells.length; }
  getCell(i) { return this.cells[i]; }
  getText() { return this.cells.map(c => c.getText()).join('\t'); }
  editAsText() { return new TextEl(this); }
  copy() { return new Row(this.cells.map(c => c.clone())); }
  replaceText(p, r) { this.cells.forEach(c => c.replaceText(p, r)); }
}
class Table {
  constructor(rows) { this.rows = rows.map(r => new Row(r.map(t => new Cell(t)))); }
  getNumRows() { return this.rows.length; }
  getRow(i) { return this.rows[i]; }
  insertTableRow(i, row) { this.rows.splice(i, 0, row); return row; }
  removeRow(i) { this.rows.splice(i, 1); }
  setBorderWidth() { return this; } setBorderColor() { return this; }
  replaceText(p, r) { this.rows.forEach(x => x.replaceText(p, r)); }
  getText() { return this.rows.map(r => r.getText()).join('\n'); }
}
class Body {
  constructor() { this.items = []; this.paras = this.items; }
  clear() { this.items.length = 0; }
  setMarginTop() { return this; } setMarginBottom() { return this; } setMarginLeft() { return this; } setMarginRight() { return this; }
  appendParagraph(t) { const p = new Para(t, this); this.items.push(p); return p; }
  appendTable(rows) { const t = new Table(rows); this.items.push(t); return t; }
  getTables() { return this.items.filter(i => i instanceof Table); }
  replaceText(p, r) { this.items.forEach(i => i.replaceText(p, r)); }
}
class Doc {
  constructor(name) { this.name = name; this.body = new Body(); }
  getId() { return this.id; }
  getBody() { return this.body; }
  saveAndClose() {}
  render() { return this.body.items.map(i => i.getText()).join('\n'); }
  clone() {
    const d = new Doc(this.name);
    d.body.items = this.body.items.map(i => {
      if (i instanceof Para) return new Para(i.text, d.body);
      const t = new Table([]); t.rows = i.rows.map(r => r.copy()); return t;
    });
    d.body.paras = d.body.items;
    return d;
  }
}

// ------------------------------------------------------------------ environment
async function makeEnv(trackerFile, opts = {}) {
  const ss = await loadTracker(trackerFile);
  const drive = makeDrive();
  const outbox = [];
  const props = {};
  const cache = {};
  const triggers = [];
  const ui = { alerts: [], dialogs: [] };
  const active = { sheet: null, row: 2 };
  const ctx = {
    console: opts.quiet ? { log() {}, error() {}, warn() {} } : console,
    Date, Math, JSON, Object, Array, String, Number, RegExp, Error, Buffer,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, openById: () => ss, flush() {},
      getUi: () => ({
        alert: (a, b) => ui.alerts.push(b || a), ButtonSet: { OK: 'OK' },
        createMenu: () => { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; },
        showModalDialog: (html, title) => ui.dialogs.push({ title, html }),
      }),
      getActiveSheet: () => ss.getSheetByName(active.sheet),
      getActiveRange: () => ({ getRow: () => active.row }),
    },
    DriveApp: drive.api,
    DocumentApp: {
      create: name => { const d = new Doc(name); const f = new File(drive, name, null, drive.root, d); d.id = f.id; drive.docs[f.id] = d; return d; },
      openById: id => { const d = drive.docs[id]; if (!d) throw new Error('No doc ' + id); return d; },
      ElementType: { PARAGRAPH: 'PARAGRAPH', TABLE: 'TABLE' },
    },
    MailApp: { sendEmail: msg => { if (opts.failMail) throw new Error('quota'); outbox.push(msg); } },
    Utilities,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t })),
      newTrigger: fn => { const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, create: () => triggers.push(fn) }; return b; },
    },
    HtmlService: {
      createTemplateFromFile: () => { const t = { evaluate: () => ({ setWidth() { return this; }, setHeight() { return this; }, data: t.data }) }; return t; },
    },
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, ss, drive, outbox, props, triggers, ui, active, cache };
}

module.exports = { makeEnv, loadTracker, Blob };
