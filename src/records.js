// Clients, client contacts, VAs and applicants (Hiring), kept in the app (this replaces Zoho CRM for them).
// Admins only. Each record has field values (see fields.js), notes, files and a history of changes.
// VA records drive VA logins and check-ins once an admin switches over from Zoho (see "switch" below).
// Applicants move through the hiring steps, and a hired applicant can be turned into a VA record.

import { redirect, page, isDate } from './util.js';
import { MODULES, allFields, formFields, nameOf, statusOf, searchOf, STEPS, CLOSED, OFFER_ITEMS } from './fields.js';
import { FILE_TYPES, MAX_FILE } from './sops.js';
import { vaSource, applyVaRecords } from './zoho.js';
import { importState, startImport } from './import.js';
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

// The id VA records are known by elsewhere in the app (users.zoho_id, backups): their Zoho id, or "app-<id>".
export const vaKey = (r) => r.zoho_id || `app-${r.id}`;

// Active projects and their VAs, by client name (lowercase).
async function projectsByClient(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name, p.client, p.is_coverage, GROUP_CONCAT(u.name, ', ') AS vas FROM projects p
     LEFT JOIN assignments a ON a.project_id = p.id LEFT JOIN users u ON u.id = a.user_id
     WHERE p.active = 1 GROUP BY p.id ORDER BY p.is_coverage, p.name`
  ).all();
  const map = new Map();
  for (const p of results) {
    const k = p.client.trim().toLowerCase();
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  return map;
}

// Each VA's login (users row, matched by Zoho id or email) and active projects.
async function vaLogins(env) {
  const { results: users } = await env.DB.prepare('SELECT id, name, email, zoho_id, is_va, invited_at, password_hash IS NOT NULL AS has_password FROM users').all();
  const { results: projects } = await env.DB.prepare(
    `SELECT a.user_id, p.id, p.name, p.client, p.is_coverage FROM assignments a JOIN projects p ON p.id = a.project_id
     WHERE p.active = 1 ORDER BY p.is_coverage, p.client`
  ).all();
  return (r) => {
    const u = users.find((x) => x.zoho_id && x.zoho_id === vaKey(r)) || users.find((x) => r.email && x.email === r.email);
    return { user: u || null, projects: u ? projects.filter((p) => p.user_id === u.id) : [] };
  };
}

// ---- Saving ----

// The field values typed in on the edit form. Returns { data, error }.
function readForm(key, field, fieldAll, old, allowed) {
  const data = {};
  for (const x of formFields(key)) {
    const raw = field(x.key);
    let v = null;
    switch (x.type) {
      case 'bool': v = raw === '1'; break;
      case 'int': v = raw === '' || Number.isNaN(Number(raw)) ? null : Math.round(Number(raw)); break;
      case 'num': v = raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw); break;
      case 'money': v = raw === '' || Number.isNaN(Number(raw.replace(/[$,]/g, ''))) ? null : Number(raw.replace(/[$,]/g, '')); break;
      case 'date': v = isDate(raw) ? raw : null; break;
      case 'pick': case 'owner':
        // A choice from the list, or the value it already had (for example an old value from Zoho).
        v = raw && ((x.options || allowed.owners || []).includes(raw) || raw === old[x.key]) ? raw : null; break;
      case 'multi': v = fieldAll(x.key).filter((o) => (x.options || []).includes(o) || (old[x.key] || []).includes(o)); break;
      case 'tags': v = [...new Set(raw.split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20); break;
      case 'lookup': { const n = Number(raw); v = allowed[x.key]?.has(n) ? n : null; break; }
      case 'lookups': v = [...new Set(fieldAll(x.key).map(Number))].filter((n) => allowed[x.key]?.has(n)); break;
      default: v = raw.slice(0, x.type === 'textarea' ? 20000 : 500) || null;
    }
    if (v === null || v === false || (Array.isArray(v) && !v.length)) continue;
    data[x.key] = v;
  }
  for (const x of formFields(key).filter((y) => y.type === 'email')) {
    if (data[x.key] && !EMAIL.test(data[x.key])) return { data, error: `"${data[x.key]}" doesn't look like an email address. Please check the ${x.label.toLowerCase()}.` };
  }
  for (const x of formFields(key).filter((y) => y.min !== undefined || y.max !== undefined)) {
    const v = data[x.key];
    if (v !== undefined && ((x.min !== undefined && v < x.min) || (x.max !== undefined && v > x.max))) {
      return { data, error: `${x.label.replace(/ \(.*\)/, '')} must be a number from ${x.min} to ${x.max}.` };
    }
  }
  const nameMissing = key === 'contacts' ? !data.First_Name && !data.Last_Name : key === 'applicants' ? !data.Name : !data[MODULES[key].nameKey];
  if (nameMissing) return { data, error: key === 'contacts' ? 'Please type a first or last name.' : key === 'applicants' ? "Please type the applicant's first name." : `Please type the ${MODULES[key].one}'s name.` };
  // Values the form doesn't show stay as they were (for example "Other fields from Zoho", or the VA record
  // made from an applicant).
  for (const [k, v] of Object.entries(old)) if (k.startsWith('_')) data[k] = v;
  return { data };
}

// Which records each lookup field may point to (so a form can't link to anything else).
async function lookupChoices(env, key, record) {
  const choices = {};
  for (const x of formFields(key).filter((y) => y.type === 'lookup' || y.type === 'lookups')) {
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

// After a VA record changes: once the app is the source of VA details, logins and backups follow right away.
async function vaChanged(env, key) {
  if (key === 'vas' && (await vaSource(env)) === 'app') await applyVaRecords(env);
}

async function deleteRecords(env, ids) {
  if (!ids.length) return;
  const list = JSON.stringify(ids);
  const { results: files } = await env.DB.prepare('SELECT file_key FROM record_files WHERE record_id IN (SELECT value FROM json_each(?))').bind(list).all();
  for (const f of files) await env.SOP_FILES.delete(f.file_key);
  await env.DB.batch(['record_files', 'record_notes', 'record_history'].map((t) =>
    env.DB.prepare(`DELETE FROM ${t} WHERE record_id IN (SELECT value FROM json_each(?))`).bind(list))
    .concat(env.DB.prepare('DELETE FROM records WHERE id IN (SELECT value FROM json_each(?))').bind(list)));
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

// ---- Pages and actions ----

export async function recordRoutes(env, user, path, method, field, fieldAll, form, message, url) {
  let m;

  // The copy from Zoho, and switching VA details over to the app.
  if (path === '/admin/records/import') {
    if (method === 'POST') {
      if (!env.ZOHO_REFRESH_TOKEN) return redirect('/admin/records/import?msg=import-no-zoho');
      await startImport(env, user);
      return redirect('/admin/records/import');
    }
    const counts = await env.DB.prepare(
      "SELECT SUM(module = 'clients') AS clients, SUM(module = 'contacts') AS contacts, SUM(module = 'vas') AS vas FROM records"
    ).first();
    return page(rv.importPage({ user, state: await importState(env), counts, source: await vaSource(env), message }));
  }
  if (path === '/admin/records/switch' && method === 'POST') {
    if (field('to') === 'zoho') {
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('va_source', 'zoho')").run();
      return redirect('/admin/records/import?msg=switched-zoho');
    }
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE module = 'vas' AND status = 'Active'").first();
    if (!n?.n) return redirect('/admin/records/import?msg=switch-not-ready');
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('va_source', 'app')").run();
    await applyVaRecords(env);
    return redirect('/admin/records/import?msg=switched');
  }

  // The copy of applicants from Zoho (separate from clients, contacts and VAs).
  if (path === '/admin/applicants/import') {
    if (method === 'POST') {
      if (!env.ZOHO_REFRESH_TOKEN) return redirect('/admin/applicants/import?msg=import-no-zoho');
      await startImport(env, user, 'applicants');
      return redirect('/admin/applicants/import');
    }
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE module = 'applicants'").first();
    return page(rv.applicantImportPage({ user, state: await importState(env, 'applicants'), count: n?.n || 0, message }));
  }

  if (path === '/admin/applicants' && method === 'GET') {
    const { results } = await env.DB.prepare("SELECT * FROM records WHERE module = 'applicants' ORDER BY created_at DESC").all();
    const records = results.map((r) => ({ ...r, data: JSON.parse(r.data) }));
    return page(rv.applicantsPage({ user, records, imported: await importState(env, 'applicants'), message }));
  }

  if ((m = path.match(/^\/admin\/(clients|vas)$/)) && method === 'GET') {
    const key = m[1];
    const { results } = await env.DB.prepare('SELECT * FROM records WHERE module = ? ORDER BY name COLLATE NOCASE').bind(key).all();
    const records = results.map((r) => ({ ...r, data: JSON.parse(r.data) }));
    const source = await vaSource(env);
    if (key === 'clients') {
      const names = await recordNames(env);
      const projects = await projectsByClient(env);
      return page(rv.clientsPage({ user, records, names, projects, imported: await importState(env), message }));
    }
    const login = await vaLogins(env);
    return page(rv.vasPage({ user, records: records.map((r) => ({ ...r, ...login(r) })), source, imported: await importState(env), message }));
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
    const { data, error } = readForm(key, field, fieldAll, {}, allowed);
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
    return redirect(`/admin/${key}/${row.id}?msg=record-created`);
  }

  m = path.match(/^\/admin\/(clients|vas|contacts|applicants)\/(\d+)(?:\/(edit|delete|notes|files|step|checklist|hire)(?:\/(\d+)(?:\/(save|delete))?)?)?$/);
  if (!m) return redirect(path.startsWith('/admin/applicants') ? '/admin/applicants' : '/admin/clients');
  const [, key, idText, action, subId, subAction] = m;
  const record = await getRecord(env, key, Number(idText));
  if (!record) return redirect(key === 'contacts' ? '/admin/clients' : `/admin/${key}`);
  const here = `/admin/${key}/${record.id}`;
  const now = new Date().toISOString();

  if (key === 'applicants' && method === 'POST' && ['step', 'checklist', 'hire'].includes(action)) {
    return applicantAction(env, user, record, action, field, here, now);
  }

  if (!action && method === 'GET') {
    const names = await recordNames(env);
    const [{ results: notes }, { results: files }, { results: history }] = await Promise.all([
      env.DB.prepare('SELECT n.*, u.name AS user_name FROM record_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.record_id = ? ORDER BY n.created_at DESC').bind(record.id).all(),
      env.DB.prepare('SELECT f.*, u.name AS user_name FROM record_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.record_id = ? ORDER BY f.uploaded_at DESC').bind(record.id).all(),
      env.DB.prepare('SELECT h.*, u.name AS user_name FROM record_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.record_id = ? ORDER BY h.at DESC, h.id DESC LIMIT 100').bind(record.id).all(),
    ]);
    const extra = { contacts: [], projects: [], parent: null, referredHere: [], login: null, va: null };
    if (key === 'applicants' && record.data._va) extra.va = await getRecord(env, 'vas', Number(record.data._va));
    if (key === 'clients') {
      extra.contacts = (await env.DB.prepare("SELECT * FROM records WHERE module = 'contacts' AND parent_id = ? ORDER BY status, name").bind(record.id).all()).results
        .map((r) => ({ ...r, data: JSON.parse(r.data) }));
      extra.projects = (await projectsByClient(env)).get(record.name.trim().toLowerCase()) || [];
    }
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
    return page(rv.recordPage({ user, key, record, names, notes, files, history, ...extra, source: await vaSource(env), zohoOrg: env.ZOHO_CRM_ORG, message }));
  }

  if (action === 'edit') {
    const clients = key === 'contacts' ? (await env.DB.prepare("SELECT id, name FROM records WHERE module = 'clients' ORDER BY name COLLATE NOCASE").all()).results : [];
    const choices = await lookupChoices(env, key, record);
    const owners = await adminNames(env);
    if (method === 'GET') return page(rv.editPage({ user, key, record, choices, owners, clients, message }));
    const allowed = { owners, ...Object.fromEntries(Object.entries(choices).map(([k, rows]) => [k, new Set(rows.map((r) => r.id))])) };
    const { data, error } = readForm(key, field, fieldAll, record.data, allowed);
    const parentId = Number(field('parent_id')) || null;
    const parent = key === 'contacts' ? (clients.some((c) => c.id === parentId) ? parentId : null) : record.parent_id;
    if (error) return page(rv.editPage({ user, key, record: { ...record, data, parent_id: parent }, choices, owners, clients, error }), 400);
    const changes = changesBetween(key, record.data, data);
    if (key === 'contacts' && parent !== record.parent_id) changes.push({ f: '_client', from: record.parent_id, to: parent });
    if (changes.length) {
      const name = nameOf(key, data);
      await env.DB.batch([
        env.DB.prepare('UPDATE records SET name = ?, status = ?, parent_id = ?, email = ?, search = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ?')
          .bind(name, statusOf(key, data), parent, (data.Email || '').toLowerCase() || null, searchOf(key, data, name), JSON.stringify(data), now, user.id, record.id),
        env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, changes, at) VALUES (?, ?, ?, ?, ?)')
          .bind(record.id, user.id, 'Edited', JSON.stringify(changes), now),
      ]);
      await vaChanged(env, key);
    }
    return redirect(`${here}?msg=${changes.length ? 'saved' : 'no-changes'}`);
  }

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
