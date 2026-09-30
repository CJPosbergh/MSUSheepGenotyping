/**
 * Business rules that several actions share: producers, submissions, cost-share and IDs.
 */

var GENO_TEXT = 'Genotyping with conditions and parentage';

function submissionByToken_(token) {
  var t = table_('Submissions');
  var tok = clean_(token);
  if (!tok || tok.length < 8) throw httpError_('This link is not valid.', 'not_found');
  var row = find_(t, 'Private_Link_Token', tok);
  if (!row) throw httpError_('We could not find a submission for this link. Please check it matches the one in your email.', 'not_found');
  return { t: t, row: row };
}

function producerOf_(sub) {
  var t = table_('Producers');
  return find_(t, 'Producer_ID', sub.Producer_ID) || {};
}

/** Who and where a submission came from: the details typed on its form (Contact_On_Form), else the producer record. */
function contactOf_(sub, producer) {
  var p = producer || {};
  var f = clean_(sub.Contact_On_Form).split(' | ');
  var pick = function (i, k) { return f.length >= 4 && clean_(f[i]) ? clean_(f[i]) : clean_(p[k]); };
  return { name: pick(0, 'Contact_Name'), flock: pick(1, 'Flock_Name'), address: pick(2, 'Mailing_Address'), phone: pick(3, 'Phone') };
}

function isSigned_(sub) {
  return !!clean_(sub.Signed_By);
}

function nextProducerId_(t) {
  var max = 0;
  t.rows.forEach(function (r) { var m = String(r.Producer_ID).match(/^P(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
  return 'P' + ('00' + (max + 1)).slice(-3);
}

function nextSubmissionId_(t, producerId) {
  var max = 0, re = new RegExp('^' + producerId + '-(\\d+)$');
  t.rows.forEach(function (r) { var m = String(r.Submission_ID).match(re); if (m) max = Math.max(max, Number(m[1])); });
  return producerId + '-' + ('0' + (max + 1)).slice(-2);
}

function animalKey_(sid, a) {
  return sid + '-' + (clean_(a.flockTag) || clean_(a.eid));
}

/** Cost_Share tab as { ID: row }. */
function programs_() {
  var map = {};
  table_('Cost_Share').rows.forEach(function (r) { map[String(r.Program_ID).trim()] = r; });
  return map;
}

function shortPartner_(prog) {
  var name = clean_(prog && prog.Partner_Organization);
  var m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : name;
}

/** Proven = receipt year minus earliest birth year is at least Proven_Min_Age. */
function isProven_(animal, receivedDate, minAge) {
  var y = earliestYear_(animal.Year_of_Birth);
  if (!y) return false;
  var d = receivedDate ? new Date(receivedDate) : today_();
  return d.getFullYear() - y >= (Number(minAge) || 2);
}

/**
 * Which program pays for this animal and how much: { program, level: 'Full'|'Partial'|'None', perAnimal }.
 * Mirrors the CS_Program / CS_Level formulas on the Animals tab.
 */
function costShareFor_(animal, sub, programs, minAge) {
  var none = { program: '', level: 'None', perAnimal: 0 };
  var base = clean_(animal.CS_Override_Program) || clean_(sub.Cost_Share_Program);
  if (!base) return none;
  var prog = programs[base];
  if (!prog) return none;
  if (yes_(prog.Requires_NSIP) && !clean_(animal.NSIP_ID)) return none;
  var level = clean_(animal.CS_Override_Level) || (isProven_(animal, sub.Received_Date, minAge) ? 'Full' : 'Partial');
  if (level === 'None') return none;
  var per = Number(level === 'Full' ? prog.Full_Share : prog.Partial_Share) || 0;
  return { program: base, level: level, perAnimal: per };
}

/** Description used on invoice lines, e.g. "Genotyping ...: covered in full by ASI". */
function genoDescription_(programId, level, programs) {
  if (!programId || level === 'None') return GENO_TEXT;
  var who = shortPartner_(programs[programId]) || programId;
  return GENO_TEXT + ': ' + (level === 'Full' ? 'covered in full by ' : 'partly covered by ') + who;
}

/** Everything about one submission, loaded once. */
function loadSubmission_(sid) {
  var subs = table_('Submissions');
  var sub = find_(subs, 'Submission_ID', sid);
  if (!sub) throw httpError_('No submission ' + sid + '.', 'not_found');
  var animalsT = table_('Animals');
  return { subs: subs, sub: sub, producer: producerOf_(sub), animalsT: animalsT, animals: filter_(animalsT, 'Submission_ID', sid) };
}

function breedSummary_(animals) {
  var seen = [];
  animals.forEach(function (a) { var b = clean_(a.Breed || a.breed); if (b && seen.indexOf(b) < 0) seen.push(b); });
  return seen.join(', ');
}

/** Submission status shown to producers. */
function producerVars_(ctx, s) {
  var sub = ctx.sub, p = ctx.producer;
  return {
    'First name': firstName_(p.Contact_Name), 'Submission ID': sub.Submission_ID,
    'Animal count': ctx.animals.length, 'Breed': clean_(sub.Breed) || breedSummary_(ctx.animals),
    'Private link': siteUrl_(s, 'status.html', { t: sub.Private_Link_Token }),
    'Packing slip link': siteUrl_(s, 'slip.html', { t: sub.Private_Link_Token }),
    'Sign link': siteUrl_(s, 'sign.html', { t: sub.Private_Link_Token })
  };
}
