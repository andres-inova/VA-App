// Time-off and coverage requests from the Google Form "IL Coverage/Time-Off Request".
// A Google Apps Script attached to the form (see google-form-script.js) sends each new
// response here. The request must include the shared secret FORM_SECRET.

import { matchVA } from './zoho.js';
import { sendEmail, postToSlack, slackSafe } from './notify.js';
import * as messages from './messages.js';
import { formatDate, partsIn, addDays, REPORT_ZONE } from './time.js';
import { esc, isDate } from './util.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Compares two strings in a way that takes the same time whether or not they match.
function sameSecret(a, b) {
  const x = new TextEncoder().encode(a || '');
  const y = new TextEncoder().encode(b || '');
  if (!x.length || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const text = (value, max = 2000) => (value ?? '').toString().trim().slice(0, max);

// Google Forms sends dates as MM-DD-YYYY (for example 10-05-2026). This also accepts
// M/D/YYYY and YYYY-MM-DD. Returns "2026-10-05", or "" if the date can't be read.
export function toISODate(value) {
  const s = text(value, 40);
  let y, m, d;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [, y, m, d] = match;
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) [, m, d, y] = match;
  else return '';
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Reject impossible dates such as 02-30-2026.
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return '';
  return date.toISOString().slice(0, 10);
}

// The form's extra answers, kept together so admins can read them on the Time off page.
function formDetails(body) {
  return [
    body.clients && `Clients: ${text(body.clients)}`,
    body.shift_times && `Shift times to cover: ${text(body.shift_times)}`,
    body.template_filled && `Filled out the coverage template before: ${text(body.template_filled, 20)}`,
  ].filter(Boolean).join('\n');
}

export async function handleFormWebhook(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The request was not valid JSON.' }, 400);
  }
  if (!env.FORM_SECRET || !sameSecret(text(body.secret, 200), env.FORM_SECRET.trim())) {
    return json({ error: 'Wrong or missing secret.' }, 403);
  }
  const responseId = text(body.response_id, 200);
  const name = text(body.name, 200);
  const start = toISODate(body.start_date);
  const end = toISODate(body.end_date) || start;
  const problems = [
    !responseId && 'the response id is missing',
    !name && 'the name is missing',
    !isDate(start) && `the start date "${text(body.start_date, 40)}" is not a date like 10-05-2026`,
    body.end_date && !toISODate(body.end_date) && `the end date "${text(body.end_date, 40)}" is not a date like 10-05-2026`,
  ].filter(Boolean);
  if (problems.length) return json({ error: `Not accepted: ${problems.join('; ')}.` }, 400);
  const [first, last] = end < start ? [end, start] : [start, end];
  const details = formDetails(body);
  const note = text(body.notes, 1000) || null;

  // The same response sent twice (for example, from the backfill) is stored once.
  const seen = await env.DB.prepare(
    `SELECT 1 FROM time_off_requests WHERE form_response_id = ?1
     UNION ALL SELECT 1 FROM form_unmatched WHERE form_response_id = ?1`
  ).bind(responseId).first();
  if (seen) return json({ ok: true, duplicate: true });

  const { results: vas } = await env.DB.prepare('SELECT id, name FROM users WHERE is_va = 1').all();
  const va = matchVA(name, vas);
  if (va) {
    await env.DB.prepare(
      `INSERT INTO time_off_requests (user_id, start_date, end_date, needs_coverage, note, details, source, form_response_id)
       VALUES (?, ?, ?, 1, ?, ?, 'form', ?)`
    ).bind(va.id, first, last, note, details, responseId).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO form_unmatched (form_response_id, name, start_date, end_date, details, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(responseId, name, first, last, details, note).run();
  }
  await notifyAdmins(env, { name: va ? va.name : name, matched: Boolean(va), start: first, end: last, details, note });
  // Requests need 2 weeks' notice. Shorter ones are kept (an admin decides) and flagged to the VA leads.
  const today = partsIn(REPORT_ZONE).date;
  if (first < addDays(today, 14)) {
    await notifyShortNotice(env, { name: va ? va.name : name, start: first, end: last, today, details, note });
  }
  return json({ ok: true, matched: va ? va.name : null });
}

// Posts a request sent with less than 2 weeks' notice in #va-lead-channel.
async function notifyShortNotice(env, { name, start, end, today, details, note }) {
  const dates = start === end ? formatDate(start, true) : `${formatDate(start, true)} to ${formatDate(end, true)}`;
  const days = Math.round((Date.parse(start) - Date.parse(today)) / 86400000);
  const notice = days <= 0 ? 'starting today or earlier' : `${days} day${days === 1 ? '' : 's'} before it starts`;
  const lines = [details, note && `Extra notes: ${note}`].filter(Boolean).join('\n');
  const msg = messages.slack({
    title: "⏰ Time-off request with less than 2 weeks' notice",
    subtitle: `${name} · ${dates}`,
    intro: `*${slackSafe(name)}* sent a time-off request ${notice}. It has not been denied: approve or deny it on the Time off page.`,
    details: lines ? lines.split('\n').map((l) => `> ${slackSafe(l)}`) : [],
    button: { label: 'Open Time off', url: `${env.APP_URL}/admin/time-off` },
    footer: 'Requests should be sent at least 2 weeks ahead. Anything sooner goes to the VA\'s management channel.',
  });
  await postToSlack(env, env.VA_LEAD_CHANNEL_ID, msg.text, msg.blocks);
}

// Emails every admin who has time-off notifications turned on.
async function notifyAdmins(env, { name, matched, start, end, details, note }) {
  const { results: admins } = await env.DB.prepare('SELECT email FROM users WHERE is_admin = 1 AND notify_time_off = 1').all();
  if (!admins.length) return;
  const dates = start === end ? formatDate(start, true) : `${formatDate(start, true)} to ${formatDate(end, true)}`;
  const warning = matched ? '' : `The name "${name}" did not match any active VA. Choose the right VA on the Time off page.`;
  const subject = `Coverage/time-off request from ${name}`;
  const lines = [details, note && `Extra notes: ${note}`].filter(Boolean).join('\n');
  const mail = messages.email({
    title: '🌴 New time-off request',
    subtitle: `${name} · ${dates}`,
    intro: `<strong>${esc(name)}</strong> asked for time off or coverage on <strong>${esc(dates)}</strong>.`
      + (warning ? `<br><span style="color:#b42318">${esc(warning)}</span>` : ''),
    details: lines ? `<div style="background:#d9fdd3;border-radius:4px 14px 14px 14px;padding:12px 16px;white-space:pre-line;font-size:14px">${esc(lines)}</div>` : '',
    plainDetails: [lines, warning].filter(Boolean).join('\n'),
    button: { label: 'Approve or deny the request', url: `${env.APP_URL}/admin/time-off` },
    footer: 'You get this email because time-off notifications are on for you. Turn them off in Settings.',
  });
  await sendEmail(env, admins.map((a) => a.email).join(', '), subject, mail.text, mail.html);
}
