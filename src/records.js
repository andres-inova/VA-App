// Clients, client contacts and VAs, kept in the app (this replaces Zoho CRM for them). Admins only.
// Each record has field values (see fields.js), notes, files and a history of changes.
// VA records drive VA logins and check-ins once an admin switches over from Zoho (see "switch" below).

import { redirect, page, isDate } from './util.js';
import { MODULES, allFields, formFields, nameOf, statusOf, searchOf } from './fields.js';
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
  const nameMissing = key === 'contacts' ? !data.First_Name && !data.Last_Name : !data[MODULES[key].nameKey];
  if (nameMissing) return { data, error: key === 'contacts' ? 'Please type a first or last name.' : `Please type the ${MODULES[key].one}'s name.` };
  // Fields the form doesn't show stay as they were (for example "Other fields from Zoho").
  if (old._extra) data._extra = old._extra;
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
  if ((m = path.match(/^\/admin\/(clients|vas|contacts)\/new$/))) {
    const key = m[1];
    const parentId = Number(url.searchParams.get('client') || field('parent_id')) || null;
    const clients = key === 'contacts' ? (await env.DB.prepare("SELECT id, name FROM records WHERE module = 'clients' ORDER BY name COLLATE NOCASE").all()).results : [];
    const choices = await lookupChoices(env, key, null);
    const owners = await adminNames(env);
    const blank = { id: null, module: key, data: key === 'clients' ? { Status: 'Current' } : key === 'vas' ? { VA_Status: 'Active', VA_Company_Affiliation: 'InoVA Local' } : {}, parent_id: parentId };
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

  m = path.match(/^\/admin\/(clients|vas|contacts)\/(\d+)(?:\/(edit|delete|notes|files)(?:\/(\d+)(?:\/(save|delete))?)?)?$/);
  if (!m) return redirect('/admin/clients');
  const [, key, idText, action, subId, subAction] = m;
  const record = await getRecord(env, key, Number(idText));
  if (!record) return redirect(key === 'contacts' ? '/admin/clients' : `/admin/${key}`);
  const here = `/admin/${key}/${record.id}`;
  const now = new Date().toISOString();

  if (!action && method === 'GET') {
    const names = await recordNames(env);
    const [{ results: notes }, { results: files }, { results: history }] = await Promise.all([
      env.DB.prepare('SELECT n.*, u.name AS user_name FROM record_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.record_id = ? ORDER BY n.created_at DESC').bind(record.id).all(),
      env.DB.prepare('SELECT f.*, u.name AS user_name FROM record_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.record_id = ? ORDER BY f.uploaded_at DESC').bind(record.id).all(),
      env.DB.prepare('SELECT h.*, u.name AS user_name FROM record_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.record_id = ? ORDER BY h.at DESC, h.id DESC LIMIT 100').bind(record.id).all(),
    ]);
    const extra = { contacts: [], projects: [], parent: null, referredHere: [], login: null };
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
