/**
 * Emails: wording comes from the tracker's Email_Templates tab.
 *   {Placeholder}             replaced with a value
 *   {#if name} ... {/if}      kept only when flags[name] is true
 */

function template_(id) {
  var t = table_('Email_Templates');
  var row = find_(t, 'Email_ID', id);
  if (!row) throw new Error('Email template ' + id + ' is missing from the Email_Templates tab.');
  return { subject: String(row.Subject), body: String(row.Body) };
}

function fillTemplate_(text, vars, flags) {
  flags = flags || {};
  var out = String(text).replace(/\{#if ([A-Za-z_]+)\}([\s\S]*?)\{\/if\}/g, function (_, name, inner) {
    return flags[name] ? inner : '';
  });
  out = out.replace(/\{([^{}#\/][^{}]*)\}/g, function (whole, key) {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole;
  });
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Values every email can use, from Settings. */
function commonVars_(s) {
  s = s || settings_();
  return {
    'Mailing address': s.Mailing_Address, 'Drop-off location': s.Dropoff_Location, 'Drop-off hours': s.Dropoff_Hours,
    'Contact email': s.Contact_Email, 'Contact phone': s.Contact_Phone, 'Checks payable to': s.Checks_Payable_To,
    'Paper form link': s.Paper_Consent_Form, 'Reminder days': s.Reminder_First_Days
  };
}

function siteUrl_(s, page, params) {
  var base = String((s || settings_()).Site_URL || '').replace(/\/?$/, '/');
  var q = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  return base + page + (q ? '?' + q : '');
}

/** Build { subject, body } for a template without sending. */
function draftEmail_(id, vars, flags) {
  var tpl = template_(id);
  var all = Object.assign(commonVars_(), vars || {});
  return { subject: fillTemplate_(tpl.subject, all, flags), body: fillTemplate_(tpl.body, all, flags) };
}

function htmlBody_(text) {
  var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  return String(text).split(/\n{2,}/).map(function (p) {
    var h = esc(p).replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
    return '<p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#16233A">' + h + '</p>';
  }).join('');
}

/**
 * Send an email and log it. opts: { attachments, submissionId, sentBy, emailId }.
 * Errors are logged and re-thrown so the caller can tell the user.
 */
function sendEmail_(to, subject, body, opts) {
  opts = opts || {};
  var s = settings_();
  var result = 'Sent';
  try {
    var msg = { to: to, subject: subject, body: body, htmlBody: htmlBody_(body),
      name: s.Email_From_Name || 'MSU Sheep Genotyping' };
    if (s.Email_Reply_To) msg.replyTo = s.Email_Reply_To;
    if (opts.attachments) msg.attachments = opts.attachments;
    MailApp.sendEmail(msg);
  } catch (e) {
    result = 'Failed: ' + e.message;
    throw e;
  } finally {
    try {
      append_(table_('Email_Log'), [{ Sent_At: new Date(), Email_ID: opts.emailId || '', To: to, Subject: subject,
        Submission_ID: opts.submissionId || '', Sent_By: opts.sentBy || 'System', Result: result }]);
    } catch (logErr) { console.error('Email log failed: ' + logErr.message); }
  }
}

function sendTemplate_(id, to, vars, flags, opts) {
  var d = draftEmail_(id, vars, flags);
  sendEmail_(to, d.subject, d.body, Object.assign({ emailId: id }, opts || {}));
  return d;
}
