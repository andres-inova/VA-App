// VA applicant information from Zoho CRM, for admins (read-only). Applicants come from the Applicants module;
// Zoho stays the place to change them (they will move to a Hiring area in the app later). The list uses a small
// copy (name, status, contact details): every hour the app copies the records that changed, and once a day
// everything (which also removes records deleted in Zoho). Opening an applicant reads every field straight
// from Zoho, shown in the same sections and order as in Zoho. (Clients and VAs are kept in the app: records.js.)

import { accessToken } from './zoho.js';
import { redirect, page } from './util.js';
import * as views from './views.js';

export const MODULES = {
  applicants: {
    zoho: 'Applicants', tab: 'CustomModule3', label: 'Applicants',
    nameOf: (r) => [r.Name, r.Last_Name].filter(Boolean).join(' ') || 'No name',
    statusOf: (r) => r.Applicant_Status || 'No status',
    searchOf: (r) => [r.Name, r.Last_Name, r.Email, r.Phone, r.Location, r.Applicant_Status],
    fields: ['Name', 'Last_Name', 'Applicant_Status', 'Email', 'Phone', 'Location', 'Time_zone', 'Created_Time'],
  },
};

// Applicant statuses that mean the applicant is no longer moving through hiring.
export const CLOSED_STATUSES = ['Rejected', 'Ghosted by applicant', 'Hired/Archived'];

// Zoho's own bookkeeping fields, not shown.
const HIDDEN = new Set(['id', 'Record_Status__s', 'Locked__s', 'Unsubscribed_Mode', 'Unsubscribed_Time', 'Enrich_Status__s',
  'Last_Enriched_Time__s', 'Change_Log_Time__s', 'Record_Image']);

const FULL_EVERY_HOURS = 20;
const authHeader = (token) => ({ Authorization: `Zoho-oauthtoken ${token}` });

// The module's sections and fields, in Zoho's layout order: [{ title, fields: [{ api, label, type }] }],
// plus the order of the picklist used as the status (so applicant statuses follow the hiring steps).
async function fetchLayout(env, token, mod) {
  const res = await fetch(`${env.ZOHO_API_URL}/crm/v8/settings/layouts?module=${mod.zoho}`, { headers: authHeader(token) });
  if (!res.ok) throw new Error(`Zoho layout for ${mod.zoho}: ${res.status} ${await res.text()}`);
  const layouts = (await res.json()).layouts || [];
  const layout = layouts.find((l) => l.status === 'active') || layouts[0];
  if (!layout) throw new Error(`Zoho layout for ${mod.zoho}: none found`);
  let statusOrder = [];
  const sections = [];
  for (const s of layout.sections || []) {
    const fields = [];
    for (const f of s.fields || []) {
      if (f.api_name === 'Applicant_Status') statusOrder = (f.pick_list_values || []).map((p) => p.display_value).filter((v) => v && v !== '-None-');
      if (HIDDEN.has(f.api_name)) continue;
      fields.push({ api: f.api_name, label: f.display_label || f.field_label || f.api_name, type: f.data_type });
    }
    if (fields.length) sections.push({ title: s.display_label || s.name || '', fields });
  }
  return { sections, statusOrder };
}

// Every record (or only those changed since `since`), with the module's list fields.
async function fetchRecords(env, token, mod, since) {
  const records = [];
  let pageToken = null;
  for (let pageNo = 1; pageNo <= 100; pageNo++) {
    const params = new URLSearchParams({ fields: mod.fields.join(','), per_page: '200', sort_by: 'id', sort_order: 'asc' });
    if (pageToken) params.set('page_token', pageToken);
    else params.set('page', String(pageNo));
    const headers = authHeader(token);
    if (since) headers['If-Modified-Since'] = since;
    const res = await fetch(`${env.ZOHO_API_URL}/crm/v8/${mod.zoho}?${params}`, { headers });
    if (res.status === 204 || res.status === 304) break;
    if (!res.ok) throw new Error(`Zoho ${mod.zoho}: ${res.status} ${await res.text()}`);
    const body = await res.json();
    records.push(...(body.data || []));
    if (!body.info?.more_records) break;
    pageToken = body.info.next_page_token || null;
  }
  return records;
}

// The part of a record kept in the app: its id and list fields.
const listPart = (mod, r) => Object.fromEntries(['id', ...mod.fields].map((f) => [f, r[f] ?? null]));

const rowFor = (env, key, mod, r) => {
  const search = mod.searchOf(r).filter(Boolean).join(' ').toLowerCase();
  return env.DB.prepare(
    `INSERT INTO crm_records (module, id, name, status, search, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(module, id) DO UPDATE SET name = excluded.name, status = excluded.status, search = excluded.search,
       created_at = excluded.created_at, data = excluded.data`
  ).bind(key, String(r.id), mod.nameOf(r), mod.statusOf(r), search, r.Created_Time || null, JSON.stringify(listPart(mod, r)));
};

async function getState(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'crm_sync'").first();
  return row ? JSON.parse(row.value) : {};
}

async function syncModule(env, token, key, full, state) {
  const mod = MODULES[key];
  const started = new Date().toISOString();
  const layout = await fetchLayout(env, token, mod);
  const prev = state[key] || {};
  const records = await fetchRecords(env, token, mod, full ? null : prev.at);

  const statements = [
    env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`crm_layout_${key}`, JSON.stringify(layout)),
  ];
  if (full) {
    // Only write records that changed, and remove records no longer in Zoho.
    const { results } = await env.DB.prepare('SELECT id, data FROM crm_records WHERE module = ?').bind(key).all();
    const saved = new Map(results.map((r) => [r.id, r.data]));
    for (const r of records) if (saved.get(String(r.id)) !== JSON.stringify(listPart(mod, r))) statements.push(rowFor(env, key, mod, r));
    // An empty answer when records were copied before is more likely a Zoho problem than every record being deleted.
    if (records.length || !saved.size) {
      const ids = JSON.stringify(records.map((r) => String(r.id)));
      statements.push(env.DB.prepare('DELETE FROM crm_records WHERE module = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(key, ids));
    }
  } else {
    for (const r of records) statements.push(rowFor(env, key, mod, r));
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
  // Five minutes of overlap, so a record saved in Zoho while this ran is copied next time.
  const at = new Date(Date.parse(started) - 5 * 60000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
  state[key] = { at, synced_at: new Date().toISOString(), full_at: full ? started : prev.full_at, error: null, changed: records.length };
}

// Copies both modules. `force` copies everything; otherwise only changes, plus everything once a day.
export async function syncCrm(env, { force = false } = {}) {
  if (!env.ZOHO_REFRESH_TOKEN) return { skipped: true };
  const state = await getState(env);
  const token = await accessToken(env);
  let failed = null;
  for (const key of Object.keys(MODULES)) {
    const prev = state[key] || {};
    const full = force || !prev.at || !prev.full_at || Date.now() - Date.parse(prev.full_at) > FULL_EVERY_HOURS * 3600000;
    try {
      await syncModule(env, token, key, full, state);
    } catch (err) {
      console.error(`Zoho CRM copy (${key}) failed: ${err.message}`);
      state[key] = { ...prev, error: { at: new Date().toISOString(), message: err.message.slice(0, 500) } };
      failed = failed || err;
    }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('crm_sync', ?)").bind(JSON.stringify(state)).run();
  if (failed) throw failed;
  return state;
}

async function getLayout(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(`crm_layout_${key}`).first();
  return row ? JSON.parse(row.value) : { sections: [], statusOrder: [] };
}

export const zohoLink = (env, key, id) => `https://crm.zoho.com/crm/${env.ZOHO_CRM_ORG}/tab/${MODULES[key].tab}/${encodeURIComponent(id)}`;

const LIST_LIMIT = 200;

export async function adminCrmRoutes(env, user, path, method, field, message, url) {
  let m;
  if (path === '/admin/crm/sync' && method === 'POST') {
    const back = '/admin/applicants';
    try {
      await syncCrm(env, { force: true });
      return redirect(`${back}?msg=crm-synced`);
    } catch {
      return redirect(`${back}?msg=crm-sync-failed`);
    }
  }

  if (path === '/admin/applicants' && method === 'GET') {
    const layout = await getLayout(env, 'applicants');
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const status = url.searchParams.get('status') || '';
    const { results: counts } = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM crm_records WHERE module = 'applicants' GROUP BY status").all();
    const where = ["module = 'applicants'"];
    const binds = [];
    if (q) {
      // Searching looks through every applicant, whatever the status.
      where.push("search LIKE ? ESCAPE '\\'");
      binds.push(`%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    } else if (status === 'all') {
      // no filter
    } else if (status) {
      where.push('status = ?');
      binds.push(status);
    } else {
      where.push('status NOT IN (SELECT value FROM json_each(?))');
      binds.push(JSON.stringify(CLOSED_STATUSES));
    }
    const { results } = await env.DB.prepare(
      `SELECT id, name, status, created_at, data FROM crm_records WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${LIST_LIMIT + 1}`
    ).bind(...binds).all();
    const applicants = results.slice(0, LIST_LIMIT).map((r) => ({ ...r, data: JSON.parse(r.data) }));
    return page(views.applicantsPage({
      user, applicants, more: results.length > LIST_LIMIT, counts, statusOrder: layout.statusOrder, closed: CLOSED_STATUSES, q, status,
      sync: (await getState(env)).applicants, message,
    }));
  }

  if ((m = path.match(/^\/admin\/(applicants)\/(\d+)(\/file)?$/)) && method === 'GET') {
    const [, key, id, file] = m;
    const mod = MODULES[key];
    const row = await env.DB.prepare('SELECT * FROM crm_records WHERE module = ? AND id = ?').bind(key, id).first();
    const live = await liveRecord(env, mod, id);
    if (live.gone) {
      if (!row) return redirect(`/admin/${key}`);
      await env.DB.prepare('DELETE FROM crm_records WHERE module = ? AND id = ?').bind(key, id).run();
      return redirect(`/admin/${key}?msg=crm-gone`);
    }
    if (!live.data && !row) return redirect(`/admin/${key}`);
    if (file) return live.data ? zohoFile(env, live.data, url.searchParams.get('field') || '', Number(url.searchParams.get('n') || 0)) : zohoDown();
    // Keep the list copy up to date with what Zoho just sent.
    if (live.data) await rowFor(env, key, mod, live.data).run();
    const data = live.data || JSON.parse(row.data);
    const record = { id, name: mod.nameOf(data), status: mod.statusOf(data), data };
    const layout = await getLayout(env, key);
    return page(views.crmRecordPage({
      user, key, record, layout, closed: CLOSED_STATUSES, zohoUrl: zohoLink(env, key, id), zohoError: live.error, message,
    }));
  }

  return redirect('/admin/applicants');
}

// Every field of one record, read from Zoho now. { data }, { gone: true } when it is no longer in Zoho,
// or { error } when Zoho could not be reached (the page then shows the copy kept in the app).
async function liveRecord(env, mod, id) {
  try {
    const token = await accessToken(env);
    const res = await fetch(`${env.ZOHO_API_URL}/crm/v8/${mod.zoho}/${id}`, { headers: authHeader(token) });
    if (res.status === 204 || res.status === 404) return { gone: true };
    const text = await res.text();
    if (!res.ok) {
      if (/INVALID_DATA|RECORD_NOT_FOUND/.test(text) && res.status === 400) return { gone: true };
      throw new Error(`${res.status} ${text}`);
    }
    const data = JSON.parse(text).data?.[0];
    return data ? { data } : { gone: true };
  } catch (err) {
    console.error(`Zoho ${mod.zoho} record ${id}: ${err.message}`);
    return { error: err.message.slice(0, 300) };
  }
}

const zohoDown = () => page(views.layout({ title: 'File', body: '<div class="card"><h1>The file could not be opened</h1><p>Zoho could not be reached. Please try again, or open the record in Zoho.</p></div>' }), 502);

// A file from a Zoho "file upload" field (a resume or contract), fetched from Zoho when an admin opens it.
// PDFs and pictures open in the browser; other files download. The file is never kept in the app.
async function zohoFile(env, data, fieldName, n) {
  const entry = Array.isArray(data[fieldName]) ? data[fieldName][n] : null;
  if (!entry?.File_Id__s) return new Response('File not found.', { status: 404 });
  const token = await accessToken(env);
  const res = await fetch(`${env.ZOHO_API_URL}/crm/v8/files?id=${encodeURIComponent(entry.File_Id__s)}`, { headers: authHeader(token) });
  if (!res.ok) {
    console.error(`Zoho file download failed: ${res.status} ${await res.text()}`);
    return page(views.layout({ title: 'File', body: '<div class="card"><h1>The file could not be opened</h1><p>Zoho did not send it. Open the record in Zoho instead.</p></div>' }), 502);
  }
  const name = (entry.File_Name__s || 'file').replace(/[^\w .()-]/g, '_');
  const type = res.headers.get('Content-Type') || 'application/octet-stream';
  const inline = /^(application\/pdf|image\/(png|jpe?g|gif|webp))/.test(type);
  return new Response(res.body, {
    headers: {
      'Content-Type': inline ? type : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Cache-Control': 'private, no-store',
    },
  });
}
