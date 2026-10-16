// "My hours" for a VA (time logging piece T3): totals, charts and the full history of their own time logs for a
// chosen range (today, a pay period, a billing cycle, this week, this month or two dates), for all projects or one,
// plus a CSV download. Read-only: logs are changed on the Time page (timelog.js).
//
// - Only the VA's own logs, never anyone else's. Every project they ever logged time on is included (also closed
//   projects, coverage projects and projects they are no longer on), plus their current projects.
// - Days are work_date: the day in the project's own time zone. "Today", "this week" and so on are counted from the
//   chosen project's today, or from the VA's own time zone when "All projects" is chosen.
// - A billing cycle belongs to a project (its billing day). With "All projects", each project counts its own current
//   cycle.
// - The totals come from one SUM/GROUP BY query; the history list is paged ("Show more").

import { page, isDate } from './util.js';
import { ZONES, partsIn, addDays, weekdayOf, weekdayIndex, projectZones } from './time.js';
import { billingCycle, packageOn, invoiceDay } from './projects.js';
import { toCsv } from './lists.js';
import * as hv from './timehours-views.js';

export const RANGES = ['today', 'pay', 'prevpay', 'cycle', 'week', 'month', 'custom'];
const PAGE_SIZE = 100;        // history rows per "Show more"
const MAX_SHOW = 2000;        // history rows on one page at most
const MAX_DAYS = 366;         // longest range
const MAX_CSV = 10000;        // rows in one CSV file
const MAX_WINDOWS = 30;       // projects with their own billing cycle in one query (3 values each; D1 takes 100)

const pad = (n) => String(n).padStart(2, '0');
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// The billing day of a project row: saved, else the client's first Invoice date, else the 1st.
function billingDayOf(row) {
  if (row.billing_day >= 1 && row.billing_day <= 28) return row.billing_day;
  let value = row.invoice_date;
  if (typeof value === 'string' && value.startsWith('[')) { try { value = JSON.parse(value); } catch { /* plain text */ } }
  return invoiceDay(value) || 1;
}

// The dates of a range kind, counted from "today". Returns { from, to, note? } or { none: text }.
function simpleRange(kind, today, periods, from, to) {
  if (kind === 'today') return { from: today, to: today };
  if (kind === 'week') {  // Monday to Sunday
    const start = addDays(today, -((weekdayIndex(weekdayOf(today)) + 6) % 7));
    return { from: start, to: addDays(start, 6) };
  }
  if (kind === 'month') {
    const [y, m] = today.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
    return { from: `${today.slice(0, 7)}-01`, to: addDays(next, -1) };
  }
  if (kind === 'pay' || kind === 'prevpay') {
    const at = periods.findIndex((p) => p.start_date <= today && today <= p.end_date);
    const index = kind === 'pay' ? at : at >= 0 ? at - 1 : periods.filter((p) => p.end_date < today).length - 1;
    const p = periods[index];
    if (!p) return { none: kind === 'pay' ? 'No pay period covers today. An admin adds pay periods in Settings > Pay periods.' : 'There is no earlier pay period in the list.' };
    return { from: p.start_date, to: p.end_date, payDay: p.pay_day };
  }
  // Custom: two dates (swapped when needed), at most a year.
  let a = isDate(from) ? from : addDays(today, -6), b = isDate(to) ? to : today;
  if (a > b) [a, b] = [b, a];
  if (daysBetween(a, b) >= MAX_DAYS) return { from: a, to: addDays(a, MAX_DAYS - 1), note: 'A range can be at most one year, so it ends a year after the first day.' };
  return { from: a, to: b };
}

// Everything the page and the CSV need: the VA's projects, the chosen range and the SQL to find its logs.
async function setup(env, user, url) {
  const now = new Date();
  const [{ results: rows }, { results: periods }] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.client, p.name, p.is_coverage, p.active, ps.billing_day,
         CASE WHEN json_valid(r.data) THEN json_extract(r.data, '$.Invoice_Date') END AS invoice_date,
         (SELECT MAX(l.work_date) FROM time_logs l WHERE l.project_id = p.id AND l.user_id = ?1 AND l.deleted_at IS NULL) AS last_log
       FROM projects p LEFT JOIN project_settings ps ON ps.project_id = p.id LEFT JOIN records r ON r.id = p.client_record_id AND r.module = 'clients'
       WHERE p.id IN (SELECT project_id FROM time_logs WHERE user_id = ?1 AND deleted_at IS NULL)
          OR (p.active = 1 AND p.id IN (SELECT project_id FROM assignments WHERE user_id = ?1))
       ORDER BY p.active DESC, p.is_coverage, p.client COLLATE NOCASE`
    ).bind(user.id),
    env.DB.prepare('SELECT start_date, end_date, pay_day FROM pay_periods ORDER BY start_date'),
  ]);
  const zones = rows.length ? await projectZones(env, rows.map((p) => p.id)) : new Map();
  const projects = rows.map((p) => {
    const zone = zones.get(String(p.id)) || 'EST';
    const today = partsIn(ZONES[zone], now).date;
    return { ...p, id: String(p.id), zone, today, billingDay: billingDayOf(p), cycle: billingCycle(today, billingDayOf(p)) };
  });

  const q = url.searchParams;
  const kind = RANGES.includes(q.get('range')) ? q.get('range') : 'pay';
  const project = projects.find((p) => p.id === q.get('project')) || null;
  const myZone = ZONES[user.time_zone] ? user.time_zone : 'EST';
  const today = project ? project.today : partsIn(ZONES[myZone], now).date;

  let range, windows = null;
  if (kind === 'cycle' && project) {
    range = { from: project.cycle.start, to: project.cycle.end };
  } else if (kind === 'cycle') {
    // Each project's own current cycle. Projects without a log since their cycle started add nothing, so they are left out.
    windows = projects.filter((p) => p.last_log && p.last_log >= p.cycle.start)
      .sort((a, b) => (a.last_log < b.last_log ? 1 : -1)).slice(0, MAX_WINDOWS);
    range = windows.length
      ? { from: windows.reduce((m, p) => (p.cycle.start < m ? p.cycle.start : m), windows[0].cycle.start), to: windows.reduce((m, p) => (p.cycle.end > m ? p.cycle.end : m), windows[0].cycle.end) }
      : { from: today, to: today };
  } else {
    range = simpleRange(kind, today, periods, q.get('from'), q.get('to'));
  }

  // The WHERE part for the VA's logs in the range (and the values for it).
  let where = 'l.user_id = ? AND l.deleted_at IS NULL';
  const binds = [user.id];
  if (range.none) {
    where += ' AND 0';
  } else if (windows) {
    where += ' AND l.work_date BETWEEN ? AND ?';
    binds.push(range.from, range.to);
    if (windows.length) {
      where += ` AND (${windows.map(() => '(l.project_id = ? AND l.work_date BETWEEN ? AND ?)').join(' OR ')})`;
      for (const p of windows) binds.push(p.id, p.cycle.start, p.cycle.end);
    } else where += ' AND 0';
  } else {
    where += ' AND l.work_date BETWEEN ? AND ?';
    binds.push(range.from, range.to);
    if (project) { where += ' AND l.project_id = ?'; binds.push(project.id); }
  }
  return { now, projects, periods, kind, project, myZone, today, range, windows, where, binds };
}

// The history rows: newest first, with task type, who entered it and the attachments (as JSON).
const historySql = (where) => `SELECT l.id, l.project_id, l.task_type_id, l.description, l.minutes, l.work_date, l.entered_at, l.edited_at, l.source,
    tt.name AS type_name, u.name AS entered_by_name,
    (SELECT json_group_array(json_object('id', f.id, 'name', f.file_name)) FROM time_log_files f WHERE f.log_id = l.id) AS files
  FROM time_logs l LEFT JOIN task_types tt ON tt.id = l.task_type_id LEFT JOIN users u ON u.id = l.entered_by
  WHERE ${where} ORDER BY l.work_date DESC, l.entered_at DESC, l.id DESC LIMIT ?`;

const filesOfRow = (row) => { try { return JSON.parse(row.files || '[]').filter((f) => f && f.id); } catch { return []; } };

// Chart buckets: every day of a range up to 31 days, else weeks (from Monday) up to 4 months, else months.
function buckets(from, to, byDay) {
  const days = daysBetween(from, to) + 1;
  const size = days <= 31 ? 'day' : days <= 124 ? 'week' : 'month';
  const keyOf = (d) => (size === 'day' ? d : size === 'week' ? addDays(d, -((weekdayIndex(weekdayOf(d)) + 6) % 7)) : d.slice(0, 7));
  const list = [];
  const at = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const key = keyOf(d);
    if (!at.has(key)) { at.set(key, { key, minutes: 0 }); list.push(at.get(key)); }
  }
  for (const [d, minutes] of byDay) { const b = at.get(keyOf(d)); if (b) b.minutes += minutes; }
  return { size, list };
}

export async function hoursRoutes(env, user, path, url, message) {
  const s = await setup(env, user, url);
  const byProject = new Map(s.projects.map((p) => [p.id, p]));

  // ---- The CSV file ----
  if (path === '/va/time/hours.csv') {
    const { results } = await env.DB.prepare(historySql(s.where)).bind(...s.binds, MAX_CSV).all();
    const zoneOf = (id) => byProject.get(String(id))?.zone || 'EST';
    const csv = toCsv([
      ['Date', 'Project', 'Task type', 'Description', 'Time', 'Hours', 'Minutes', 'Entered', 'Time zone', 'Entered by', 'Files'],
      ...results.map((l) => {
        const p = byProject.get(String(l.project_id));
        const zone = zoneOf(l.project_id);
        const at = partsIn(ZONES[zone], new Date(l.entered_at));
        return [l.work_date, p ? hv.projectName(p) : String(l.project_id), l.type_name || 'General', l.description || '',
          hv.hm(l.minutes), Math.round((l.minutes / 60) * 100) / 100, l.minutes, `${at.date} ${pad(at.hour)}:${pad(at.minute)}`, zone,
          l.entered_by_name || '', filesOfRow(l).map((f) => f.name).join('; ')];
      }),
    ]);
    const name = s.range.none ? 'none' : `${s.range.from}-to-${s.range.to}`;
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="my-hours-${name}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // ---- The page ----
  const show = Math.min(MAX_SHOW, Math.max(PAGE_SIZE, Math.ceil((Number(url.searchParams.get('show')) || PAGE_SIZE) / PAGE_SIZE) * PAGE_SIZE));
  const statements = [
    env.DB.prepare(`SELECT l.project_id, l.work_date, l.task_type_id, SUM(l.minutes) AS minutes, COUNT(*) AS n FROM time_logs l
      WHERE ${s.where} GROUP BY l.project_id, l.work_date, l.task_type_id`).bind(...s.binds),
    env.DB.prepare(historySql(s.where)).bind(...s.binds, show + 1),
    env.DB.prepare('SELECT id, name FROM task_types'),
  ];
  // One project: its package in this billing cycle (the package in effect on the cycle's first day).
  if (s.project) {
    statements.push(
      env.DB.prepare('SELECT hours, effective_from FROM project_packages WHERE project_id = ? ORDER BY effective_from').bind(s.project.id),
      env.DB.prepare('SELECT COALESCE(SUM(minutes), 0) AS minutes FROM time_logs WHERE user_id = ? AND project_id = ? AND deleted_at IS NULL AND work_date BETWEEN ? AND ?')
        .bind(user.id, s.project.id, s.project.cycle.start, s.project.cycle.end),
    );
  }
  const [agg, hist, types, packages, cycleSum] = await env.DB.batch(statements);
  const typeNames = new Map(types.results.map((t) => [t.id, t.name]));

  let total = 0, count = 0;
  const perProject = new Map(), perType = new Map(), perDay = new Map();
  for (const r of agg.results) {
    total += r.minutes; count += r.n;
    const pid = String(r.project_id);
    perProject.set(pid, (perProject.get(pid) || 0) + r.minutes);
    const type = typeNames.get(r.task_type_id) || 'General';
    perType.set(type, (perType.get(type) || 0) + r.minutes);
    perDay.set(r.work_date, (perDay.get(r.work_date) || 0) + r.minutes);
  }
  const sorted = (map, name) => [...map].map(([key, minutes]) => ({ key, name: name(key), minutes })).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  const projectRows = sorted(perProject, (id) => (byProject.get(id) ? hv.projectName(byProject.get(id)) : `Project ${id}`))
    .map((r) => ({ ...r, cycle: s.windows ? byProject.get(r.key)?.cycle : null }));
  const typeRows = sorted(perType, (t) => t);
  const chart = !s.range.none && s.range.from !== s.range.to ? buckets(s.range.from, s.range.to, perDay) : null;

  const logs = hist.results.slice(0, show).map((l) => ({ ...l, fileList: filesOfRow(l), project: byProject.get(String(l.project_id)) }));
  let pkg = null;
  if (s.project) {
    const current = packageOn(packages.results, s.project.cycle.start);
    if (current) pkg = { hours: current.hours, minutes: cycleSum.results[0]?.minutes || 0, cycle: s.project.cycle };
  }

  return page(hv.hoursPage({
    user, message, projects: s.projects, project: s.project, kind: s.kind, range: s.range, today: s.today, myZone: s.myZone,
    windows: s.windows, total, count, projectRows, typeRows, chart, logs, more: hist.results.length > show, show, pkg,
    query: url.searchParams, perDay,
  }));
}
