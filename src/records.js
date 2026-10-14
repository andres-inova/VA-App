// Clients, client contacts, VAs and applicants (Hiring), kept in the app. Admins only. Each record has field values
// (see fields.js), notes, files and a history of changes. VA records drive VA logins, check-ins and the backup lists
// (see applyVaRecords in zoho.js). Applicants move through the hiring steps, and a hired applicant can be turned into
// a VA record. Records copied from Zoho CRM in 2026 keep their Zoho id (zoho_id) as history; nothing reads Zoho CRM.

import { redirect, page, isDate } from './util.js';
import { MODULES, allFields, formFields, nameOf, statusOf, searchOf, STEPS, CLOSED, OFFER_ITEMS } from './fields.js';
import { FILE_TYPES, MAX_FILE } from './sops.js';
import { applyVaRecords, linkProjectClients } from './zoho.js';
import { sendInvite, newTemporaryPassword } from './invites.js';
import { wufooState } from './wufoo.js';
import { applicantTrainings, linkApplicantToTraining } from './training.js';
import { recordEmails, forgetRecordEmails } from './email.js';
import { partsIn, REPORT_ZONE } from './time.js';
import { loadTags, tagsByRecord, tagsOn, forgetRecordTags, recordTagChange } from './tags.js';
import * as rv from './records-views.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- Reading ----

async function getRecord(env, key, id) {
  const r = await env.DB.prepare('SELECT * FROM records WHERE id = ? AND module = ?').bind(id, key).first();
  return r ? { ...r, data: JSON.parse(r.data) } : null;
}

// Names of records by id (for lookups and the history).
async function recordNames(env) {
  const { results } = await env.DB.prepare('SELECT id, module, name, parent_id FROM records').all();
  return new Map(results.map((r) => [r.id, r.name]));
}

// Active projects and their current VAs, by client record id (projects.client_record_id, see the Projects page).
async function projectsByClient(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name, p.client, p.client_record_id, p.is_coverage, GROUP_CONCAT(u.name, ', ') AS vas FROM projects p
     LEFT JOIN assignments a ON a.project_id = p.id LEFT JOIN users u ON u.id = a.user_id AND u.is_va = 1
     WHERE p.active = 1 AND p.client_record_id IS NOT NULL GROUP BY p.id ORDER BY p.is_coverage, p.name`
  ).all();
  const map = new Map();
  for (const p of results) {
    if (!map.has(p.client_record_id)) map.set(p.client_record_id, []);
    map.get(p.client_record_id).push(p);
  }
  return map;
}

// Each VA's login (the users row linked to the VA record by users.record_id) and active projects.
// conflict: another login that already has the record's email (so this VA can't get a login with it).
async function vaLogins(env) {
  const { results: users } = await env.DB.prepare(
    `SELECT id, name, email, zoho_id, record_id, is_va, is_admin, invited_at, last_login_at, exempt, affiliation, slack_user_id,
       must_change_password, password_hash IS NOT NULL AS has_password FROM users`
  ).all();
  const { results: projects } = await env.DB.prepare(
    `SELECT a.user_id, p.id, p.name, p.client, p.is_coverage FROM assignments a JOIN projects p ON p.id = a.project_id
     WHERE p.active = 1 ORDER BY p.is_coverage, p.client`
  ).all();
  return (r) => {
    const u = users.find((x) => x.record_id === r.id);
    const email = (r.email || '').toLowerCase();
    const conflict = !u && email ? users.find((x) => x.email.toLowerCase() === email) || null : null;
    return { user: u || null, conflict, projects: u ? projects.filter((p) => p.user_id === u.id) : [] };
  };
}

// A VA's email is how they log in, so it must not be the email of another VA record or of someone else's login
// (an admin, or another VA). Returns an error message, or null.
async function vaEmailProblem(env, data, recordId) {
  const email = (data.Email || '').trim().toLowerCase();
  if (!email) return null;
  const other = await env.DB.prepare("SELECT id, name FROM records WHERE module = 'vas' AND lower(trim(email)) = ? AND id != ?").bind(email, recordId || 0).first();
  if (other) return `Another VA record (${other.name}) already has the email ${email}. Each VA needs their own email, because they log in with it.`;
  const own = recordId ? await env.DB.prepare('SELECT id FROM users WHERE record_id = ?').bind(recordId).first() : null;
  const login = await env.DB.prepare('SELECT id, name, is_admin, record_id FROM users WHERE lower(email) = ?').bind(email).first();
  if (!login || login.id === own?.id) return null;
  if (login.is_admin) return `${email} is the login of ${login.name} (an admin). Please use a different email for this VA, because they log in with it.`;
  // A login with no VA record (for example someone in training) becomes this VA's login, unless the VA has one already.
  if (login.record_id || own) return `${email} is already the login of ${login.name}. Please use a different email for this VA, because they log in with it.`;
  return null;
}

// ---- Saving ----

// One field's value as typed in on a form (the Edit page, or one field changed on the record page): the value to
// save, or null when it is empty.
function readValue(x, field, fieldAll, old, allowed) {
  const raw = field(x.key);
  switch (x.type) {
    case 'bool': return raw === '1';
    case 'int': return raw === '' || Number.isNaN(Number(raw)) ? null : Math.round(Number(raw));
    case 'num': return raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw);
    case 'money': return raw === '' || Number.isNaN(Number(raw.replace(/[$,]/g, ''))) ? null : Number(raw.replace(/[$,]/g, ''));
    case 'date': return isDate(raw) ? raw : null;
    case 'pick': case 'owner':
      // A choice from the list, or the value it already had (for example an old value from Zoho).
      return raw && ((x.options || allowed.owners || []).includes(raw) || raw === old[x.key]) ? raw : null;
    case 'multi': return fieldAll(x.key).filter((o) => (x.options || []).includes(o) || (old[x.key] || []).includes(o));
    case 'tags': return [...new Set(raw.split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20);
    case 'lookup': { const n = Number(raw); return allowed[x.key]?.has(n) ? n : null; }
    case 'lookups': return [...new Set(fieldAll(x.key).map(Number))].filter((n) => allowed[x.key]?.has(n));
    default: return raw.slice(0, x.type === 'textarea' ? 20000 : 500) || null;
  }
}

const isBlank = (v) => v === null || v === undefined || v === false || (Array.isArray(v) && !v.length);

// What is wrong with one field's value (a bad email, a number out of range), or null.
function valueProblem(x, v) {
  if (isBlank(v)) return null;
  if (x.type === 'email' && !EMAIL.test(v)) return `"${v}" doesn't look like an email address. Please check the ${x.label.toLowerCase()}.`;
  if ((x.min !== undefined && v < x.min) || (x.max !== undefined && v > x.max)) return `${x.label.replace(/ \(.*\)/, '')} must be a number from ${x.min} to ${x.max}.`;
  return null;
}

// A record needs a name.
function nameProblem(key, data) {
  const missing = key === 'contacts' ? !data.First_Name && !data.Last_Name : key === 'applicants' ? !data.Name : !data[MODULES[key].nameKey];
  if (!missing) return null;
  return key === 'contacts' ? 'Please type a first or last name.' : key === 'applicants' ? "Please type the applicant's first name." : `Please type the ${MODULES[key].one}'s name.`;
}

// The field values typed in on the edit form. Returns { data, error }.
function readForm(key, field, fieldAll, old, allowed) {
  const data = {};
  for (const x of formFields(key)) {
    const v = readValue(x, field, fieldAll, old, allowed);
    if (!isBlank(v)) data[x.key] = v;
  }
  for (const x of formFields(key)) {
    const problem = valueProblem(x, data[x.key]);
    if (problem) return { data, error: problem };
  }
  const missing = nameProblem(key, data);
  if (missing) return { data, error: missing };
  // Values the form doesn't show stay as they were (for example "Other fields from Zoho" or "from Wufoo", or the VA
  // record made from an applicant).
  for (const [k, v] of Object.entries(old)) if (k.startsWith('_')) data[k] = v;
  // Hidden fields (Settings > Fields) are not on the form and keep their values.
  for (const x of MODULES[key].hiddenFields) if (old[x.key] !== undefined) data[x.key] = old[x.key];
  return { data };
}

// Which records each lookup field may point to (so a form can't link to anything else).
async function lookupChoices(env, key, record, only = null) {
  const choices = {};
  for (const x of formFields(key).filter((y) => (y.type === 'lookup' || y.type === 'lookups') && (!only || y.key === only))) {
    let rows;
    if (x.key === 'Contact') {
      rows = record ? (await env.DB.prepare("SELECT id, name FROM records WHERE module = 'contacts' AND parent_id = ? ORDER BY name").bind(record.id).all()).results : [];
    } else {
      rows = (await env.DB.prepare('SELECT id, name FROM records WHERE module = ? AND id != ? ORDER BY name COLLATE NOCASE').bind(x.to, record?.id || 0).all()).results;
    }
    choices[x.key] = rows;
  }
  return choices;
}

async function adminNames(env) {
  const { results } = await env.DB.prepare('SELECT name FROM users WHERE is_admin = 1 ORDER BY name').all();
  return results.map((r) => r.name);
}

function changesBetween(key, before, after) {
  const changes = [];
  for (const x of formFields(key)) {
    const a = JSON.stringify(before[x.key] ?? null);
    const b = JSON.stringify(after[x.key] ?? null);
    if (a !== b) changes.push({ f: x.key, from: before[x.key] ?? null, to: after[x.key] ?? null });
  }
  return changes;
}

// Saves a changed record (from the Edit page, or one field changed on the record page): the new values, a line in
// its history, and what follows from the change (VA logins, project links, an applicant's Onboarding Training).
// Returns { changes, linked (the applicant was linked to a training), noEmail (an Active VA with no email) }.
async function saveRecord(env, user, key, record, data, parent) {
  const changes = changesBetween(key, record.data, data);
  if (key === 'contacts' && parent !== record.parent_id) changes.push({ f: '_client', from: record.parent_id, to: parent });
  if (changes.length) {
    const now = new Date().toISOString();
    const name = nameOf(key, data);
    await env.DB.batch([
      env.DB.prepare('UPDATE records SET name = ?, status = ?, parent_id = ?, email = ?, search = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .bind(name, statusOf(key, data), parent, (data.Email || '').toLowerCase() || null, searchOf(key, data, name), JSON.stringify(data), now, user.id, record.id),
      env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, changes, at) VALUES (?, ?, ?, ?, ?)')
        .bind(record.id, user.id, 'Edited', JSON.stringify(changes), now),
    ]);
    await vaChanged(env, key);
  }
  // An applicant's email set or changed: link them to the Onboarding Training of the person with that email.
  const linked = Boolean(key === 'applicants' && changes.some((c) => c.f === 'Email') && data.Email && await linkApplicantToTraining(env, user, record.id));
  const noEmail = Boolean(key === 'vas' && changes.length && data.VA_Status === 'Active' && !data.Email);
  return { changes, linked, noEmail };
}

// One field changed on the record page (click a value to change it). Same checks and the same save as the Edit
// page; the other fields keep the values they have now. Answers with JSON: { ok, html (the new value as shown on
// the page), note } or { error }.
async function saveOneField(env, user, key, record, field, fieldAll) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const fkey = field('_f');
  let data = record.data;
  let parent = record.parent_id;
  let x = null;
  if (key === 'contacts' && fkey === '_client') {
    // A contact's client.
    const id = Number(field('parent_id')) || null;
    parent = id && await env.DB.prepare("SELECT id FROM records WHERE id = ? AND module = 'clients'").bind(id).first() ? id : null;
  } else {
    x = formFields(key).find((y) => y.key === fkey);
    if (!x) return json({ error: "This field can't be changed here. Use Edit." }, 400);
    const choices = x.type === 'lookup' || x.type === 'lookups' ? await lookupChoices(env, key, record, x.key) : {};
    const allowed = { owners: x.type === 'owner' ? await adminNames(env) : [], ...Object.fromEntries(Object.entries(choices).map(([k, rows]) => [k, new Set(rows.map((r) => r.id))])) };
    const v = readValue(x, field, fieldAll, record.data, allowed);
    const problem = valueProblem(x, v);
    if (problem) return json({ error: problem }, 400);
    data = { ...record.data };
    if (isBlank(v)) delete data[x.key]; else data[x.key] = v;
    const error = nameProblem(key, data) || (key === 'vas' ? await vaEmailProblem(env, data, record.id) : null);
    if (error) return json({ error }, 400);
  }
  const { changes, linked, noEmail } = await saveRecord(env, user, key, record, data, parent);
  const names = x && !['lookup', 'lookups'].includes(x.type) ? new Map() : await recordNames(env);
  const html = x ? rv.fieldValueHtml(x, data[x.key], names) : rv.clientValueHtml(parent, names);
  const note = linked ? INLINE_NOTES.linked : noEmail ? INLINE_NOTES.noEmail : null;
  return json({ ok: true, changed: changes.length > 0, html, note });
}

const INLINE_NOTES = {
  linked: ['good', 'Saved. This applicant is in an Onboarding Training (same email), so the two are now linked.'],
  noEmail: ['bad', "Saved. This VA is Active but has no email, so they can't log in. Add their email."],
};

// After a VA record changes, VA logins and the backup lists follow right away. After a client record is added or
// renamed, projects with no client yet that have its name are linked to it.
async function vaChanged(env, key) {
  if (key === 'vas') await applyVaRecords(env);
  if (key === 'clients') await linkProjectClients(env);
}

async function deleteRecords(env, ids) {
  if (!ids.length) return;
  // Saved emails that belonged only to these records are deleted with them.
  await forgetRecordEmails(env, ids);
  const list = JSON.stringify(ids);
  const { results: files } = await env.DB.prepare('SELECT file_key FROM record_files WHERE record_id IN (SELECT value FROM json_each(?))').bind(list).all();
  for (const f of files) await env.SOP_FILES.delete(f.file_key);
  await env.DB.batch(['record_files', 'record_notes', 'record_history'].map((t) =>
    env.DB.prepare(`DELETE FROM ${t} WHERE record_id IN (SELECT value FROM json_each(?))`).bind(list))
    .concat(
      // Trainings started from a deleted applicant stay, without the link. So do the login of a deleted VA (it loses
      // VA access) and the projects of a deleted client (they show as "No client" on the Projects page).
      env.DB.prepare('UPDATE trainings SET applicant_id = NULL WHERE applicant_id IN (SELECT value FROM json_each(?))').bind(list),
      env.DB.prepare('UPDATE users SET record_id = NULL WHERE record_id IN (SELECT value FROM json_each(?))').bind(list),
      env.DB.prepare('UPDATE projects SET client_record_id = NULL WHERE client_record_id IN (SELECT value FROM json_each(?))').bind(list),
      forgetRecordTags(env, list),
      env.DB.prepare('DELETE FROM records WHERE id IN (SELECT value FROM json_each(?))').bind(list),
    ));
}

// ---- Hiring: the buttons on an applicant's page ----

async function saveApplicant(env, user, record, data, summary, changes, now) {
  const name = nameOf('applicants', data);
  await env.DB.batch([
    env.DB.prepare('UPDATE records SET name = ?, status = ?, email = ?, search = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .bind(name, statusOf('applicants', data), (data.Email || '').toLowerCase() || null, searchOf('applicants', data, name), JSON.stringify(data), now, user.id, record.id),
    env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, changes, at) VALUES (?, ?, ?, ?, ?)')
      .bind(record.id, user.id, summary, changes.length ? JSON.stringify(changes) : null, now),
  ]);
}

// Something that happened to an applicant on the Training pages (a training started, completed or
// cancelled). Written to the applicant's history; when `to` is given and the applicant is at one of the
// steps in `from`, they also move to `to`, recorded like a step change made on their page.
// Returns true when the applicant moved.
export async function applicantEvent(env, user, applicantId, summary, to = null, from = []) {
  const record = applicantId ? await getRecord(env, 'applicants', applicantId) : null;
  if (!record) return false;
  const now = new Date().toISOString();
  if (to && to !== record.status && from.includes(record.status)) {
    await saveApplicant(env, user, record, { ...record.data, Applicant_Status: to }, `Moved to ${to} (${summary.toLowerCase()})`,
      [{ f: 'Applicant_Status', from: record.status, to }], now);
    return true;
  }
  await env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, at) VALUES (?, ?, ?, ?)').bind(record.id, user.id, summary, now).run();
  return false;
}

async function applicantAction(env, user, record, action, field, here, now) {
  const old = record.data;

  // Moving to another hiring step, or closing the applicant (Declined, with a reason, or Ghosted).
  if (action === 'step') {
    const to = field('to');
    if (![...STEPS, ...CLOSED].includes(to) || to === record.status) return redirect(here);
    const data = { ...old, Applicant_Status: to };
    if (to === 'Declined') {
      const reason = field('reason').slice(0, 500);
      if (reason) data.Declined_Reason = reason; else delete data.Declined_Reason;
    } else {
      delete data.Declined_Reason;
    }
    const changes = [{ f: 'Applicant_Status', from: record.status, to }];
    if ((old.Declined_Reason || null) !== (data.Declined_Reason || null)) changes.push({ f: 'Declined_Reason', from: old.Declined_Reason || null, to: data.Declined_Reason || null });
    await saveApplicant(env, user, record, data, `Moved to ${to}`, changes, now);
    return redirect(`${here}?msg=step-saved`);
  }

  // Ticking items on the offer checklist.
  if (action === 'checklist') {
    const data = { ...old };
    const changes = [];
    for (const [k] of OFFER_ITEMS) {
      const on = field(k) === '1';
      if (on) data[k] = true; else delete data[k];
      if (Boolean(old[k]) !== on) changes.push({ f: k, from: Boolean(old[k]), to: on });
    }
    if (!changes.length) return redirect(`${here}?msg=no-changes#offer`);
    await saveApplicant(env, user, record, data, 'Offer checklist updated', changes, now);
    return redirect(`${here}?msg=checklist-saved#offer`);
  }

  // A hired applicant becomes a VA record (On Deck), with their details and resume.
  if (action === 'hire') {
    if (old._va && (await getRecord(env, 'vas', Number(old._va)))) return redirect(`/admin/vas/${old._va}`);
    const email = (old.Email || '').toLowerCase();
    const same = email ? await env.DB.prepare("SELECT id FROM records WHERE module = 'vas' AND email = ?").bind(email).first() : null;
    let vaId = same?.id;
    if (!vaId) {
      const vaFields = new Map(allFields('vas').map((x) => [x.key, x]));
      const va = { Name: record.name, VA_Status: 'On Deck', VA_Company_Affiliation: 'InoVA Local' };
      if (old.Email) va.Email = old.Email;
      if (old.Phone) va.Phone = old.Phone;
      if (old.Location) va.Location = old.Location;
      if (vaFields.get('Time_Zone').options.includes(old.Time_zone)) va.Time_Zone = old.Time_zone;
      if (vaFields.get('Availability').options.includes(old.Availability)) va.Availability = old.Availability;
      const row = await env.DB.prepare(
        `INSERT INTO records (module, name, status, email, search, data, created_at, created_by, updated_at, updated_by)
         VALUES ('vas', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      ).bind(va.Name, statusOf('vas', va), email || null, searchOf('vas', va, va.Name), JSON.stringify(va), now, user.id, now, user.id).first();
      vaId = row.id;
      await env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, at) VALUES (?, ?, ?, ?)')
        .bind(vaId, user.id, `Created from applicant ${record.name}`, now).run();
      // A copy of each resume, so deleting it from one record doesn't remove it from the other.
      const { results: resumes } = await env.DB.prepare("SELECT * FROM record_files WHERE record_id = ? AND field = 'Resume'").bind(record.id).all();
      for (const f of resumes) {
        const object = await env.SOP_FILES.get(f.file_key);
        if (!object) continue;
        const fileKey = `records/${vaId}/${Date.now()}-${f.id}`;
        await env.SOP_FILES.put(fileKey, await object.arrayBuffer(), { httpMetadata: { contentType: f.file_type || 'application/octet-stream' } });
        await env.DB.prepare(
          `INSERT INTO record_files (record_id, field, file_key, file_name, file_type, file_size, uploaded_by, uploader, uploaded_at)
           VALUES (?, 'Resume', ?, ?, ?, ?, ?, ?, ?)`
        ).bind(vaId, fileKey, f.file_name, f.file_type, f.file_size, user.id, user.name, now).run();
      }
      await vaChanged(env, 'vas');
    }
    const data = { ...old, _va: vaId, Applicant_Status: 'Hired' };
    const changes = record.status === 'Hired' ? [] : [{ f: 'Applicant_Status', from: record.status, to: 'Hired' }];
    await saveApplicant(env, user, record, data, same ? 'Linked to the VA record with the same email' : 'Made a VA record (On Deck)', changes, now);
    return redirect(`${here}?msg=${same ? 'va-linked' : 'va-made'}`);
  }

  return redirect(here);
}

// A record's page. tempPassword: the result of a login invite or temporary password sent from a VA's Login box
// (shown once, never put in the address).
async function showRecord(env, user, key, record, message, tempPassword = null) {
  const names = await recordNames(env);
  const [{ results: notes }, { results: files }, { results: history }] = await Promise.all([
    env.DB.prepare('SELECT n.*, u.name AS user_name FROM record_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.record_id = ? ORDER BY n.created_at DESC').bind(record.id).all(),
    env.DB.prepare('SELECT f.*, u.name AS user_name FROM record_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.record_id = ? ORDER BY f.uploaded_at DESC').bind(record.id).all(),
    env.DB.prepare('SELECT h.*, u.name AS user_name FROM record_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.record_id = ? ORDER BY h.at DESC, h.id DESC LIMIT 100').bind(record.id).all(),
  ]);
  const extra = { contacts: [], projects: [], parent: null, referredHere: [], login: null, va: null, training: null, mail: null, tags: null };
  // Tags (VAs, applicants and clients): this record's, and all of them for the picker.
  if (key !== 'contacts') {
    const all = await loadTags(env);
    const ids = (await env.DB.prepare('SELECT tag_id FROM record_tags WHERE record_id = ?').bind(record.id).all().catch(() => ({ results: [] }))).results.map((r) => r.tag_id);
    extra.tags = { all, on: tagsOn(all, ids), ids: new Set(ids) };
  }
  // The choices for changing a value right on the page (the same lists as on the Edit page).
  extra.edit = {
    choices: await lookupChoices(env, key, record),
    owners: await adminNames(env),
    clients: key === 'contacts' ? (await env.DB.prepare("SELECT id, name FROM records WHERE module = 'clients' ORDER BY name COLLATE NOCASE").all()).results : [],
  };
  if (key === 'applicants' && record.data._va) extra.va = await getRecord(env, 'vas', Number(record.data._va));
  if (key === 'applicants') {
    // The trainings started from this applicant's page, and who can be their trainer.
    extra.training = await applicantTrainings(env, record.id);
    extra.training.trainers = (await env.DB.prepare('SELECT id, name, email, is_va FROM users WHERE is_va = 1 OR is_admin = 1 ORDER BY name').all()).results;
    extra.training.today = partsIn(REPORT_ZONE).date;
  }
  if (key === 'clients') {
    extra.contacts = (await env.DB.prepare("SELECT * FROM records WHERE module = 'contacts' AND parent_id = ? ORDER BY status, name").bind(record.id).all()).results
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
    extra.projects = (await projectsByClient(env)).get(record.id) || [];
  }
  // Saved emails (see email.js). A client's page also shows its contacts' emails.
  if (key !== 'applicants') extra.mail = await recordEmails(env, user, [record.id, ...extra.contacts.map((c) => c.id)]);
  if (key === 'contacts' && record.parent_id) extra.parent = await getRecord(env, 'clients', record.parent_id);
  if (key === 'vas') extra.login = (await vaLogins(env))(record);
  // "Clients referred" / "VAs referred": records that list this one under "Referred by".
  const refField = allFields(key).find((x) => x.type === 'lookups');
  if (refField) {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.name FROM records r, json_each(r.data, '$.${refField.key}') j WHERE r.module = ? AND j.value = ? ORDER BY r.name`
    ).bind(key, record.id).all();
    extra.referredHere = results;
  }
  return page(rv.recordPage({ user, key, record, names, notes, files, history, ...extra, message, tempPassword }));
}

// The Login box on a VA's page: the same login buttons as on the People page, for the login linked to this record.
async function vaLoginAction(env, user, recordId, what, field) {
  const record = await getRecord(env, 'vas', recordId);
  if (!record) return redirect('/admin/vas');
  const here = `/admin/vas/${record.id}`;
  const person = await env.DB.prepare('SELECT * FROM users WHERE record_id = ?').bind(record.id).first();
  if (!person) return redirect(`${here}#login`);
  if (what === 'exempt') {
    if (person.is_va) await env.DB.prepare('UPDATE users SET exempt = ? WHERE id = ?').bind(field('exempt') === '1' ? 1 : 0, person.id).run();
    return redirect(`${here}?msg=saved#login`);
  }
  // Only people who can log in (Active VAs and admins) get an invite or a temporary password.
  if (!person.is_va && !person.is_admin) return redirect(`${here}#login`);
  if (what === 'invite') {
    const sent = await sendInvite(env, person);
    if (person.id === user.id) return redirect('/login');
    return showRecord(env, user, 'vas', record, null, { name: person.name, password: sent.password, emailed: sent.emailed, slacked: sent.slacked, email: person.email });
  }
  const password = await newTemporaryPassword(env, person);
  if (person.id === user.id) return redirect('/login');
  return showRecord(env, user, 'vas', record, null, { name: person.name, password });
}

// ---- Pages and actions ----

export async function recordRoutes(env, user, path, method, field, fieldAll, form, message, url) {
  let m;

  if (path === '/admin/applicants' && method === 'GET') {
    const { results } = await env.DB.prepare("SELECT * FROM records WHERE module = 'applicants' ORDER BY created_at DESC").all();
    const tagIds = await tagsByRecord(env, 'applicants');
    const records = results.map((r) => ({ ...r, data: JSON.parse(r.data), tagIds: tagIds.get(r.id) || [] }));
    const wufoo = { ...(await wufooState(env)), url: `${url.origin}/api/wufoo/application`, keySet: Boolean(env.WUFOO_HANDSHAKE_KEY) };
    return page(rv.applicantsPage({ user, records, wufoo, tags: await loadTags(env), message }));
  }

  if ((m = path.match(/^\/admin\/(clients|vas)$/)) && method === 'GET') {
    const key = m[1];
    const { results } = await env.DB.prepare('SELECT * FROM records WHERE module = ? ORDER BY name COLLATE NOCASE').bind(key).all();
    const tagIds = await tagsByRecord(env, key);
    const records = results.map((r) => ({ ...r, data: JSON.parse(r.data), tagIds: tagIds.get(r.id) || [] }));
    const tags = await loadTags(env);
    if (key === 'clients') {
      const names = await recordNames(env);
      const projects = await projectsByClient(env);
      return page(rv.clientsPage({ user, records, names, projects, tags, message }));
    }
    const login = await vaLogins(env);
    return page(rv.vasPage({ user, records: records.map((r) => ({ ...r, ...login(r) })), tags, message }));
  }

  // A new record: the empty form, then saving it.
  if ((m = path.match(/^\/admin\/(clients|vas|contacts|applicants)\/new$/))) {
    const key = m[1];
    const parentId = Number(url.searchParams.get('client') || field('parent_id')) || null;
    const clients = key === 'contacts' ? (await env.DB.prepare("SELECT id, name FROM records WHERE module = 'clients' ORDER BY name COLLATE NOCASE").all()).results : [];
    const choices = await lookupChoices(env, key, null);
    const owners = await adminNames(env);
    const starts = { clients: { Status: 'Current' }, vas: { VA_Status: 'Active', VA_Company_Affiliation: 'InoVA Local' }, applicants: { Applicant_Status: STEPS[0] } };
    const blank = { id: null, module: key, data: starts[key] || {}, parent_id: parentId };
    if (method === 'GET') return page(rv.editPage({ user, key, record: blank, choices, owners, clients, message }));
    if (method !== 'POST') return redirect(`/admin/${key}/new`);
    const allowed = { owners, ...Object.fromEntries(Object.entries(choices).map(([k, rows]) => [k, new Set(rows.map((r) => r.id))])) };
    const read = readForm(key, field, fieldAll, {}, allowed);
    const { data } = read;
    const error = read.error || (key === 'vas' ? await vaEmailProblem(env, data, null) : null);
    const parent = key === 'contacts' && clients.some((c) => c.id === parentId) ? parentId : null;
    if (error) return page(rv.editPage({ user, key, record: { ...blank, data, parent_id: parent }, choices, owners, clients, error }), 400);
    const name = nameOf(key, data);
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `INSERT INTO records (module, name, status, parent_id, email, search, data, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(key, name, statusOf(key, data), parent, (data.Email || '').toLowerCase() || null, searchOf(key, data, name), JSON.stringify(data), now, user.id, now, user.id).first();
    await env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, at) VALUES (?, ?, ?, ?)').bind(row.id, user.id, 'Created', now).run();
    await vaChanged(env, key);
    // An applicant whose email matches someone already in an Onboarding Training gets linked to it.
    const linked = key === 'applicants' && data.Email && await linkApplicantToTraining(env, user, row.id);
    const noEmail = key === 'vas' && data.VA_Status === 'Active' && !data.Email;
    return redirect(`/admin/${key}/${row.id}?msg=${linked ? 'record-created-training-linked' : noEmail ? 'record-created-no-email' : 'record-created'}`);
  }

  if ((m = path.match(/^\/admin\/vas\/(\d+)\/login\/(invite|temp-password|exempt)$/)) && method === 'POST') {
    return vaLoginAction(env, user, Number(m[1]), m[2], field);
  }

  m = path.match(/^\/admin\/(clients|vas|contacts|applicants)\/(\d+)(?:\/(edit|field|tags|delete|notes|files|step|checklist|hire)(?:\/(\d+)(?:\/(save|delete))?)?)?$/);
  if (!m) return redirect(path.startsWith('/admin/applicants') ? '/admin/applicants' : '/admin/clients');
  const [, key, idText, action, subId, subAction] = m;
  const record = await getRecord(env, key, Number(idText));
  if (!record) return redirect(key === 'contacts' ? '/admin/clients' : `/admin/${key}`);
  const here = `/admin/${key}/${record.id}`;
  const now = new Date().toISOString();

  if (key === 'applicants' && method === 'POST' && ['step', 'checklist', 'hire'].includes(action)) {
    return applicantAction(env, user, record, action, field, here, now);
  }

  if (!action && method === 'GET') return showRecord(env, user, key, record, message);

  if (action === 'edit') {
    const clients = key === 'contacts' ? (await env.DB.prepare("SELECT id, name FROM records WHERE module = 'clients' ORDER BY name COLLATE NOCASE").all()).results : [];
    const choices = await lookupChoices(env, key, record);
    const owners = await adminNames(env);
    if (method === 'GET') return page(rv.editPage({ user, key, record, choices, owners, clients, message }));
    const allowed = { owners, ...Object.fromEntries(Object.entries(choices).map(([k, rows]) => [k, new Set(rows.map((r) => r.id))])) };
    const read = readForm(key, field, fieldAll, record.data, allowed);
    const { data } = read;
    const error = read.error || (key === 'vas' ? await vaEmailProblem(env, data, record.id) : null);
    const parentId = Number(field('parent_id')) || null;
    const parent = key === 'contacts' ? (clients.some((c) => c.id === parentId) ? parentId : null) : record.parent_id;
    if (error) return page(rv.editPage({ user, key, record: { ...record, data, parent_id: parent }, choices, owners, clients, error }), 400);
    const { changes, linked, noEmail } = await saveRecord(env, user, key, record, data, parent);
    return redirect(`${here}?msg=${linked ? 'saved-training-linked' : noEmail ? 'saved-no-email' : changes.length ? 'saved' : 'no-changes'}`);
  }

  // One field changed on the record page.
  if (action === 'field' && method === 'POST') return saveOneField(env, user, key, record, field, fieldAll);

  // A tag ticked, unticked or made in the tag picker on the record page.
  if (action === 'tags' && method === 'POST') return recordTagChange(env, user, key, record, field);

  if (action === 'delete' && !subId && method === 'POST') {
    const ids = [record.id];
    if (key === 'clients') {
      const { results } = await env.DB.prepare("SELECT id FROM records WHERE module = 'contacts' AND parent_id = ?").bind(record.id).all();
      ids.push(...results.map((r) => r.id));
    }
    await deleteRecords(env, ids);
    await vaChanged(env, key);
    const back = key === 'contacts' && record.parent_id ? `/admin/clients/${record.parent_id}` : key === 'contacts' ? '/admin/clients' : `/admin/${key}`;
    return redirect(`${back}?msg=record-deleted`);
  }

  // Notes: anyone adds; the writer (or anyone, for notes copied from Zoho) changes or removes.
  if (action === 'notes' && method === 'POST') {
    if (!subId) {
      const body = field('body').slice(0, 20000);
      if (!body) return redirect(`${here}?msg=note-empty#notes`);
      await env.DB.prepare('INSERT INTO record_notes (record_id, user_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(record.id, user.id, user.name, body, now).run();
      return redirect(`${here}?msg=note-added#notes`);
    }
    const note = await env.DB.prepare('SELECT * FROM record_notes WHERE id = ? AND record_id = ?').bind(Number(subId), record.id).first();
    if (!note || (note.user_id && note.user_id !== user.id)) return redirect(`${here}#notes`);
    if (subAction === 'delete') {
      await env.DB.prepare('DELETE FROM record_notes WHERE id = ?').bind(note.id).run();
      return redirect(`${here}?msg=note-deleted#notes`);
    }
    const body = field('body').slice(0, 20000);
    if (!body) return redirect(`${here}?msg=note-empty#notes`);
    await env.DB.prepare('UPDATE record_notes SET body = ?, updated_at = ? WHERE id = ?').bind(body, now, note.id).run();
    return redirect(`${here}?msg=note-saved#notes`);
  }

  if (action === 'files') {
    if (!subId && method === 'POST') {
      const file = form?.get('file');
      if (!file || typeof file === 'string' || !file.size) return redirect(`${here}?msg=sop-no-file#files`);
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!FILE_TYPES[ext]) return redirect(`${here}?msg=sop-file-type#files`);
      if (file.size > MAX_FILE) return redirect(`${here}?msg=sop-file-big#files`);
      const kind = allFields(key).some((x) => x.type === 'file' && x.key === field('kind')) ? field('kind') : '';
      const fileKey = `records/${record.id}/${Date.now()}.${ext}`;
      await env.SOP_FILES.put(fileKey, file.stream(), { httpMetadata: { contentType: FILE_TYPES[ext] } });
      await env.DB.batch([
        env.DB.prepare('INSERT INTO record_files (record_id, field, file_key, file_name, file_type, file_size, uploaded_by, uploader, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(record.id, kind, fileKey, file.name.slice(0, 200), FILE_TYPES[ext], file.size, user.id, user.name, now),
        env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, at) VALUES (?, ?, ?, ?)')
          .bind(record.id, user.id, `Added file ${file.name.slice(0, 200)}`, now),
      ]);
      return redirect(`${here}?msg=file-uploaded#files`);
    }
    const file = subId ? await env.DB.prepare('SELECT * FROM record_files WHERE id = ? AND record_id = ?').bind(Number(subId), record.id).first() : null;
    if (!file) return redirect(`${here}#files`);
    if (subAction === 'delete' && method === 'POST') {
      await env.SOP_FILES.delete(file.file_key);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM record_files WHERE id = ?').bind(file.id),
        env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, at) VALUES (?, ?, ?, ?)')
          .bind(record.id, user.id, `Removed file ${file.file_name}`, now),
      ]);
      return redirect(`${here}?msg=removed#files`);
    }
    if (!subAction && method === 'GET') {
      const object = await env.SOP_FILES.get(file.file_key);
      if (!object) return redirect(`${here}?msg=sop-file-missing#files`);
      const type = file.file_type || 'application/octet-stream';
      const inline = /^(application\/pdf|image\/(png|jpe?g|gif|webp))/.test(type);
      return new Response(object.body, {
        headers: {
          'Content-Type': inline ? type : 'application/octet-stream',
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.file_name.replace(/[^\w .()-]/g, '_')}"`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': 'sandbox',
          'Cache-Control': 'private, no-store',
        },
      });
    }
  }

  return redirect(here);
}
