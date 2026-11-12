// The client's Time page (client portal, piece C2): every time log on the client's projects (their VAs, including
// coverage), read-only, with hours used against each project's package this billing cycle, totals, bars and a list.
// Clicking a log opens it with its description. A client sees only their own client's projects, never other clients',
// never VAs' other clients, and never attachments, change history or Zoho details.
//
// - Ranges: this billing cycle, last billing cycle (each project uses its own billing day), this month, last month,
//   or two dates (up to a year). Days are work_date: the day in the project's time zone.
// - Deleted logs are never shown or counted.

import { redirect, page } from './util.js';
import { ZONES, partsIn, addDays, projectZones } from './time.js';
import { billingCycle } from './projects.js';
import { billingDayOf, simpleRange, buckets } from './timehours.js';
import { windowMinutes, coverageOwners, usageOf } from './timeadmin.js';
import * as cv from './client-time-views.js';

const PAGE_SIZE = 100;
const MAX_SHOW = 2000;
const MAX_PROJECTS = 25;   // projects with their own billing cycle in one query (3 values each; D1 takes 100)
const pad = (n) => String(n).padStart(2, '0');
export const KINDS = ['cycle', 'lastcycle', 'month', 'prevmonth', 'custom'];

async function setup(env, client, url) {
  const now = new Date();
  const { results: rows } = await env.DB.prepare(
    `SELECT p.id, p.client, p.name, p.is_coverage, p.active, p.client_record_id, ps.billing_day,
       CASE WHEN json_valid(r.data) THEN json_extract(r.data, '$.Invoice_Date') END AS invoice_date
     FROM projects p LEFT JOIN project_settings ps ON ps.project_id = p.id LEFT JOIN records r ON r.id = p.client_record_id AND r.module = 'clients'
     WHERE p.client_record_id = ?1 AND (p.active = 1 OR EXISTS (SELECT 1 FROM time_logs l WHERE l.project_id = p.id AND l.deleted_at IS NULL))
     ORDER BY p.active DESC, p.is_coverage, p.name COLLATE NOCASE LIMIT ${MAX_PROJECTS}`
  ).bind(client.id).all();
  const zones = rows.length ? await projectZones(env, rows.map((p) => p.id)) : new Map();
  const projects = rows.map((p) => {
    const zone = zones.get(String(p.id)) || 'EST';
    const today = partsIn(ZONES[zone], now).date;
    const day = billingDayOf(p);
    const cycle = billingCycle(today, day);
    return { ...p, id: String(p.id), zone, today, billingDay: day, cycle, last: billingCycle(addDays(cycle.start, -1), day) };
  });
  const q = url.searchParams;
  const kind = KINDS.includes(q.get('range')) ? q.get('range') : 'cycle';
  const project = projects.find((p) => p.id === q.get('project')) || null;
  const main = projects.find((p) => p.active && !p.is_coverage) || projects[0];
  const today = (project || main)?.today || partsIn(ZONES.EST, now).date;

  const chosen = project ? [project] : projects;
  let where = 'l.deleted_at IS NULL';
  const binds = [];
  let range;
  if (!chosen.length) { range = { from: today, to: today }; where += ' AND 0'; }
  else if (kind === 'cycle' || kind === 'lastcycle') {
    const cyc = (p) => (kind === 'cycle' ? p.cycle : p.last);
    range = { from: chosen.reduce((m, p) => (cyc(p).start < m ? cyc(p).start : m), cyc(chosen[0]).start), to: chosen.reduce((m, p) => (cyc(p).end > m ? cyc(p).end : m), cyc(chosen[0]).end), perProject: chosen.length > 1 };
    where += ` AND (${chosen.map(() => '(l.project_id = ? AND l.work_date BETWEEN ? AND ?)').join(' OR ')})`;
    for (const p of chosen) binds.push(p.id, cyc(p).start, cyc(p).end);
  } else {
    if (kind === 'month') {
      const [y, m] = today.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
      range = { from: `${today.slice(0, 7)}-01`, to: addDays(next, -1) };
    } else if (kind === 'prevmonth') {
      const first = `${today.slice(0, 7)}-01`;
      const last = addDays(first, -1);
      range = { from: `${last.slice(0, 7)}-01`, to: last };
    } else range = simpleRange('custom', today, [], q.get('from'), q.get('to'));
    where += ` AND l.work_date BETWEEN ? AND ? AND l.project_id IN (${chosen.map(() => '?').join(',')})`;
    binds.push(range.from, range.to, ...chosen.map((p) => p.id));
  }
  return { now, projects, project, kind, today, range, where, binds };
}

// The package cards: hours used this billing cycle for each active project that has a package.
async function packageCards(env, projects) {
  const active = projects.filter((p) => p.active && !p.is_coverage);
  if (!active.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT project_id, hours, effective_from FROM project_packages WHERE project_id IN (${active.map(() => '?').join(',')}) ORDER BY effective_from`
  ).bind(...active.map((p) => p.id)).all();
  const owners = await coverageOwners(env);
  const windows = active.map((p) => ({ pid: p.id, start: p.cycle.start, end: p.cycle.end, cid: owners.get(p.client_record_id) === p.id ? p.client_record_id : null }));
  const minutes = await windowMinutes(env, windows);
  return active.map((p, i) => ({ project: p, usage: usageOf(p.cycle, results.filter((k) => String(k.project_id) === p.id), minutes[i], p.today) })).filter((c) => c.usage);
}

export async function clientTimeRoutes(env, user, client, path, url, message) {
  let m;
  if ((m = path.match(/^\/client\/time\/log\/(\d+)$/))) return logView(env, user, client, Number(m[1]), url, message);
  if (path !== '/client/time') return redirect('/client/time');

  const s = await setup(env, client, url);
  const show = Math.min(MAX_SHOW, Math.max(PAGE_SIZE, Math.ceil((Number(url.searchParams.get('show')) || PAGE_SIZE) / PAGE_SIZE) * PAGE_SIZE));
  const [agg, days, list] = await env.DB.batch([
    env.DB.prepare(`SELECT l.user_id, v.name AS va, l.project_id, l.task_type_id, tt.name AS type_name, SUM(l.minutes) AS minutes, COUNT(*) AS n
      FROM time_logs l LEFT JOIN users v ON v.id = l.user_id LEFT JOIN task_types tt ON tt.id = l.task_type_id WHERE ${s.where}
      GROUP BY l.user_id, l.project_id, l.task_type_id`).bind(...s.binds),
    env.DB.prepare(`SELECT l.work_date, SUM(l.minutes) AS minutes FROM time_logs l WHERE ${s.where} GROUP BY l.work_date`).bind(...s.binds),
    env.DB.prepare(`SELECT l.id, l.project_id, l.minutes, l.work_date, v.name AS va, tt.name AS type_name
      FROM time_logs l LEFT JOIN users v ON v.id = l.user_id LEFT JOIN task_types tt ON tt.id = l.task_type_id
      WHERE ${s.where} ORDER BY l.work_date DESC, l.entered_at DESC, l.id DESC LIMIT ?`).bind(...s.binds, show + 1),
  ]);
  const byProject = new Map(s.projects.map((p) => [p.id, p]));
  let total = 0, count = 0;
  const add = (map, key, name, minutes) => { const r = map.get(key) || { name, minutes: 0 }; r.minutes += minutes; map.set(key, r); };
  const vaMap = new Map(), projMap = new Map(), typeMap = new Map();
  for (const r of agg.results) {
    total += r.minutes; count += r.n;
    add(vaMap, r.user_id, r.va || 'A VA', r.minutes);
    add(projMap, String(r.project_id), byProject.get(String(r.project_id)) ? cv.projectName(byProject.get(String(r.project_id))) : 'Project', r.minutes);
    add(typeMap, r.task_type_id || 0, r.type_name || 'General', r.minutes);
  }
  const sorted = (map) => [...map.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  const perDay = new Map(days.results.map((r) => [r.work_date, r.minutes]));
  const chart = s.range.from !== s.range.to ? buckets(s.range.from, s.range.to, perDay) : null;
  const logs = list.results.slice(0, show).map((l) => ({ ...l, project: byProject.get(String(l.project_id)) }));
  return page(cv.timePage({
    user, message, s, cards: await packageCards(env, s.projects), total, count,
    projectRows: sorted(projMap), vaRows: sorted(vaMap), typeRows: sorted(typeMap), chart,
    logs, more: list.results.length > show, show, query: url.searchParams,
  }));
}

// One log with its description. Only logs on this client's projects.
async function logView(env, user, client, id, url, message) {
  const log = await env.DB.prepare(
    `SELECT l.id, l.project_id, l.minutes, l.work_date, l.description, l.entered_at, l.source, tt.name AS type_name, v.name AS va,
       p.name AS project_name, p.is_coverage, p.active
     FROM time_logs l JOIN projects p ON p.id = l.project_id AND p.client_record_id = ?
     LEFT JOIN task_types tt ON tt.id = l.task_type_id LEFT JOIN users v ON v.id = l.user_id
     WHERE l.id = ? AND l.deleted_at IS NULL`
  ).bind(client.id, id).first();
  if (!log) return redirect('/client/time?msg=time-log-gone');
  const zone = (await projectZones(env, [log.project_id])).get(String(log.project_id)) || 'EST';
  const back = url.searchParams.get('back') || '';
  const backTo = /^\/client\/time(\?[\w=&%.+-]*)?$/.test(back) ? back : '/client/time';
  return page(cv.logPage({ user, message, log, zone, backTo }));
}
