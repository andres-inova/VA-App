// The VA's Time page (time logging in the app, piece T2): choose a project, run timers (several at once, kept on the
// server), save a stopped timer, log time by hand, and change or delete today's logs. Everything is saved in the app's
// own time_logs table, for Zoho projects and app projects alike; nothing goes to Zoho any more.
//
// Rules (all checked here, on the server):
// - A VA sees and logs time only for their active projects; a coverage project only on days they cover that client
//   (or when an admin allowed past dates for it).
// - Time is logged for TODAY in the project's time zone, unless an approved log_exceptions row covers that date.
// - entered_at and entered_by are set here and never change; values sent with a form are ignored.
// - A log can be changed or deleted only while its day is still today (or an allowed date). Every change is written
//   to time_log_history; a delete only marks the log (deleted_at).

import { redirect, page, sameClient } from './util.js';
import { ZONES, partsIn, addDays, projectZones, timerLimit } from './time.js';
import { dayInfo, coveringClients } from './jobs.js';
import { checkIn } from './actions.js';
import { coveringSops, FILE_TYPES, MAX_FILE } from './sops.js';
import * as tv from './timelog-views.js';
import { hoursRoutes } from './timehours.js';

const MAX_FILES = 5;             // attachments per log
const MAX_RUNNING = 10;          // timers running at once
const MAX_EXCEPTION_DAYS = 120;  // past dates offered in the date list
const LAST_COOKIE = 'va_project';

const minutesBetween = (a, b) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
const cookieOf = (request, name) => (request.headers.get('Cookie') || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || '';

// The VA's projects for the Time page, each with its time zone, its "today" and the past dates an admin allowed.
export async function myProjects(env, user, now = new Date()) {
  const { results: rows } = await env.DB.prepare(
    `SELECT p.id, p.client, p.client_record_id, p.name, p.is_coverage FROM assignments a JOIN projects p ON p.id = a.project_id
     WHERE a.user_id = ? AND p.active = 1 ORDER BY p.is_coverage, p.client`
  ).bind(user.id).all();
  if (!rows.length) return [];
  const zones = await projectZones(env, rows.map((p) => p.id));
  const { results: exceptions } = await env.DB.prepare(
    'SELECT project_id, from_date, to_date FROM log_exceptions WHERE user_id = ? AND approved_by IS NOT NULL'
  ).bind(user.id).all();
  const coveringOn = new Map();
  const projects = [];
  for (const p of rows) {
    const zone = zones.get(String(p.id)) || 'EST';
    const today = partsIn(ZONES[zone], now).date;
    // Past dates allowed by an admin (newest first). Never today or later: today is always allowed.
    const allowed = new Set();
    for (const e of exceptions.filter((x) => String(x.project_id) === String(p.id))) {
      for (let d = e.to_date < today ? e.to_date : addDays(today, -1); d >= e.from_date && allowed.size < MAX_EXCEPTION_DAYS; d = addDays(d, -1)) allowed.add(d);
    }
    if (p.is_coverage) {
      if (!coveringOn.has(today)) coveringOn.set(today, await coveringClients(env, user, today));
      const covering = coveringOn.get(today).some((c) => sameClient(c, p));
      if (!covering && !allowed.size) continue;
      p.coveringToday = covering;
    }
    projects.push({ ...p, id: String(p.id), zone, today, allowed: [...allowed].sort().reverse() });
  }
  return projects;
}

// Coverage projects can be logged "today" only on days the VA covers the client.
const todayOk = (project) => Boolean(project) && (!project.is_coverage || project.coveringToday);
// May this VA log (or change a log) on this date in this project? Today, or a past date an admin allowed.
const mayLog = (project, date) => Boolean(project) && (date === project.today ? todayOk(project) : project.allowed.includes(date));

// Stops the VA's timers that ran past 8 hours or past 11:59 PM project time (the every-minute job does the same;
// this keeps the page right if the job has not run yet).
async function settleTimers(env, timers, zones, now) {
  const due = timers.filter((t) => !t.stopped_at).map((t) => ({ t, limit: timerLimit(t.started_at, zones.get(String(t.project_id))) })).filter((x) => x.limit.at <= now);
  if (!due.length) return;
  await env.DB.batch(due.map(({ t, limit }) => env.DB.prepare('UPDATE work_timers SET stopped_at = ?, auto_stopped = ? WHERE id = ? AND stopped_at IS NULL')
    .bind(limit.at.toISOString(), limit.reason, t.id)));
  for (const { t, limit } of due) { t.stopped_at = limit.at.toISOString(); t.auto_stopped = limit.reason; }
}

// The VA's timers with project and task type names (also used for the timer bar on every VA page).
export async function loadTimers(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.project_id, t.task_type_id, t.description, t.task_name, t.started_at, t.stopped_at, t.auto_stopped,
       p.client, p.is_coverage, tt.name AS type_name
     FROM work_timers t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN task_types tt ON tt.id = t.task_type_id
     WHERE t.user_id = ? ORDER BY t.started_at`
  ).bind(userId).all();
  return results;
}

const activeTypes = async (env) => (await env.DB.prepare('SELECT id, name FROM task_types WHERE hidden = 0 ORDER BY position, id').all()).results;
const allTypes = async (env) => (await env.DB.prepare('SELECT id, name, hidden FROM task_types ORDER BY position, id').all()).results;

// Hours + minutes boxes -> minutes (1 minute to 24 hours), or null.
function readMinutes(field) {
  const h = field('hours') === '' ? 0 : Number(field('hours'));
  const m = field('minutes') === '' ? 0 : Number(field('minutes'));
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59 || h > 24) return null;
  const total = h * 60 + m;
  return total >= 1 && total <= 1440 ? total : null;
}

// The files chosen in a form (empty file boxes are skipped). Returns { files } or { error }.
function readFiles(form, already = 0) {
  const files = (form ? form.getAll('files') : []).filter((f) => f && typeof f !== 'string' && f.size);
  if (files.length + already > MAX_FILES) return { error: `You can attach up to ${MAX_FILES} files to one log.` };
  for (const f of files) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!FILE_TYPES[ext]) return { error: `"${f.name}" can't be attached. Please use a PDF, Word, Excel or text file, or a picture (PNG or JPG).` };
    if (f.size > MAX_FILE) return { error: `"${f.name}" is too big. The limit is 15 MB per file.` };
  }
  return { files };
}

// Saves the files in storage and returns the statements that list them on the log.
async function storeFiles(env, logId, files, user, now) {
  const statements = [];
  for (const [i, f] of files.entries()) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const key = `time-logs/${logId}/${Date.now()}-${i}.${ext}`;
    await env.SOP_FILES.put(key, f.stream(), { httpMetadata: { contentType: FILE_TYPES[ext] } });
    statements.push(env.DB.prepare('INSERT INTO time_log_files (log_id, file_key, file_name, file_type, file_size, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(logId, key, f.name.slice(0, 200), FILE_TYPES[ext], f.size, user.id, now));
  }
  return statements;
}

const historyRow = (env, logId, user, summary, changes, now) =>
  env.DB.prepare('INSERT INTO time_log_history (log_id, user_id, at, summary, changes) VALUES (?, ?, ?, ?, ?)')
    .bind(logId, user.id, now, summary.slice(0, 500), changes ? JSON.stringify(changes) : null);

async function filesOf(env, logIds) {
  const map = new Map();
  if (!logIds.length) return map;
  for (let i = 0; i < logIds.length; i += 90) {
    const part = logIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT id, log_id, file_name, file_size FROM time_log_files WHERE log_id IN (${part.map(() => '?').join(',')}) ORDER BY id`).bind(...part).all();
    for (const f of results) { if (!map.has(f.log_id)) map.set(f.log_id, []); map.get(f.log_id).push(f); }
  }
  return map;
}

// ---- Routes ----

export async function timeRoutes(env, user, request, path, method, field, form, message, url) {
  // "My hours": totals, charts, history and the CSV file (read-only, timehours.js).
  if ((path === '/va/time/hours' || path === '/va/time/hours.csv') && method === 'GET') return hoursRoutes(env, user, path, url, message);
  const now = new Date();
  const nowIso = now.toISOString();
  const projects = await myProjects(env, user, now);
  const timers = user.timers || [];
  const zones = new Map(projects.map((p) => [p.id, p.zone]));
  const missing = timers.filter((t) => !zones.has(String(t.project_id))).map((t) => t.project_id);
  if (missing.length) for (const [id, z] of await projectZones(env, missing)) zones.set(id, z);
  await settleTimers(env, timers, zones, now);
  const byId = (id) => projects.find((p) => p.id === String(id || ''));
  const home = (projectId, msg) => redirect(`/va/time?${new URLSearchParams({ ...(projectId ? { project: projectId } : {}), ...(msg ? { msg } : {}) })}`);
  let m;

  // ---- The main page ----
  if (path === '/va/time' && method === 'GET') {
    const asked = url.searchParams.get('project');
    const remembered = decodeURIComponent(cookieOf(request, LAST_COOKIE));
    const project = byId(asked) || byId(remembered) || byId(timers.find((t) => !t.stopped_at)?.project_id) || projects[0] || null;
    // Today's minutes per project (each project's own today).
    const since = projects.reduce((min, p) => (p.today < min ? p.today : min), projects[0]?.today || partsIn(ZONES.EST, now).date);
    const { results: sums } = await env.DB.prepare(
      'SELECT project_id, work_date, SUM(minutes) AS minutes FROM time_logs WHERE user_id = ? AND deleted_at IS NULL AND work_date >= ? GROUP BY project_id, work_date'
    ).bind(user.id, since).all();
    for (const p of projects) p.todayMinutes = sums.find((s) => String(s.project_id) === p.id && s.work_date === p.today)?.minutes || 0;
    let logs = [], files = new Map(), coverageSop = null;
    if (project) {
      const dates = [project.today, ...project.allowed];
      const { results } = await env.DB.prepare(
        `SELECT l.*, tt.name AS type_name, u.name AS entered_by_name FROM time_logs l LEFT JOIN task_types tt ON tt.id = l.task_type_id
         LEFT JOIN users u ON u.id = l.entered_by
         WHERE l.user_id = ? AND l.project_id = ? AND l.deleted_at IS NULL AND l.work_date >= ? ORDER BY l.work_date DESC, l.entered_at DESC LIMIT 300`
      ).bind(user.id, project.id, dates.reduce((a, b) => (b < a ? b : a))).all();
      logs = results.filter((l) => dates.includes(l.work_date));
      files = await filesOf(env, logs.map((l) => l.id));
      if (project.is_coverage) coverageSop = (await coveringSops(env, user)).find((c) => sameClient(c, project) && (c.has_content || c.file_key)) || null;
    }
    const res = page(tv.timePage({ user, projects, project, timers, logs, files, coverageSop, message, now }));
    if (project && project.id !== remembered) {
      res.headers.append('Set-Cookie', `${LAST_COOKIE}=${encodeURIComponent(project.id)}; Path=/va; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
    }
    return res;
  }

  // ---- Start a timer: choose the task type ----
  if (path === '/va/time/start') {
    const project = byId(method === 'POST' ? field('project') : url.searchParams.get('project'));
    if (!project) return home('', 'time-no-project');
    if (!todayOk(project)) return home(project.id, 'time-not-covering');
    const types = await activeTypes(env);
    if (method === 'GET') return page(tv.startPage({ user, project, types, message }));
    const type = types.find((t) => t.id === Number(field('task_type')));
    if (!type) return page(tv.startPage({ user, project, types, description: field('description'), message: ['bad', 'Please tap what you are working on.'] }), 400);
    const running = timers.filter((t) => !t.stopped_at);
    if (running.some((t) => String(t.project_id) === project.id && t.task_type_id === type.id)) return home(project.id, 'timer-already');
    if (running.length >= MAX_RUNNING) return home(project.id, 'timer-too-many');
    await env.DB.prepare('INSERT INTO work_timers (user_id, project_id, task_type_id, description, task_name, started_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, project.id, type.id, field('description').slice(0, 5000) || null, type.name, nowIso).run();
    // Starting work counts as the day's check-in (the first timer of the day).
    const day = await dayInfo(env, user, now);
    const row = await env.DB.prepare('SELECT status, checked_in_at FROM attendance WHERE user_id = ? AND work_date = ?').bind(user.id, day.local.date).first();
    const off = ['called_out', 'time_off', 'emergency', 'coverage'].includes(row?.status);
    if (!row?.checked_in_at && !off) {
      await checkIn(env, user, now);
      return home(project.id, 'timer-started-checked-in');
    }
    return home(project.id, 'timer-started');
  }

  // ---- A timer: stop, discard, the "Save time" sheet, save ----
  if ((m = path.match(/^\/va\/time\/timer\/(\d+)(?:\/(stop|discard|save))?$/))) {
    const timer = timers.find((t) => t.id === Number(m[1]));
    if (!timer) return home('', 'timer-gone');
    const projectId = String(timer.project_id);
    const zone = zones.get(projectId) || 'EST';
    if (m[2] === 'stop' && method === 'POST') {
      if (!timer.stopped_at) {
        await env.DB.prepare('UPDATE work_timers SET stopped_at = ? WHERE id = ? AND user_id = ? AND stopped_at IS NULL').bind(nowIso, timer.id, user.id).run();
      }
      return redirect(`/va/time/timer/${timer.id}`);
    }
    if (m[2] === 'discard' && method === 'POST') {
      await env.DB.prepare('DELETE FROM work_timers WHERE id = ? AND user_id = ?').bind(timer.id, user.id).run();
      return home(projectId, 'timer-discarded');
    }
    if (!timer.stopped_at) return home(projectId);
    const timerMinutes = minutesBetween(timer.started_at, timer.stopped_at);
    const workDate = partsIn(ZONES[zone], new Date(timer.started_at)).date;
    const types = await allTypes(env);
    const show = (error, status = 200) => page(tv.savePage({
      user, timer, zone, workDate, timerMinutes, types, error,
      values: error ? { description: field('description'), minutes: readMinutes(field), task_type: Number(field('task_type')) } : null,
    }), status);
    if (method === 'GET' && !m[2]) return show(null);
    if (m[2] !== 'save' || method !== 'POST') return home(projectId);

    const type = types.find((t) => t.id === Number(field('task_type')) && (!t.hidden || t.id === timer.task_type_id));
    if (!type) return show('Please choose what you worked on.', 400);
    const minutes = readMinutes(field);
    if (!minutes) return show('Please enter the time you worked (at least 1 minute).', 400);
    if (minutes > timerMinutes) return show(`The timer ran ${tv.duration(timerMinutes)}. Please enter that or less (use "Log time" to add more).`, 400);
    const picked = readFiles(form);
    if (picked.error) return show(picked.error, 400);
    // The timer is removed in the same step, so a second press can't save it twice.
    const [ins] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO time_logs (project_id, user_id, task_type_id, description, minutes, work_date, started_at, ended_at, entered_at, entered_by, source)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'timer' WHERE EXISTS (SELECT 1 FROM work_timers WHERE id = ? AND user_id = ?)`)
        .bind(projectId, user.id, type.id, field('description').slice(0, 5000), minutes, workDate, timer.started_at, timer.stopped_at, nowIso, user.id, timer.id, user.id),
      env.DB.prepare('DELETE FROM work_timers WHERE id = ? AND user_id = ?').bind(timer.id, user.id),
    ]);
    if (!ins.meta.changes) return home(projectId, 'timer-gone');
    const statements = await storeFiles(env, ins.meta.last_row_id, picked.files, user, nowIso);
    if (statements.length) await env.DB.batch(statements);
    return home(projectId, 'time-saved');
  }

  // ---- Log time by hand ----
  if (path === '/va/time/log') {
    const project = byId(method === 'POST' ? field('project') : url.searchParams.get('project'));
    if (!project) return home('', 'time-no-project');
    if (!todayOk(project) && !project.allowed.length) return home(project.id, 'time-not-covering');
    const types = await activeTypes(env);
    const show = (error, status = 200) => page(tv.logPage({
      user, project, types, todayOk: todayOk(project), error,
      values: error ? { description: field('description'), minutes: readMinutes(field), task_type: Number(field('task_type')), date: field('date') } : null,
    }), status);
    if (method === 'GET') return show(null);
    const date = field('date') || project.today;
    if (!mayLog(project, date)) return show(date === project.today ? "You can log time here only on days you cover this client." : 'You can log time only for today. Ask an admin if you need to add time for another day.', 400);
    const type = types.find((t) => t.id === Number(field('task_type')));
    if (!type) return show('Please choose what you worked on.', 400);
    const minutes = readMinutes(field);
    if (!minutes) return show('Please enter the time you worked (at least 1 minute, at most 24 hours).', 400);
    const picked = readFiles(form);
    if (picked.error) return show(picked.error, 400);
    const ins = await env.DB.prepare(`INSERT INTO time_logs (project_id, user_id, task_type_id, description, minutes, work_date, entered_at, entered_by, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`).bind(project.id, user.id, type.id, field('description').slice(0, 5000), minutes, date, nowIso, user.id).run();
    const statements = await storeFiles(env, ins.meta.last_row_id, picked.files, user, nowIso);
    if (statements.length) await env.DB.batch(statements);
    return home(project.id, date === project.today ? 'time-saved' : 'time-saved-other-day');
  }

  // ---- One log: change it, delete it, remove an attachment ----
  if ((m = path.match(/^\/va\/time\/entry\/(\d+)(?:\/(delete)|\/file\/(\d+)\/delete)?$/))) {
    const log = await env.DB.prepare(
      `SELECT l.*, tt.name AS type_name, u.name AS entered_by_name FROM time_logs l LEFT JOIN task_types tt ON tt.id = l.task_type_id
       LEFT JOIN users u ON u.id = l.entered_by WHERE l.id = ? AND l.user_id = ? AND l.deleted_at IS NULL`
    ).bind(Number(m[1]), user.id).first();
    if (!log) return home('', 'time-log-gone');
    const project = byId(log.project_id);
    const editable = mayLog(project, log.work_date);
    // A log of a project the VA no longer has (closed, or not on it any more) is shown read-only, with its own zone.
    const shown = project || await env.DB.prepare('SELECT id, client, name, is_coverage FROM projects WHERE id = ?').bind(log.project_id).first();
    if (!zones.has(String(log.project_id))) for (const [id, z] of await projectZones(env, [log.project_id])) zones.set(id, z);
    const backTo = url.searchParams.get('from') === 'hours' ? '/va/time/hours' : '';
    const files = (await filesOf(env, [log.id])).get(log.id) || [];
    const types = await allTypes(env);
    const show = (error, status = 200) => page(tv.entryPage({ user, log, project: shown, backTo, zone: zones.get(String(log.project_id)) || 'EST', types, files, editable, error, history: null }), status);
    if (method === 'GET' && !m[2] && !m[3]) {
      const { results: history } = await env.DB.prepare(
        'SELECT h.*, u.name AS user_name FROM time_log_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.log_id = ? ORDER BY h.id DESC LIMIT 50'
      ).bind(log.id).all();
      return page(tv.entryPage({ user, log, project: shown, backTo, zone: zones.get(String(log.project_id)) || 'EST', types, files, editable, message, history }));
    }
    if (method !== 'POST') return redirect(`/va/time/entry/${log.id}`);
    if (!editable) return show('This log can no longer be changed: time can be changed only on the day it was logged for. Ask an admin if something is wrong.', 403);

    if (m[2] === 'delete') {
      await env.DB.batch([
        env.DB.prepare('UPDATE time_logs SET deleted_at = ?, deleted_by = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(nowIso, user.id, log.id, user.id),
        historyRow(env, log.id, user, `Deleted the log (${log.type_name || 'no task type'}, ${tv.duration(log.minutes)})`, [{ f: 'deleted', from: null, to: nowIso }], nowIso),
      ]);
      return home(String(log.project_id), 'time-deleted');
    }
    if (m[3]) {
      const file = files.find((f) => f.id === Number(m[3]));
      if (file) {
        const full = await env.DB.prepare('SELECT file_key FROM time_log_files WHERE id = ? AND log_id = ?').bind(file.id, log.id).first();
        await env.DB.batch([
          env.DB.prepare('DELETE FROM time_log_files WHERE id = ? AND log_id = ?').bind(file.id, log.id),
          env.DB.prepare('UPDATE time_logs SET edited_at = ?, edited_by = ? WHERE id = ?').bind(nowIso, user.id, log.id),
          historyRow(env, log.id, user, `Removed the file "${file.file_name}"`, [{ f: 'file', from: file.file_name, to: null }], nowIso),
        ]);
        if (full?.file_key) await env.SOP_FILES.delete(full.file_key);
      }
      return redirect(`/va/time/entry/${log.id}?msg=time-file-removed`);
    }

    // Change: task type, description, minutes, new files. Stamps and dates never change.
    const type = types.find((t) => t.id === Number(field('task_type')) && (!t.hidden || t.id === log.task_type_id));
    if (!type) return show('Please choose what you worked on.', 400);
    const minutes = readMinutes(field);
    if (!minutes) return show('Please enter the time you worked (at least 1 minute, at most 24 hours).', 400);
    const picked = readFiles(form, files.length);
    if (picked.error) return show(picked.error, 400);
    const description = field('description').slice(0, 5000);
    const changes = [];
    if (type.id !== log.task_type_id) changes.push({ f: 'task_type', from: log.type_name || null, to: type.name });
    if (description !== log.description) changes.push({ f: 'description', from: log.description, to: description });
    if (minutes !== log.minutes) changes.push({ f: 'minutes', from: log.minutes, to: minutes });
    for (const f of picked.files) changes.push({ f: 'file', from: null, to: f.name.slice(0, 200) });
    if (!changes.length) return redirect(`/va/time/entry/${log.id}?msg=no-changes`);
    const words = { task_type: 'task type', description: 'description', minutes: 'time', file: 'files' };
    const summary = `Changed ${[...new Set(changes.map((c) => words[c.f]))].join(', ')}${changes.some((c) => c.f === 'minutes') ? ` (${tv.duration(log.minutes)} to ${tv.duration(minutes)})` : ''}`;
    const statements = [
      env.DB.prepare('UPDATE time_logs SET task_type_id = ?, description = ?, minutes = ?, edited_at = ?, edited_by = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .bind(type.id, description, minutes, nowIso, user.id, log.id, user.id),
      historyRow(env, log.id, user, summary, changes, nowIso),
      ...(await storeFiles(env, log.id, picked.files, user, nowIso)),
    ];
    await env.DB.batch(statements);
    return home(String(log.project_id), 'time-updated');
  }

  return home('');
}

// An attachment of a time log: only for the VA whose log it is, and for admins. PDFs and pictures open in the browser.
export async function timeFile(env, user, path) {
  const m = path.match(/^\/time-files\/(\d+)$/);
  const file = m ? await env.DB.prepare(
    'SELECT f.*, l.user_id FROM time_log_files f JOIN time_logs l ON l.id = f.log_id WHERE f.id = ?'
  ).bind(Number(m[1])).first() : null;
  if (!file || !(user.is_admin || file.user_id === user.id)) return new Response('Not found', { status: 404 });
  const object = await env.SOP_FILES.get(file.file_key);
  if (!object) return new Response('The file could not be found.', { status: 404 });
  const inline = /^(application\/pdf|image\/)/.test(file.file_type || '');
  return new Response(object.body, {
    headers: {
      'Content-Type': file.file_type || 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.file_name.replace(/[^\w .()-]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
