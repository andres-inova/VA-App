// Copies clients (Accounts), their contacts and VAs from Zoho CRM into the app, with their notes and files.
//
// It runs in small steps: the first right away when an admin clicks "Copy from Zoho", then one each minute
// (from the scheduled job) until it is done, so no single run asks Zoho for too much. The copy can be run
// again: records already copied are updated from Zoho (matched by their Zoho id), and notes and files already
// copied are skipped. Notes, files and history added in the app are kept.

import { accessToken } from './zoho.js';
import { MODULES, allFields, nameOf, statusOf, searchOf } from './fields.js';

const STATE_KEY = 'zoho_import';
const CALLS_PER_RUN = 30; // Zoho requests per run (Cloudflare's free plan allows 50 per run)
const ORDER = ['clients', 'contacts', 'vas'];

// Zoho's own bookkeeping fields, never copied.
const SKIP = new Set(['id', 'Record_Status__s', 'Locked__s', 'Unsubscribed_Mode', 'Unsubscribed_Time', 'Enrich_Status__s',
  'Last_Enriched_Time__s', 'Change_Log_Time__s', 'Record_Image', 'Created_By', 'Modified_By', 'Created_Time', 'Modified_Time',
  'Last_Activity_Time', 'Timezone_West_East', 'Full_Name', 'Offboarded', 'Paused', 'Referred', 'Tag', '$']);

export async function importState(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(STATE_KEY).first();
  return row ? JSON.parse(row.value) : null;
}
const saveState = (env, state) =>
  env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(STATE_KEY, JSON.stringify(state)).run();

// Starts a new copy (unless one is already running) and runs its first step.
export async function startImport(env, user) {
  const state = await importState(env);
  if (state?.status === 'running' && Date.now() - Date.parse(state.step_at || state.started_at) < 10 * 60000) return state;
  const fresh = {
    status: 'running', started_at: new Date().toISOString(), by: user.name,
    queue: [...ORDER.map((m) => ({ t: 'list', m })), { t: 'notes' }, { t: 'links' }],
    counts: { clients: 0, contacts: 0, vas: 0, notes: 0, files: 0 }, problems: [],
  };
  await saveState(env, fresh);
  return runImportStep(env);
}

// One step: works through the queue until it has used its Zoho requests. Called each minute while running.
export async function runImportStep(env) {
  const state = await importState(env);
  if (state?.status !== 'running') return state;
  // Another step started less than a minute ago and may still be working.
  if (state.busy_until && Date.parse(state.busy_until) > Date.now()) return state;
  state.busy_until = new Date(Date.now() + 60000).toISOString();
  await saveState(env, state);

  const ctx = { env, state, calls: 0, token: null };
  try {
    ctx.token = await accessToken(env);
    while (state.queue.length && ctx.calls < CALLS_PER_RUN) {
      const job = state.queue[0];
      await runJob(ctx, job);
      state.queue.shift();
    }
    if (!state.queue.length) {
      state.status = 'done';
      state.finished_at = new Date().toISOString();
    }
  } catch (err) {
    console.error(`Zoho import: ${err.message}`);
    state.status = 'failed';
    state.error = err.message.slice(0, 500);
    state.finished_at = new Date().toISOString();
  }
  state.step_at = new Date().toISOString();
  delete state.busy_until;
  await saveState(env, state);
  return state;
}

async function zoho(ctx, path) {
  ctx.calls++;
  const res = await fetch(`${ctx.env.ZOHO_API_URL}/crm/v8/${path}`, { headers: { Authorization: `Zoho-oauthtoken ${ctx.token}` } });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Zoho ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

async function runJob(ctx, job) {
  const { env, state } = ctx;
  if (job.t === 'list') {
    // The ids of every record in the module; each record is then read in full.
    const mod = MODULES[job.m];
    const params = new URLSearchParams({ fields: 'Modified_Time', per_page: '200', sort_by: 'id', sort_order: 'asc' });
    if (job.token) params.set('page_token', job.token); else params.set('page', String(job.page || 1));
    const res = await zoho(ctx, `${mod.zoho}?${params}`);
    const body = res ? await res.json() : { data: [] };
    const recs = (body.data || []).map((r) => ({ t: 'rec', m: job.m, id: String(r.id) }));
    const more = body.info?.more_records ? [{ t: 'list', m: job.m, page: (job.page || 1) + 1, token: body.info.next_page_token || null }] : [];
    // After this list job: its records, then the next page (the queue's first item is removed by the caller).
    state.queue.splice(1, 0, ...recs, ...more);
    return;
  }

  if (job.t === 'rec') {
    const mod = MODULES[job.m];
    const res = await zoho(ctx, `${mod.zoho}/${job.id}`);
    const z = res ? (await res.json()).data?.[0] : null;
    if (!z) return; // deleted in Zoho since the list was read
    const recordId = await saveRecord(env, job.m, z);
    state.counts[job.m]++;
    // Files in file fields (Resume, Contract).
    for (const field of allFields(job.m).filter((x) => x.type === 'file')) {
      for (const file of Array.isArray(z[field.key]) ? z[field.key] : []) {
        if (file?.File_Id__s) state.queue.push({ t: 'file', rid: recordId, field: field.key, fid: file.File_Id__s, name: file.File_Name__s || 'file', by: file.Created_By__s?.name || '', at: file.Created_Time__s || null });
      }
    }
    // Attachments (the "Attachments" list on the record in Zoho).
    const att = await zoho(ctx, `${mod.zoho}/${job.id}/Attachments?fields=File_Name,Size,Created_Time,Created_By&per_page=200`);
    for (const a of att ? (await att.json()).data || [] : []) {
      // A link saved as an attachment becomes a note.
      if (a.$link_url) {
        await env.DB.prepare('INSERT OR IGNORE INTO record_notes (record_id, author, body, created_at, zoho_id) VALUES (?, ?, ?, ?, ?)')
          .bind(recordId, a.Created_By?.name || 'Zoho', `Link: ${a.File_Name || ''}
${a.$link_url}`.trim(), a.Created_Time || new Date().toISOString(), `att:${a.id}`).run();
        continue;
      }
      state.queue.push({ t: 'att', rid: recordId, m: job.m, zid: job.id, aid: String(a.id), name: a.File_Name || 'file', by: a.Created_By?.name || '', at: a.Created_Time || null });
    }
    return;
  }

  if (job.t === 'notes') {
    const params = new URLSearchParams({ fields: 'Note_Title,Note_Content,Parent_Id,Created_Time,Created_By,Modified_Time', per_page: '200' });
    params.set('page', String(job.page || 1));
    const res = await zoho(ctx, `Notes?${params}`);
    const body = res ? await res.json() : { data: [] };
    const { results } = await env.DB.prepare('SELECT id, zoho_id FROM records WHERE zoho_id IS NOT NULL').all();
    const byZoho = new Map(results.map((r) => [r.zoho_id, r.id]));
    const statements = [];
    for (const n of body.data || []) {
      const recordId = byZoho.get(String(n.Parent_Id?.id || ''));
      const text = [n.Note_Title, n.Note_Content].filter(Boolean).join('\n\n').trim();
      if (!recordId || !text) continue;
      statements.push(env.DB.prepare(
        'INSERT OR IGNORE INTO record_notes (record_id, author, body, created_at, updated_at, zoho_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(recordId, n.Created_By?.name || 'Zoho', text, n.Created_Time || new Date().toISOString(), n.Modified_Time || null, String(n.id)));
    }
    if (statements.length) {
      const done = await env.DB.batch(statements);
      state.counts.notes += done.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
    }
    if (body.info?.more_records) state.queue.splice(1, 0, { t: 'notes', page: (job.page || 1) + 1 });
    return;
  }

  if (job.t === 'links') return linkRecords(env);

  if (job.t === 'file' || job.t === 'att') {
    const zohoId = job.t === 'file' ? `file:${job.fid}` : `att:${job.aid}`;
    if (await env.DB.prepare('SELECT 1 FROM record_files WHERE zoho_id = ?').bind(zohoId).first()) return;
    const path = job.t === 'file' ? `files?id=${encodeURIComponent(job.fid)}` : `${MODULES[job.m].zoho}/${job.zid}/Attachments/${job.aid}`;
    let res;
    try {
      res = await zoho(ctx, path);
    } catch (err) {
      // One file that Zoho won't send shouldn't stop the whole copy.
      state.problems.push(`${job.name}: ${err.message.slice(0, 200)}`);
      return;
    }
    if (!res) return;
    const type = (res.headers.get('Content-Type') || 'application/octet-stream').split(';')[0];
    const bytes = await res.arrayBuffer();
    const key = `records/${job.rid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await env.SOP_FILES.put(key, bytes, { httpMetadata: { contentType: type } });
    await env.DB.prepare(
      `INSERT OR IGNORE INTO record_files (record_id, field, file_key, file_name, file_type, file_size, uploader, uploaded_at, zoho_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(job.rid, job.t === 'file' ? job.field : '', key, job.name.slice(0, 200), type, bytes.byteLength, job.by || 'Zoho', job.at || new Date().toISOString(), zohoId).run();
    state.counts.files++;
  }
}

// ---- Turning a Zoho record into field values ----

const empty = (v) => v === null || v === undefined || v === '' || v === '-None-' || (Array.isArray(v) && !v.length);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

// The other record in a row of a Zoho "multi-select lookup" (each row links this record to another).
const otherIds = (rows, selfId) => (Array.isArray(rows) ? rows : []).map((row) => {
  const hit = Object.values(row || {}).find((v) => v && typeof v === 'object' && v.id && String(v.id) !== String(selfId));
  return hit ? String(hit.id) : null;
}).filter(Boolean);

function valueFrom(field, v, z) {
  switch (field.type) {
    case 'bool': return Boolean(v);
    case 'int': return empty(v) || Number.isNaN(Number(v)) ? null : Math.round(Number(v));
    case 'money': return empty(v) || Number.isNaN(Number(v)) ? null : Number(v);
    case 'date': return day(v);
    case 'multi': return (Array.isArray(v) ? v : empty(v) ? [] : [v]).map(String).filter((x) => x && x !== '-None-');
    case 'tags': return (Array.isArray(v) ? v : []).map((t) => t?.name).filter(Boolean);
    case 'owner': return v?.name || null;
    // Lookups keep Zoho's ids until every record is copied; linkRecords() then turns them into app ids.
    case 'lookup': return v?.id ? { zoho: String(v.id) } : null;
    case 'lookups': return otherIds(v, z.id).map((id) => ({ zoho: id }));
    default: return empty(v) ? null : typeof v === 'object' ? String(v.name ?? JSON.stringify(v)) : String(v);
  }
}

// Field values for the app from a Zoho record. Zoho fields the app has no place for are kept under
// "_extra" (shown on the record page as "Other fields from Zoho"), so nothing is lost.
function dataFrom(key, z) {
  const data = {};
  const known = new Set();
  for (const field of allFields(key)) {
    known.add(field.key);
    if (field.type === 'file') continue;
    const v = field.key === 'Tag' ? valueFrom(field, z.Tag, z) : valueFrom(field, z[field.key], z);
    if (!empty(v) && v !== false) data[field.key] = v;
  }
  if (key === 'clients') data.Status = z.Offboarded ? 'Offboarded' : z.Paused ? 'Paused' : 'Current';
  if (key === 'contacts') {
    if (z.Account_Name?.id) data._client = { zoho: String(z.Account_Name.id) };
    known.add('Account_Name');
  }
  // "Clients referred" / "VAs referred": the app keeps referrals on the referred record ("Referred by") only.
  const referred = otherIds(z.Referred, z.id);
  if (key !== 'contacts' && referred.length) data._referred = referred.map((id) => ({ zoho: id }));
  const extra = {};
  for (const [k, v] of Object.entries(z)) {
    if (known.has(k) || SKIP.has(k) || k.startsWith('$') || empty(v) || v === false) continue;
    extra[k] = Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.name || x.File_Name__s || '' : String(x))).filter(Boolean).join(', ')
      : typeof v === 'object' ? String(v.name ?? '') : String(v);
    if (!extra[k]) delete extra[k];
  }
  if (Object.keys(extra).length) data._extra = extra;
  return data;
}

// Adds or updates one record from Zoho; returns the app's record id.
async function saveRecord(env, key, z) {
  const zohoId = String(z.id);
  const data = dataFrom(key, z);
  const name = nameOf(key, data);
  const status = statusOf(key, data);
  const email = (data.Email || '').toLowerCase() || null;
  const existing = await env.DB.prepare('SELECT id, data FROM records WHERE zoho_id = ?').bind(zohoId).first();
  const now = new Date().toISOString();
  if (existing) {
    // Zoho's values replace the app's. Lookups are linked again by linkRecords() at the end of the copy.
    const old = JSON.parse(existing.data);
    const changes = [];
    for (const field of allFields(key)) {
      if (field.type === 'file' || field.type === 'lookup' || field.type === 'lookups') continue;
      const a = JSON.stringify(old[field.key] ?? null);
      const b = JSON.stringify(data[field.key] ?? null);
      if (a !== b) changes.push({ f: field.key, from: old[field.key] ?? null, to: data[field.key] ?? null });
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE records SET name = ?, status = ?, email = ?, search = ?, data = ?, updated_at = ? WHERE id = ?')
        .bind(name, status, email, searchOf(key, data, name), JSON.stringify(data), now, existing.id),
      ...(changes.length ? [env.DB.prepare('INSERT INTO record_history (record_id, summary, changes, at) VALUES (?, ?, ?, ?)')
        .bind(existing.id, 'Updated from Zoho', JSON.stringify(changes), now)] : []),
    ]);
    return existing.id;
  }
  const created = z.Created_Time ? new Date(z.Created_Time).toISOString() : now;
  const row = await env.DB.prepare(
    `INSERT INTO records (module, name, status, email, search, data, zoho_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(key, name, status, email, searchOf(key, data, name), JSON.stringify(data), zohoId, created, now).first();
  const by = z.Created_By?.name;
  await env.DB.prepare('INSERT INTO record_history (record_id, summary, at) VALUES (?, ?, ?)')
    .bind(row.id, `Copied from Zoho${by ? ` (created there by ${by})` : ''}`, now).run();
  return row.id;
}

// Turns the Zoho ids kept in lookups into the app's record ids, puts each contact under its client, and
// adds "Clients referred" / "VAs referred" from Zoho to the referred record's "Referred by".
async function linkRecords(env) {
  const { results } = await env.DB.prepare('SELECT id, module, zoho_id, parent_id, data FROM records').all();
  const byZoho = new Map(results.filter((r) => r.zoho_id).map((r) => [r.zoho_id, r.id]));
  const byId = new Map(results.map((r) => [r.id, r]));
  const fix = (v) => (v && typeof v === 'object' && 'zoho' in v ? byZoho.get(v.zoho) ?? null : v);
  for (const r of results) r.values = JSON.parse(r.data);
  const changed = new Set();
  for (const r of results) {
    const data = r.values;
    if (data._client) {
      r.parent_id = fix(data._client);
      delete data._client;
      changed.add(r);
    }
    for (const field of allFields(r.module)) {
      const v = data[field.key];
      if (field.type === 'lookup' && v && typeof v === 'object') {
        data[field.key] = fix(v);
        if (data[field.key] === null) delete data[field.key];
        changed.add(r);
      }
      if (field.type === 'lookups' && Array.isArray(v) && v.some((x) => x && typeof x === 'object')) {
        data[field.key] = [...new Set(v.map(fix).filter((x) => x !== null && x !== undefined))];
        if (!data[field.key].length) delete data[field.key];
        changed.add(r);
      }
    }
    if (data._referred) {
      const refKey = r.module === 'vas' ? 'Referred_By' : 'Referred_by';
      for (const target of data._referred.map(fix).map((id) => byId.get(id)).filter((t) => t && t.module === r.module)) {
        const list = target.values[refKey] || [];
        if (!list.includes(r.id)) {
          target.values[refKey] = [...list.map(fix).filter((x) => x !== null && x !== undefined), r.id];
          changed.add(target);
        }
      }
      delete data._referred;
      changed.add(r);
    }
  }
  const statements = [...changed].map((r) =>
    env.DB.prepare('UPDATE records SET data = ?, parent_id = ? WHERE id = ?').bind(JSON.stringify(r.values), r.parent_id, r.id));
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
}
