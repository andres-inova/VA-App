// The admin side of time logging (piece T4): the admin Time page (totals and charts across VAs, projects, clients
// and task types for a chosen range, the list of logs, CSV files), Packages (hours used in each project's current
// billing cycle), Exceptions (every past-date exception in one place) and Missed time (the missed_time table, filled
// each day from piece T5). Also the small "Time" box on a VA's record page and the package numbers on a project page.
//
// - Read-only for time logs: admins look at logs here; VAs change them on their Time page.
// - Days are work_date (the day in the project's time zone). "Today", "this week" ... count from the chosen project's
//   today, or from the admin's own time zone (else Eastern) when no project is chosen.
// - The totals come from two grouped queries (by VA + project + task type, and by day); the log list is paged.
// - Coverage rule for packages: time on a client's coverage projects counts toward that client's regular project with
//   a package (the oldest one, when the client has several), shown as a separate "incl. coverage" number.

import { redirect, page } from './util.js';
import { ZONES, partsIn, addDays, projectZones } from './time.js';
import { billingCycle, packageOn, addException, removeException } from './projects.js';
import { RANGES, billingDayOf, simpleRange, filesOfRow, buckets } from './timehours.js';
import { toCsv } from './lists.js';
import * as av from './timeadmin-views.js';

const PAGE_SIZE = 100;     // log rows per "Show more"
const MAX_SHOW = 2000;     // log rows on one page at most
const MAX_CSV = 10000;     // rows in one CSV file
const MAX_MISSED = 1000;   // missed-time rows on one page
const pad = (n) => String(n).padStart(2, '0');

const zoneToday = (zone, now = new Date()) => partsIn(ZONES[zone] || ZONES.EST, now).date;

// ---- Package usage (shared with the project page) ----

// Which regular project gets each client's coverage time: the oldest active, non-coverage project of the client
// that has a package. Map client record id -> project id.
export async function coverageOwners(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.client_record_id AS cid FROM projects p WHERE p.active = 1 AND p.is_coverage = 0 AND p.client_record_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM project_packages k WHERE k.project_id = p.id) ORDER BY p.rowid`
  ).all();
  const owners = new Map();
  for (const r of results) if (!owners.has(r.cid)) owners.set(r.cid, String(r.id));
  return owners;
}

// Minutes logged (all VAs) in each window { pid, start, end, cid }: the project's own time, and the time on the
// coverage projects of client cid (cid empty = no coverage counted). Returns [{ own, coverage }] in the same order.
export async function windowMinutes(env, windows) {
  const out = windows.map(() => ({ own: 0, coverage: 0 }));
  if (!windows.length) return out;
  const statements = [];
  const CHUNK = 18;  // 5 values per window; D1 takes at most 100 per query
  for (let i = 0; i < windows.length; i += CHUNK) {
    const part = windows.slice(i, i + CHUNK);
    const values = part.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const binds = part.flatMap((w, j) => [i + j, String(w.pid), w.start, w.end, w.cid ?? null]);
    statements.push(env.DB.prepare(
      `WITH w(k, pid, s, e, cid) AS (VALUES ${values})
       SELECT w.k, 0 AS cov, SUM(l.minutes) AS minutes FROM w JOIN time_logs l ON l.project_id = w.pid AND l.work_date BETWEEN w.s AND w.e
         WHERE l.deleted_at IS NULL GROUP BY w.k
       UNION ALL
       SELECT w.k, 1 AS cov, SUM(l.minutes) AS minutes FROM w JOIN projects c ON c.client_record_id = w.cid AND c.is_coverage = 1 AND c.id <> w.pid
         JOIN time_logs l ON l.project_id = c.id AND l.work_date BETWEEN w.s AND w.e WHERE l.deleted_at IS NULL GROUP BY w.k`
    ).bind(...binds));
  }
  for (const { results } of await env.DB.batch(statements)) {
    for (const r of results) out[r.k][r.cov ? 'coverage' : 'own'] += r.minutes || 0;
  }
  return out;
}

// The usage numbers of one cycle: { start, end, hours, own, coverage, used, pct, tone, fromNote }.
function usageOf(cycle, packages, mins, today) {
  let pkg = packageOn(packages, cycle.start), fromNote = '';
  // A package that started during the cycle (none on its first day) still counts, with a note.
  if (!pkg) {
    pkg = packageOn(packages, cycle.end < today ? cycle.end : today);
    if (pkg) fromNote = pkg.effective_from;
  }
  if (!pkg) return null;
  const used = mins.own + mins.coverage;
  const limit = Math.round(pkg.hours * 60);
  const pct = limit ? Math.round((used / limit) * 100) : used ? 999 : 0;
  return { ...cycle, hours: pkg.hours, limit, own: mins.own, coverage: mins.coverage, used, pct, tone: used > limit ? 'bad' : pct >= 80 ? 'warn' : '', fromNote };
}

// A project page's package numbers: this billing cycle and the last one (all VAs, plus coverage when counted).
export async function projectUsage(env, project, packages, today, billingDay) {
  const current = billingCycle(today, billingDay);
  const last = billingCycle(addDays(current.start, -1), billingDay);
  const owners = project.client_record_id && !project.is_coverage ? await coverageOwners(env) : new Map();
  const cid = owners.get(project.client_record_id) === String(project.id) ? project.client_record_id : null;
  const [a, b] = await windowMinutes(env, [{ pid: project.id, ...current, cid }, { pid: project.id, ...last, cid }]);
  return { current: usageOf(current, packages, a, today), last: usageOf(last, packages, b, today), coverageCounted: Boolean(cid) };
}

// ---- The VA record page's Time box ----

// Hours of a VA (login) this pay period and last, counted from the VA's own today.
export async function vaTimeSummary(env, login) {
  const today = zoneToday(ZONES[login.time_zone] ? login.time_zone : 'EST');
  const { results: periods } = await env.DB.prepare('SELECT start_date, end_date, pay_day FROM pay_periods ORDER BY start_date').all();
  const cur = simpleRange('pay', today, periods), prev = simpleRange('prevpay', today, periods);
  const from = prev.none ? cur.from : prev.from, to = cur.none ? prev.to : cur.to;
  let sums = { cur: 0, prev: 0 };
  if (from && to) {
    sums = await env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN work_date BETWEEN ?2 AND ?3 THEN minutes END), 0) AS cur,
         COALESCE(SUM(CASE WHEN work_date BETWEEN ?4 AND ?5 THEN minutes END), 0) AS prev
       FROM time_logs WHERE user_id = ?1 AND deleted_at IS NULL AND work_date BETWEEN ?6 AND ?7`
    ).bind(login.id, cur.from || '', cur.to || '', prev.from || '', prev.to || '', from, to).first();
  }
  return { userId: login.id, cur: cur.none ? null : { ...cur, minutes: sums.cur }, prev: prev.none ? null : { ...prev, minutes: sums.prev } };
}

// ---- The admin Time page ----

// Lookups (projects, people, task types, clients, pay periods) and the chosen filters and range.
async function setup(env, user, url, { allowCycle = true } = {}) {
  const now = new Date();
  const [{ results: projectRows }, { results: people }, { results: types }, { results: periods }] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.client, p.name, p.is_coverage, p.active, p.client_record_id, r.name AS client_name, ps.billing_day,
         CASE WHEN json_valid(r.data) THEN json_extract(r.data, '$.Invoice_Date') END AS invoice_date
       FROM projects p LEFT JOIN project_settings ps ON ps.project_id = p.id LEFT JOIN records r ON r.id = p.client_record_id AND r.module = 'clients'
       ORDER BY p.active DESC, p.is_coverage, p.client COLLATE NOCASE, p.name COLLATE NOCASE`
    ),
    env.DB.prepare('SELECT id, name, is_va, time_zone FROM users WHERE is_va = 1 OR id IN (SELECT DISTINCT user_id FROM time_logs) ORDER BY name COLLATE NOCASE'),
    env.DB.prepare('SELECT id, name, hidden FROM task_types ORDER BY position, id'),
    env.DB.prepare('SELECT start_date, end_date, pay_day FROM pay_periods ORDER BY start_date'),
  ]);
  const projects = projectRows.map((p) => ({ ...p, id: String(p.id) }));
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const clients = [...new Map(projects.filter((p) => p.client_record_id).map((p) => [p.client_record_id, { id: p.client_record_id, name: p.client_name || p.client }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));

  const q = url.searchParams;
  const project = byProject.get(q.get('project')) || null;
  const va = people.find((u) => u.id === Number(q.get('va'))) || null;
  const client = clients.find((c) => c.id === Number(q.get('client'))) || null;
  const type = types.find((t) => t.id === Number(q.get('type'))) || null;
  let kind = RANGES.includes(q.get('range')) ? q.get('range') : 'pay';
  if (kind === 'cycle' && !(project && allowCycle)) kind = 'pay';
  const myZone = ZONES[user.time_zone] ? user.time_zone : 'EST';
  let zone = myZone;
  if (project) zone = (await projectZones(env, [project.id])).get(project.id) || 'EST';
  const today = zoneToday(zone, now);

  let range;
  if (kind === 'cycle') {
    const c = billingCycle(today, billingDayOf(project));
    range = { from: c.start, to: c.end };
  } else range = simpleRange(kind, today, periods, q.get('from'), q.get('to'));

  let where = 'l.deleted_at IS NULL';
  const binds = [];
  if (range.none) where += ' AND 0';
  else { where += ' AND l.work_date BETWEEN ? AND ?'; binds.push(range.from, range.to); }
  if (va) { where += ' AND l.user_id = ?'; binds.push(va.id); }
  if (project) { where += ' AND l.project_id = ?'; binds.push(project.id); }
  if (client) { where += ' AND l.project_id IN (SELECT id FROM projects WHERE client_record_id = ?)'; binds.push(client.id); }
  if (type) { where += ' AND l.task_type_id = ?'; binds.push(type.id); }
  return { now, projects, byProject, people, types, periods, clients, project, va, client, type, kind, zone, myZone, today, range, where, binds };
}

// The log rows: newest first, with VA, task type, who entered it and the attachments (as JSON).
const logSql = (where) => `SELECT l.id, l.project_id, l.user_id, l.task_type_id, l.description, l.minutes, l.work_date, l.entered_at, l.edited_at, l.source,
    tt.name AS type_name, u.name AS entered_by_name, v.name AS va_name,
    (SELECT json_group_array(json_object('id', f.id, 'name', f.file_name)) FROM time_log_files f WHERE f.log_id = l.id) AS files
  FROM time_logs l LEFT JOIN task_types tt ON tt.id = l.task_type_id LEFT JOIN users u ON u.id = l.entered_by LEFT JOIN users v ON v.id = l.user_id
  WHERE ${where} ORDER BY l.work_date DESC, l.entered_at DESC, l.id DESC LIMIT ?`;

const clientKey = (p) => (p?.client_record_id ? `c${p.client_record_id}` : `n${p?.client || ''}`);
const clientLabel = (p) => (p?.client_record_id ? p.client_name || p.client : `${p?.client || 'No client'} (no client record)`);

// The totals: by VA, project, client, task type and day (from the two grouped queries).
function summarize(s, agg, perDayRows) {
  const people = new Map(s.people.map((u) => [u.id, u.name]));
  const typeNames = new Map(s.types.map((t) => [t.id, t.name]));
  let total = 0, count = 0;
  const add = (map, key, name, minutes) => { const r = map.get(key) || { key, name, minutes: 0 }; r.minutes += minutes; map.set(key, r); };
  const byVa = new Map(), byProject = new Map(), byClient = new Map(), byType = new Map();
  for (const r of agg) {
    total += r.minutes; count += r.n;
    const p = s.byProject.get(String(r.project_id));
    add(byVa, r.user_id, people.get(r.user_id) || `User ${r.user_id}`, r.minutes);
    add(byProject, String(r.project_id), p ? av.projectName(p) : `Project ${r.project_id}`, r.minutes);
    add(byClient, clientKey(p), clientLabel(p), r.minutes);
    add(byType, r.task_type_id || 0, typeNames.get(r.task_type_id) || 'General', r.minutes);
  }
  const sorted = (map) => [...map.values()].sort((a, b) => b.minutes - a.minutes || String(a.name).localeCompare(String(b.name)));
  const perDay = new Map(perDayRows.map((r) => [r.work_date, r.minutes]));
  const chart = !s.range.none && s.range.from !== s.range.to ? buckets(s.range.from, s.range.to, perDay) : null;
  return { total, count, vaRows: sorted(byVa), projectRows: sorted(byProject), clientRows: sorted(byClient), typeRows: sorted(byType), chart };
}

const csvResponse = (csv, name) => new Response(csv, {
  headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' },
});
const rangeName = (range) => (range.none ? 'none' : `${range.from}-to-${range.to}`);
const hours2 = (minutes) => Math.round((minutes / 60) * 100) / 100;

async function timePage(env, user, path, url, message) {
  const s = await setup(env, user, url);

  // ---- The logs as a CSV file ----
  if (path === '/admin/time.csv') {
    const { results } = await env.DB.prepare(logSql(s.where)).bind(...s.binds, MAX_CSV).all();
    const zones = await projectZones(env, results.map((l) => l.project_id));
    return csvResponse(toCsv([
      ['Date', 'VA', 'Project', 'Client', 'Task type', 'Description', 'Time', 'Hours', 'Minutes', 'Entered', 'Time zone', 'Entered by', 'Files'],
      ...results.map((l) => {
        const p = s.byProject.get(String(l.project_id));
        const zone = zones.get(String(l.project_id)) || 'EST';
        const at = partsIn(ZONES[zone], new Date(l.entered_at));
        return [l.work_date, l.va_name || '', p ? av.projectName(p) : String(l.project_id), p ? clientLabel(p) : '', l.type_name || 'General', l.description || '',
          av.hm(l.minutes), hours2(l.minutes), l.minutes, `${at.date} ${pad(at.hour)}:${pad(at.minute)}`, zone, l.entered_by_name || '', filesOfRow(l).map((f) => f.name).join('; ')];
      }),
    ]), `time-logs-${rangeName(s.range)}.csv`);
  }

  const groupSql = `SELECT l.user_id, l.project_id, l.task_type_id, SUM(l.minutes) AS minutes, COUNT(*) AS n FROM time_logs l WHERE ${s.where} GROUP BY l.user_id, l.project_id, l.task_type_id`;
  const daySql = `SELECT l.work_date, SUM(l.minutes) AS minutes FROM time_logs l WHERE ${s.where} GROUP BY l.work_date`;

  // ---- The summary as a CSV file ----
  if (path === '/admin/time/summary.csv') {
    const [agg, days] = await env.DB.batch([env.DB.prepare(groupSql).bind(...s.binds), env.DB.prepare(daySql).bind(...s.binds)]);
    const sum = summarize(s, agg.results, days.results);
    const share = (m) => (sum.total ? Math.round((m / sum.total) * 1000) / 10 : 0);
    const rows = [['Group', 'Name', 'Time', 'Hours', 'Minutes', 'Share %'], ['Total', 'All', av.hm(sum.total), hours2(sum.total), sum.total, sum.total ? 100 : 0]];
    for (const [group, list] of [['VA', sum.vaRows], ['Project', sum.projectRows], ['Client', sum.clientRows], ['Task type', sum.typeRows]]) {
      for (const r of list) rows.push([group, r.name, av.hm(r.minutes), hours2(r.minutes), r.minutes, share(r.minutes)]);
    }
    if (sum.chart) for (const b of sum.chart.list) rows.push([sum.chart.size === 'day' ? 'Day' : sum.chart.size === 'week' ? 'Week of' : 'Month', b.key, av.hm(b.minutes), hours2(b.minutes), b.minutes, share(b.minutes)]);
    rows.push([], ['Range', s.range.none ? s.range.none : `${s.range.from} to ${s.range.to}`],
      ['Filters', [s.va && `VA: ${s.va.name}`, s.project && `Project: ${av.projectName(s.project)}`, s.client && `Client: ${s.client.name}`, s.type && `Task type: ${s.type.name}`].filter(Boolean).join('; ') || 'None']);
    return csvResponse(toCsv(rows), `time-summary-${rangeName(s.range)}.csv`);
  }

  // ---- The page ----
  const show = Math.min(MAX_SHOW, Math.max(PAGE_SIZE, Math.ceil((Number(url.searchParams.get('show')) || PAGE_SIZE) / PAGE_SIZE) * PAGE_SIZE));
  const [agg, days, list] = await env.DB.batch([
    env.DB.prepare(groupSql).bind(...s.binds),
    env.DB.prepare(daySql).bind(...s.binds),
    env.DB.prepare(logSql(s.where)).bind(...s.binds, show + 1),
  ]);
  const sum = summarize(s, agg.results, days.results);
  const shown = list.results.slice(0, show);
  const zones = await projectZones(env, shown.map((l) => l.project_id));
  const logs = shown.map((l) => ({ ...l, fileList: filesOfRow(l), project: s.byProject.get(String(l.project_id)), zone: zones.get(String(l.project_id)) || 'EST' }));
  return page(av.timePage({ user, message, s, sum, logs, more: list.results.length > show, show, query: url.searchParams }));
}

// ---- One log, read-only, with its change history ----

async function logView(env, user, id, url, message) {
  const log = await env.DB.prepare(
    `SELECT l.*, tt.name AS type_name, u.name AS entered_by_name, v.name AS va_name, d.name AS deleted_by_name,
       p.client, p.name AS project_name, p.is_coverage, p.active
     FROM time_logs l LEFT JOIN task_types tt ON tt.id = l.task_type_id LEFT JOIN users u ON u.id = l.entered_by
     LEFT JOIN users v ON v.id = l.user_id LEFT JOIN users d ON d.id = l.deleted_by LEFT JOIN projects p ON p.id = l.project_id WHERE l.id = ?`
  ).bind(id).first();
  if (!log) return redirect('/admin/time?msg=time-log-gone');
  const [{ results: files }, { results: history }] = await env.DB.batch([
    env.DB.prepare('SELECT id, file_name, file_size FROM time_log_files WHERE log_id = ? ORDER BY id').bind(log.id),
    env.DB.prepare('SELECT h.*, u.name AS user_name FROM time_log_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.log_id = ? ORDER BY h.id DESC LIMIT 100').bind(log.id),
  ]);
  const zone = (await projectZones(env, [log.project_id])).get(String(log.project_id)) || 'EST';
  const back = url.searchParams.get('back') || '';
  const backTo = /^\/admin\/time(\/[a-z]+)?(\?[\w=&%.+-]*)?$/.test(back) ? back : '/admin/time';
  return page(av.logPage({ user, message, log, files, history, zone, backTo }));
}

// ---- Packages: hours used in each project's current billing cycle ----

async function packagesPage(env, user, message) {
  const { results: rows } = await env.DB.prepare(
    `SELECT p.id, p.client, p.name, p.is_coverage, p.active, p.client_record_id, r.name AS client_name, ps.billing_day,
       CASE WHEN json_valid(r.data) THEN json_extract(r.data, '$.Invoice_Date') END AS invoice_date,
       (SELECT group_concat(u.name, ', ') FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.project_id = p.id AND u.is_va = 1) AS vas
     FROM projects p LEFT JOIN project_settings ps ON ps.project_id = p.id LEFT JOIN records r ON r.id = p.client_record_id AND r.module = 'clients'
     WHERE p.active = 1 AND EXISTS (SELECT 1 FROM project_packages k WHERE k.project_id = p.id)`
  ).all();
  const projects = rows.map((p) => ({ ...p, id: String(p.id) }));
  const ids = projects.map((p) => p.id);
  const zones = ids.length ? await projectZones(env, ids) : new Map();
  const packages = new Map();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT project_id, hours, effective_from FROM project_packages WHERE project_id IN (${part.map(() => '?').join(',')}) ORDER BY effective_from`).bind(...part).all();
    for (const k of results) { const key = String(k.project_id); if (!packages.has(key)) packages.set(key, []); packages.get(key).push(k); }
  }
  const owners = await coverageOwners(env);
  const windows = projects.map((p) => {
    const zone = zones.get(p.id) || 'EST';
    const today = zoneToday(zone);
    const cycle = billingCycle(today, billingDayOf(p));
    return { p, zone, today, pid: p.id, start: cycle.start, end: cycle.end, cid: !p.is_coverage && owners.get(p.client_record_id) === p.id ? p.client_record_id : null };
  });
  const minutes = await windowMinutes(env, windows);
  const list = windows.map((w, i) => ({ project: w.p, zone: w.zone, coverageCounted: Boolean(w.cid), usage: usageOf({ start: w.start, end: w.end }, packages.get(w.pid) || [], minutes[i], w.today) }))
    .filter((r) => r.usage)
    .sort((a, b) => b.usage.pct - a.usage.pct || av.projectName(a.project).localeCompare(av.projectName(b.project)));
  return page(av.packagesPage({ user, message, list }));
}

// ---- Exceptions: every past-date exception, added and removed in one place ----

async function exceptionsPage(env, user, path, method, field, message) {
  const now = new Date().toISOString();
  let m;
  if (method === 'POST' && path === '/admin/time/exceptions') {
    const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(field('project_id')).first();
    if (!project) return redirect('/admin/time/exceptions?msg=exception-bad#add');
    const ok = await addException(env, user, project, field, now);
    return redirect(`/admin/time/exceptions?msg=${ok ? 'exception-added' : 'exception-bad'}${ok ? '' : '#add'}`);
  }
  if (method === 'POST' && (m = path.match(/^\/admin\/time\/exceptions\/(\d+)\/delete$/))) {
    const project = await env.DB.prepare('SELECT p.* FROM log_exceptions e JOIN projects p ON p.id = e.project_id WHERE e.id = ?').bind(Number(m[1])).first();
    if (project) await removeException(env, user, project, Number(m[1]), now);
    return redirect('/admin/time/exceptions?msg=removed');
  }
  if (method !== 'GET') return redirect('/admin/time/exceptions');
  const [{ results: exceptions }, { results: vas }, { results: projects }] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.*, u.name AS va_name, a.name AS approved_by_name, p.client, p.name AS project_name, p.is_coverage, p.active,
         EXISTS (SELECT 1 FROM assignments x WHERE x.project_id = e.project_id AND x.user_id = e.user_id) AS on_project
       FROM log_exceptions e JOIN users u ON u.id = e.user_id LEFT JOIN users a ON a.id = e.approved_by LEFT JOIN projects p ON p.id = e.project_id
       ORDER BY e.approved_at DESC, e.id DESC LIMIT 500`
    ),
    env.DB.prepare('SELECT id, name FROM users WHERE is_va = 1 ORDER BY name COLLATE NOCASE'),
    env.DB.prepare('SELECT id, client, name, is_coverage, active FROM projects WHERE active = 1 ORDER BY is_coverage, client COLLATE NOCASE, name COLLATE NOCASE'),
  ]);
  return page(av.exceptionsPage({ user, message, exceptions, vas, projects: projects.map((p) => ({ ...p, id: String(p.id) })), today: zoneToday(ZONES[user.time_zone] ? user.time_zone : 'EST') }));
}

// ---- Missed time: days a VA logged less than the daily minimum in a project ----

async function missedPage(env, user, path, url, message) {
  const s = await setup(env, user, url, { allowCycle: false });
  let where = '1';
  const binds = [];
  if (s.range.none) where += ' AND 0';
  else { where += ' AND m.work_date BETWEEN ? AND ?'; binds.push(s.range.from, s.range.to); }
  if (s.va) { where += ' AND m.user_id = ?'; binds.push(s.va.id); }
  if (s.project) { where += ' AND m.project_id = ?'; binds.push(s.project.id); }
  const listSql = `SELECT m.*, u.name AS va_name FROM missed_time m LEFT JOIN users u ON u.id = m.user_id WHERE ${where}
    ORDER BY m.work_date DESC, u.name COLLATE NOCASE LIMIT ?`;
  if (path === '/admin/time/missed.csv') {
    const { results } = await env.DB.prepare(listSql).bind(...binds, MAX_CSV).all();
    return csvResponse(toCsv([
      ['Date', 'VA', 'Project', 'Minutes logged', 'Minimum (minutes)', 'Short by (minutes)', 'VA notified'],
      ...results.map((r) => {
        const p = s.byProject.get(String(r.project_id));
        return [r.work_date, r.va_name || '', p ? av.projectName(p) : String(r.project_id), r.minutes_logged, r.minimum, Math.max(0, r.minimum - r.minutes_logged), r.notified_at ? `Yes (${r.notified_at.slice(0, 16).replace('T', ' ')} UTC)` : 'No'];
      }),
    ]), `missed-time-${rangeName(s.range)}.csv`);
  }
  const [{ results: rows }, { results: perVa }, total] = await env.DB.batch([
    env.DB.prepare(listSql).bind(...binds, MAX_MISSED + 1),
    env.DB.prepare(`SELECT m.user_id, u.name AS va_name, COUNT(DISTINCT m.work_date) AS days, COUNT(*) AS n FROM missed_time m LEFT JOIN users u ON u.id = m.user_id
      WHERE ${where} GROUP BY m.user_id ORDER BY days DESC, u.name COLLATE NOCASE`).bind(...binds),
    env.DB.prepare('SELECT COUNT(*) AS n FROM missed_time'),
  ]);
  return page(av.missedPage({ user, message, s, rows: rows.slice(0, MAX_MISSED), more: rows.length > MAX_MISSED, perVa, everAny: total.results[0]?.n > 0, query: url.searchParams }));
}

// Handles /admin/time, /admin/time.csv and /admin/time/... (admins only; checked in index.js).
export async function adminTimeRoutes(env, user, path, method, field, message, url) {
  let m;
  if (path === '/admin/time' || path === '/admin/time.csv' || path === '/admin/time/summary.csv') return method === 'GET' ? timePage(env, user, path, url, message) : redirect('/admin/time');
  if ((m = path.match(/^\/admin\/time\/log\/(\d+)$/))) return logView(env, user, Number(m[1]), url, message);
  if (path === '/admin/time/packages') return packagesPage(env, user, message);
  if (path === '/admin/time/exceptions' || /^\/admin\/time\/exceptions\/\d+\/delete$/.test(path)) return exceptionsPage(env, user, path, method, field, message);
  if (path === '/admin/time/missed' || path === '/admin/time/missed.csv') return missedPage(env, user, path, url, message);
  return redirect('/admin/time');
}

