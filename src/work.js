// Tasks, task lists and time logs in Zoho Projects, done from the app.
// Everything is saved straight into Zoho Projects; the app only keeps the running timer.

import { accessToken } from './zoho.js';

// A problem Zoho reported, in words a VA can read.
export class ZohoError extends Error {}

function plainZohoMessage(status, body) {
  const text = JSON.stringify(body || {});
  if (/scope/i.test(text)) {
    return 'The app does not have permission for this in Zoho yet. An admin needs to create the new Zoho key (see the README).';
  }
  // Zoho puts its explanation in a "message" field, sometimes several levels down.
  // A "title" is only a short code (such as INVALID_INPUT), so it is used only when there is no message.
  const messages = [], titles = [];
  (function walk(v) {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && /^(message|error_message)$/.test(k)) messages.push(v.field_name ? `${x} (${v.field_name})` : x);
      else if (typeof x === 'string' && k === 'title') titles.push(x);
      else walk(x);
    }
  })(body);
  const msg = messages.find((m) => m.length > 3) || titles[0];
  return msg ? `Zoho said: ${msg}` : `Zoho did not accept this (error ${status}).`;
}

async function zp(env, method, path, { body, query, version = 'v3' } = {}) {
  const token = await accessToken(env);
  const url = new URL(`${env.ZOHO_PROJECTS_API_URL}/api/${version}/portal/${env.ZOHO_PORTAL_ID}${path}`);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
  if (!res.ok || data.error) {
    console.error(`Zoho Projects ${method} ${path}: ${res.status} ${text.slice(0, 500)}`);
    throw new ZohoError(plainZohoMessage(res.status, data));
  }
  return data;
}

// ---- Tasks and task lists ----

// Returns the project's task lists, each with its open tasks, in Zoho's order.
export async function projectWork(env, projectId) {
  const listsBody = await zp(env, 'GET', `/projects/${projectId}/tasklists`, { query: { per_page: 200 } });
  const lists = (listsBody.tasklists || []).map((l) => ({ id: String(l.id), name: l.name, tasks: [] }));

  const tasks = [];
  for (let page = 1; page <= 10; page++) {
    const body = await zp(env, 'GET', `/projects/${projectId}/tasks`, { query: { page, per_page: 200 } });
    tasks.push(...(body.tasks || []));
    if (!body.page_info?.has_next_page) break;
  }
  const byId = new Map(lists.map((l) => [l.id, l]));
  const loose = { id: '', name: 'Other tasks', tasks: [] };
  for (const t of tasks) {
    if (t.is_completed || t.status?.is_closed_type) continue;
    const task = { id: String(t.id), name: t.name, prefix: t.prefix || '', status: t.status?.name || '', listId: t.tasklist?.id ? String(t.tasklist.id) : '' };
    (byId.get(task.listId) || loose).tasks.push(task);
  }
  if (loose.tasks.length) lists.push(loose);
  return lists;
}

export const createTask = (env, projectId, tasklistId, name) =>
  zp(env, 'POST', `/projects/${projectId}/tasks`, { body: { name, ...(tasklistId ? { tasklist: { id: tasklistId } } : {}) } });
export const renameTask = (env, projectId, taskId, name) =>
  zp(env, 'PATCH', `/projects/${projectId}/tasks/${taskId}`, { body: { name } });
export const moveTask = (env, projectId, taskId, tasklistId) =>
  zp(env, 'PATCH', `/projects/${projectId}/tasks/${taskId}`, { body: { tasklist: { id: tasklistId } } });
export const deleteTask = (env, projectId, taskId) =>
  zp(env, 'DELETE', `/projects/${projectId}/tasks/${taskId}`);

export const createList = (env, projectId, name) =>
  zp(env, 'POST', `/projects/${projectId}/tasklists`, { body: { name, flag: 'external' } });
export const renameList = (env, projectId, listId, name) =>
  zp(env, 'PATCH', `/projects/${projectId}/tasklists/${listId}`, { body: { name } });
export const deleteList = (env, projectId, listId) =>
  zp(env, 'DELETE', `/projects/${projectId}/tasklists/${listId}`);

// ---- Time logs ----

// Zoho notes can contain simple formatting; the app shows them as plain text.
export function plainNotes(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

// "02:30 PM" or "14:30" -> "14:30" (for the app's time boxes).
export function to24h(value) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)?$/i.exec(String(value || '').trim());
  if (!m) return '';
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// The VA's own time logs in a project between two dates (inclusive), newest first.
// Zoho lists task logs and general logs separately, so both are fetched.
export async function myLogs(env, projectId, userZohoId, email, start, end) {
  const logs = [];
  for (const type of ['task', 'general']) for (let page = 1; page <= 10; page++) {
    const body = await zp(env, 'GET', `/projects/${projectId}/timelogs`, {
      query: { view_type: 'customdate', start_date: start, end_date: end, page, per_page: 100, module: JSON.stringify({ type }) },
    });
    for (const day of body.time_logs || []) {
      for (const l of day.log_details || []) {
        const owner = l.owner || {};
        const mine = (userZohoId && String(owner.zpuid) === String(userZohoId)) || (owner.email || '').toLowerCase() === email.toLowerCase();
        if (!mine) continue;
        logs.push({
          id: String(l.id),
          date: l.date || day.date,
          type: l.type || l.module_detail?.type || type,
          taskId: l.module_detail?.id ? String(l.module_detail.id) : '',
          title: l.module_detail?.name || l.name || l.log_name || 'General',
          hours: l.log_hour || '',
          billable: (l.billing_status || '').toLowerCase() === 'billable',
          notes: plainNotes(l.notes),
          start: to24h(l.start_time),
          end: to24h(l.end_time),
        });
      }
    }
    if (!body.page_info?.has_next_page) break;
  }
  return logs.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
}

// log: { date, start, end, billable, notes, taskId, name }
function logBody(log, ownerId) {
  return {
    date: log.date,
    bill_status: log.billable ? 'Billable' : 'Non Billable',
    start_time: log.start,
    end_time: log.end,
    notes: log.notes || '',
    owner_zpuid: ownerId,
    module: log.taskId ? { type: 'task', id: log.taskId } : { type: 'general' },
    ...(log.taskId ? {} : { log_name: log.name || 'General' }),
  };
}

export const addLog = (env, projectId, ownerId, log) =>
  zp(env, 'POST', `/projects/${projectId}/log`, { body: logBody(log, ownerId) });

// Checks the log belongs to this VA before it is changed or trashed.
async function assertMine(env, projectId, logId, type, ownerId) {
  const body = await zp(env, 'GET', `/projects/${projectId}/logs/${logId}`, { query: { type } });
  const log = body.time_log || body.log || body;
  if (String(log.owner?.zpuid || '') !== String(ownerId)) throw new ZohoError('You can only change your own time logs.');
}

export async function updateLog(env, projectId, logId, ownerId, log) {
  const type = log.taskId ? 'task' : 'general';
  await assertMine(env, projectId, logId, type, ownerId);
  return zp(env, 'PATCH', `/projects/${projectId}/logs/${logId}`, { body: logBody(log, ownerId) });
}

export async function deleteLog(env, projectId, logId, type, ownerId) {
  await assertMine(env, projectId, logId, type, ownerId);
  return zp(env, 'DELETE', `/projects/${projectId}/logs/${logId}`, { query: { module: type } });
}
