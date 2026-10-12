// New job applications from the Wufoo application form. Wufoo sends each new entry here (a "WebHook"
// notification set up on the form in Wufoo), and it becomes a new applicant at the step "New application".
//
// What Wufoo sends (a normal form post): Field1, Field2, … (one per answer; a Name field's first and last name,
// an address's parts and each checkbox get their own numbers), FieldN-url for a file upload (FieldN is then the
// file name), EntryId, DateCreated, HandshakeKey, and, when "Include Field and Form Structures with Entry Data"
// is ticked in Wufoo, FieldStructure and FormStructure: JSON describing each field (ID, Title, Type, SubFields).
// The request must include the Handshake Key that matches the WUFOO_HANDSHAKE_KEY secret.

import { allFields, nameOf, statusOf, searchOf, STEPS } from './fields.js';
import { FILE_TYPES, MAX_FILE } from './sops.js';
import { sameSecret } from './forms.js';

// ---- Which Wufoo question goes into which applicant field ----
// To send a Wufoo question into a field, add its title (as written on the Wufoo form) to that field's list.
// Capitals, spaces and punctuation don't matter ("E-mail address:" matches "email address").
// Questions that match nothing are kept under "Other fields from Wufoo" on the applicant, and listed in the
// Wufoo box on the Applicants page.
// The long titles are the questions on the live form "InoVA Local - Applicant Form" (inova.wufoo.com/forms/q1cb52tu1f220n5),
// as of 2026-10-12. Its other questions (home office, 8-hour availability, schedule changes, the scenario answers,
// how they heard about us, text-message consent) have no app field and are kept under "Other fields from Wufoo".
export const WUFOO_FIELDS = [
  ['_name', ['Name', 'Full name', 'Your name', 'Applicant name']], // first and last name together
  ['Name', ['First name', 'First']],
  ['Last_Name', ['Last name', 'Last', 'Surname']],
  ['Email', ['Email', 'Email address', 'Your email', 'Your email address']],
  ['Phone', ['Phone', 'Phone number', 'Cell phone', 'Cell phone number', 'Mobile', 'Mobile number', 'Best phone number']],
  ['Location', ['Location', 'City', 'City and state', 'City state', 'Address', 'Where are you located', 'Where do you live',
    'Where are you located? (city/state)']],
  ['Time_zone', ['Time zone', 'Timezone', 'Your time zone', 'What time zone are you in', 'Which time zone are you in',
    'What time zone do you currently work in?']],
  ['Availability', ['Availability', 'Your availability', 'What is your availability', 'Hours available', 'Available hours',
    'What days and times are you typically available to work? Please list time zone preference as well.']],
  ['Year_of_admin_experience', ['Years of admin experience', 'Year of admin experience', 'Years of administrative experience',
    'How many years of admin experience do you have', 'How many years of administrative experience do you have']],
  ['Prev_service_industry_experience1', ['Previous service industry experience', 'Prev service industry experience', 'Service industry experience',
    'Do you have previous service industry experience',
    'Have you worked with clients in service-based industries (such as cleaning companies, home services, or similar)?']],
  ['Cleaning_industry_experience', ['Cleaning industry experience', 'Do you have cleaning industry experience']],
  ['Systems_Tools', ['Systems Tools', 'Systems and tools', 'Systems tools used', 'Which systems tools have you used', 'Software', 'Tools',
    'Which systems or tools have you used in previous roles?']],
  ['Languages', ['Languages', 'Languages spoken', 'What languages do you speak',
    'Many of our clients value and seek out fluent bilingual admins for their businesses. Please let us know what languages you are fluent in below.']],
  ['VA_Bio', ['Bio', 'VA bio', 'Short bio']],
  ['Resume', ['Resume', 'Resume CV', 'CV', 'Upload your resume', 'Attach your resume', 'Résumé', 'Upload your resume as a PDF']],
];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_TITLE = new Map(WUFOO_FIELDS.flatMap(([key, titles]) => titles.map((t) => [norm(t), key])));
// When a title matches nothing, some Wufoo field types still say where the answer belongs.
const BY_TYPE = { shortname: '_name', email: 'Email', phone: 'Phone', address: 'Location' };

const STATUS_KEY = 'wufoo_status';
const MAX_FILES = 3; // files downloaded per entry (keeps each call small)
const TEXT_MAX = 5000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const clean = (v, max = TEXT_MAX) => (v ?? '').toString().trim().slice(0, max);

export async function wufooState(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(STATUS_KEY).first();
  return row ? JSON.parse(row.value) : {};
}
async function saveState(env, changes) {
  const state = { ...(await wufooState(env)), ...changes };
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(STATUS_KEY, JSON.stringify(state)).run();
}

function timeZone(v) {
  const s = v.toLowerCase();
  if (/\be[sd]t\b|eastern/.test(s)) return 'EST';
  if (/\bc[sd]t\b|central/.test(s)) return 'CST';
  if (/\bm[sd]t\b|mountain|arizona/.test(s)) return 'MST';
  if (/\bp[sd]t\b|pacific/.test(s)) return 'PST';
  return null;
}

function parseJson(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

// ---- Turning a Wufoo entry into an applicant's field values ----

// Returns { data, files: [{ title, kind, name, url }], unmatched: [titles], structured }.
export function entryToData(body) {
  const get = (id) => clean(body.get(id));
  const data = {};
  const extra = {};
  const files = [];
  const unmatched = [];
  const fieldTypes = new Map(allFields('applicants').map((x) => [x.key, x.type]));
  const structure = parseJson(body.get('FieldStructure'));
  const fields = Array.isArray(structure?.Fields) ? structure.Fields : null;

  const putExtra = (title, value) => {
    if (!value) return;
    let k = clean(title, 200) || 'Answer';
    while (k in extra) k += ' (2)';
    extra[k] = value;
  };
  // An answer that goes into an app field. Returns false when it can't go there (it is then kept as an extra).
  const put = (key, value, title) => {
    if (!value) return true;
    const type = fieldTypes.get(key);
    if (type === 'bool') {
      if (/^(yes|y|true|1|checked)$/i.test(value)) { data[key] = true; return true; }
      if (/^(no|n|false|0)$/i.test(value)) return true;
      return false;
    }
    if (key === 'Time_zone') { data[key] = timeZone(value) || value; return true; }
    if (key === 'Email') {
      if (!EMAIL.test(value)) return false;
      if (data.Email) return false; // a second email question
    }
    if (data[key]) return false; // already filled by an earlier question
    data[key] = value.slice(0, type === 'textarea' ? 20000 : TEXT_MAX);
    return true;
  };

  if (fields) {
    for (const f of fields) {
      const id = String(f.ID || '');
      if (!/^Field\d+$/.test(id)) continue; // EntryId, DateCreated and other Wufoo bookkeeping
      const title = clean(f.Title, 300);
      const subs = Array.isArray(f.SubFields) ? f.SubFields : [];
      let key = BY_TITLE.get(norm(title)) || null;
      if (!key && BY_TYPE[f.Type]) key = BY_TYPE[f.Type];

      if (f.Type === 'file') {
        const url = get(`${id}-url`);
        const name = get(id);
        if (key !== 'Resume') unmatched.push(title);
        if (url) files.push({ title, kind: key === 'Resume' ? 'Resume' : '', name, url });
        continue;
      }

      // A Name field: first and last name. A plain "Full name" question is split at the first space.
      if (key === '_name') {
        if (subs.length) {
          const part = (re) => subs.filter((s) => re.test(s.Label || '')).map((s) => get(s.ID)).filter(Boolean).join(' ');
          put('Name', part(/^first/i) || get(subs[0].ID), title);
          put('Last_Name', part(/^last/i) || (subs[1] ? get(subs[1].ID) : ''), title);
        } else {
          const [first, ...rest] = get(id).split(/\s+/);
          put('Name', first, title);
          put('Last_Name', rest.join(' '), title);
        }
        continue;
      }

      // The answer as one piece of text: sub-fields (checkboxes, address parts, …) are joined.
      let value;
      let full = '';
      if (subs.length) {
        const parts = subs.map((s) => ({ label: clean(s.Label, 200), v: get(s.ID) })).filter((p) => p.v);
        if (f.Type === 'address') {
          const pick = (re) => parts.find((p) => re.test(p.label))?.v || '';
          value = [pick(/city/i), pick(/state|province|region/i)].filter(Boolean).join(', ');
          full = parts.map((p) => p.v).join(', ');
          if (!value) value = full;
        } else if (f.Type === 'checkbox') {
          value = parts.map((p) => p.v).join(', ');
        } else {
          value = parts.map((p) => (p.label && p.label !== p.v ? `${p.label}: ${p.v}` : p.v)).join('; ');
        }
      } else {
        value = get(id);
        const other = get(`${id}_other`);
        if (other && !value) value = other;
      }
      if (!key) {
        unmatched.push(title);
        putExtra(title, value);
        continue;
      }
      if (!put(key, value, title)) { unmatched.push(title); putExtra(title, value); }
      if (full && full !== value) putExtra(title, full);
    }
  } else {
    // No field names from Wufoo: every answer is kept as "Field1", "Field2", …, and file uploads are still
    // downloaded. The first answer that looks like an email address becomes the email.
    const ids = [...body.keys()].filter((k) => /^Field\d+$/.test(k)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
    for (const id of ids) {
      const value = get(id);
      const url = get(`${id}-url`);
      if (url) { files.push({ title: id, kind: '', name: value, url }); continue; }
      if (!data.Email && EMAIL.test(value)) data.Email = value;
      putExtra(id, value);
    }
  }

  if (Object.keys(extra).length) data._extra = extra;
  return { data, files, unmatched: [...new Set(unmatched)].slice(0, 50), structured: Boolean(fields) };
}

// ---- Files ----

// Downloads one uploaded file from Wufoo and saves it on the record. Returns null when saved, or the reason
// it could not be (the link is then kept in a note).
async function saveFile(env, recordId, file, now) {
  let url;
  try { url = new URL(file.url); } catch { return 'the link is not a web address'; }
  const host = url.hostname.toLowerCase();
  const allowed = (url.protocol === 'https:' && (host === 'wufoo.com' || host.endsWith('.wufoo.com')))
    || (env.WUFOO_TEST_FILE_HOST && host === env.WUFOO_TEST_FILE_HOST); // set only when testing on this computer
  if (!allowed) return 'the link is not a Wufoo file link';
  const name = (file.name || decodeURIComponent(url.pathname.split('/').pop() || '') || 'file').slice(0, 200);
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!FILE_TYPES[ext]) return `files ending in .${ext || '?'} can't be stored (allowed: ${Object.keys(FILE_TYPES).join(', ')})`;
  let res;
  try {
    res = await fetch(url.toString(), { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  } catch (err) {
    return `the download failed (${err.message.slice(0, 100)})`;
  }
  if (!res.ok) return `Wufoo answered ${res.status}`;
  // A web page instead of the file usually means Wufoo wants a login to see it.
  if (/text\/html/i.test(res.headers.get('Content-Type') || '')) { res.body?.cancel(); return 'Wufoo sent a web page instead of the file (the file may need a Wufoo login)'; }
  if (Number(res.headers.get('Content-Length') || 0) > MAX_FILE) { res.body?.cancel(); return 'the file is bigger than 15 MB'; }
  // Read it in pieces, stopping at 15 MB.
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FILE) { await reader.cancel(); return 'the file is bigger than 15 MB'; }
    chunks.push(value);
  }
  if (!size) return 'the file is empty';
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  const fileKey = `records/${recordId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await env.SOP_FILES.put(fileKey, bytes, { httpMetadata: { contentType: FILE_TYPES[ext] } });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO record_files (record_id, field, file_key, file_name, file_type, file_size, uploader, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Wufoo', ?)`).bind(recordId, file.kind, fileKey, name, FILE_TYPES[ext], size, now),
    env.DB.prepare('INSERT INTO record_history (record_id, summary, at) VALUES (?, ?, ?)').bind(recordId, `Added file ${name} (from Wufoo)`, now),
  ]);
  return null;
}

// ---- The webhook ----

export async function handleWufooWebhook(request, env) {
  let body;
  try {
    body = await request.formData();
  } catch {
    return json({ error: 'Expected a Wufoo form post.' }, 400);
  }
  const now = new Date().toISOString();
  const key = clean(body.get('HandshakeKey'), 500);
  if (!env.WUFOO_HANDSHAKE_KEY || !sameSecret(key, env.WUFOO_HANDSHAKE_KEY.trim())) {
    await saveState(env, { rejected_at: now, rejected_why: !env.WUFOO_HANDSHAKE_KEY ? 'WUFOO_HANDSHAKE_KEY is not set in Cloudflare' : key ? 'wrong Handshake Key' : 'no Handshake Key sent' });
    return json({ error: 'Wrong or missing Handshake Key.' }, 403);
  }

  const entryId = clean(body.get('EntryId'), 50);
  const form = parseJson(body.get('FormStructure'));
  const formId = clean(form?.Hash || form?.Url, 100);
  const formName = clean(form?.Name, 200);

  // The same entry sent twice (Wufoo trying again, or a resend): keep the first one.
  if (entryId) {
    const same = await env.DB.prepare(
      `SELECT id FROM records WHERE module = 'applicants' AND json_extract(data, '$._wufoo.entry') = ?
       AND (? = '' OR COALESCE(json_extract(data, '$._wufoo.form'), '') IN ('', ?)) LIMIT 1`
    ).bind(entryId, formId, formId).first();
    if (same) {
      await saveState(env, { duplicate_at: now, duplicate_entry: entryId });
      return json({ ok: true, duplicate: true, id: same.id });
    }
  }

  const { data, files, unmatched, structured } = entryToData(body);
  data.Applicant_Status = STEPS[0];
  data._wufoo = { entry: entryId || null, form: formId || null, form_name: formName || null, created: clean(body.get('DateCreated'), 40) || null };
  const name = nameOf('applicants', data);
  const email = (data.Email || '').toLowerCase() || null;
  const earlier = email
    ? await env.DB.prepare("SELECT id, name, status FROM records WHERE module = 'applicants' AND email = ? ORDER BY created_at DESC LIMIT 1").bind(email).first()
    : null;

  const row = await env.DB.prepare(
    `INSERT INTO records (module, name, status, email, search, data, created_at, updated_at)
     VALUES ('applicants', ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(name, statusOf('applicants', data), email, searchOf('applicants', data, name), JSON.stringify(data), now, now).first();
  const id = row.id;
  const appUrl = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  await env.DB.prepare('INSERT INTO record_history (record_id, summary, at) VALUES (?, ?, ?)')
    .bind(id, `Created from Wufoo${entryId ? ` (entry #${entryId}${formName ? ` of ${formName}` : ''})` : ''}`, now).run();
  const notes = [];
  const statements = [];
  if (earlier) {
    notes.push(`Applied again; earlier application: ${appUrl}/admin/applicants/${earlier.id} (${earlier.name}, ${earlier.status})`);
    statements.push(env.DB.prepare('INSERT INTO record_history (record_id, summary, at) VALUES (?, ?, ?)')
      .bind(earlier.id, `Applied again: new application ${appUrl}/admin/applicants/${id}`, now));
  }
  if (!structured) {
    notes.push('Wufoo sent no question names, so the answers are kept as Field1, Field2, … under "Other fields from Wufoo". '
      + 'To fix this, tick "Include Field and Form Structures with Entry Data" in the Wufoo WebHook settings.');
  }

  // Uploaded files (the resume), a few per entry.
  const problems = [];
  for (const file of files.slice(0, MAX_FILES)) {
    const why = await saveFile(env, id, file, now);
    if (why) problems.push(`${file.title}: ${why}`);
    if (why) notes.push(`Could not save the file "${file.name || file.title}" from Wufoo: ${why}. Link: ${file.url}`);
  }
  for (const file of files.slice(MAX_FILES)) notes.push(`File "${file.name || file.title}" from Wufoo was not downloaded (only ${MAX_FILES} per application). Link: ${file.url}`);

  for (const text of notes) {
    statements.push(env.DB.prepare('INSERT INTO record_notes (record_id, author, body, created_at) VALUES (?, ?, ?, ?)').bind(id, 'Wufoo', text.slice(0, 20000), now));
  }
  if (statements.length) await env.DB.batch(statements);
  await saveState(env, {
    last_at: now, last_entry: entryId || null, last_id: id, last_name: name, form_name: formName || null,
    structured, unmatched, file_problems: problems,
  });
  return json({ ok: true, id });
}
