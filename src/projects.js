// Projects made in the app (replacing Zoho Projects, piece T1), each project's settings page (time zone, billing day,
// package hours with dates, VAs, history), Settings > Task types and Settings > Pay periods.
//
// Project ids: projects made in the app get "p-1", "p-2" ... and Zoho Projects ids (long numbers) stay as they are, so
// both kinds live in the one projects table and everything that points at a project (assignments, SOPs, coverage,
// time off, time logs) keeps working. The hourly Zoho sync leaves "p-" projects alone.

import { redirect, page, isDate, isTime } from './util.js';
import { ZONES, partsIn, addDays } from './time.js';
import * as pv from './projects-views.js';
import { projectUsage } from './timeadmin.js';

// The part of an address that is a project id.
export const PID = '(\\d+|p-\\d+)';

// A line in a project's history (a statement to run with others).
export const projectLog = (env, projectId, userId, summary, at = new Date().toISOString()) =>
  env.DB.prepare('INSERT INTO project_history (project_id, user_id, at, summary) VALUES (?, ?, ?, ?)').bind(projectId, userId, at, summary.slice(0, 500));

const cleanZone = (z) => (ZONES[z] ? z : null);
const cleanDays = (days) => (days.filter((d) => /^[0-6]$/.test(d)).join(',') || '1,2,3,4,5');
const dataOf = (record) => { try { return JSON.parse(record?.data || '{}'); } catch { return {}; } };

// The billing cycle that contains a date: from the billing day to the day before it next month.
export function billingCycle(date, day) {
  const pad = (n) => String(n).padStart(2, '0');
  let [y, m] = date.split('-').map(Number);
  if (Number(date.slice(8, 10)) < day) { m -= 1; if (m < 1) { m = 12; y -= 1; } }
  const start = `${y}-${pad(m)}-${pad(day)}`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return { start, end: addDays(`${ny}-${pad(nm)}-${pad(day)}`, -1) };
}

// The package (hours per billing cycle) in effect on a date, from rows sorted by effective_from.
export const packageOn = (packages, date) => [...packages].reverse().find((p) => p.effective_from <= date) || null;

// The default billing day from a client's "Invoice date" value (its first day, 1-28), or null.
export function invoiceDay(value) {
  const first = parseInt((Array.isArray(value) ? value[0] : String(value ?? '').split(/[;,]/)[0]) || '', 10);
  return first >= 1 && first <= 28 ? first : null;
}

// A project's settings with their defaults, and where each default came from.
// Time zone: saved > client record's "Time zone" > first VA's > EST. Billing day: saved > the client's first "Invoice date" > 1.
export async function projectSettings(env, project) {
  const saved = await env.DB.prepare('SELECT * FROM project_settings WHERE project_id = ?').bind(project.id).first();
  const client = project.client_record_id
    ? await env.DB.prepare("SELECT id, name, status, data FROM records WHERE id = ? AND module = 'clients'").bind(project.client_record_id).first() : null;
  const data = dataOf(client);
  const va = await env.DB.prepare(
    'SELECT u.time_zone FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.project_id = ? AND u.is_va = 1 ORDER BY a.id LIMIT 1'
  ).bind(project.id).first();
  let zone = saved?.time_zone, zoneFrom = 'saved';
  if (!ZONES[zone]) {
    if (ZONES[data.Timezone]) { zone = data.Timezone; zoneFrom = 'client'; }
    else if (ZONES[va?.time_zone]) { zone = va.time_zone; zoneFrom = 'va'; }
    else { zone = 'EST'; zoneFrom = 'none'; }
  }
  let billingDay = saved?.billing_day, billingFrom = 'saved';
  if (!(billingDay >= 1 && billingDay <= 28)) {
    const first = invoiceDay(data.Invoice_Date);
    if (first) { billingDay = first; billingFrom = 'client'; } else { billingDay = 1; billingFrom = 'none'; }
  }
  const packageHint = parseFloat(String(data.Package_Hours ?? '').replace(/[^\d.]/g, '')) || null;
  return { saved, client, zone, zoneFrom, billingDay, billingFrom, packageHint, createdBy: saved?.created_by, createdAt: saved?.created_at };
}

// Past-date exceptions (the project page and the admin Time > Exceptions page). Adds one from the form fields
// user_id, from_date, to_date and reason; false when the VA is not on the project or the dates are wrong.
export async function addException(env, user, project, field, now) {
  const settings = await projectSettings(env, project);
  const today = partsIn(ZONES[settings.zone]).date;
  const va = await env.DB.prepare('SELECT u.id, u.name FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.project_id = ? AND u.id = ? AND u.is_va = 1')
    .bind(project.id, Number(field('user_id')) || 0).first();
  const from = field('from_date'), to = field('to_date'), reason = field('reason').slice(0, 500);
  if (!va || !isDate(from) || !isDate(to) || to < from || to > today) return false;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO log_exceptions (project_id, user_id, from_date, to_date, reason, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(project.id, va.id, from, to, reason || null, user.id, now),
    projectLog(env, project.id, user.id, `Allowed ${va.name} to log time for ${from} to ${to}${reason ? ` (${reason})` : ''}`, now),
  ]);
  return true;
}

// Removes an exception of this project (written in the project's history).
export async function removeException(env, user, project, id, now) {
  const row = await env.DB.prepare('SELECT e.*, u.name FROM log_exceptions e JOIN users u ON u.id = e.user_id WHERE e.id = ? AND e.project_id = ?').bind(id, project.id).first();
  if (row) await env.DB.batch([env.DB.prepare('DELETE FROM log_exceptions WHERE id = ?').bind(row.id),
    projectLog(env, project.id, user.id, `Removed the past-date exception for ${row.name} (${row.from_date} to ${row.to_date})`, now)]);
  return Boolean(row);
}

async function projectPage(env, user, project, message) {
  const settings = await projectSettings(env, project);
  const today = partsIn(ZONES[settings.zone]).date;
  const { results: assignments } = await env.DB.prepare(
    `SELECT a.*, u.name AS va_name, u.time_zone AS va_zone, u.is_va FROM assignments a JOIN users u ON u.id = a.user_id
     WHERE a.project_id = ? ORDER BY u.name`
  ).bind(project.id).all();
  const { results: vas } = await env.DB.prepare('SELECT id, name, time_zone FROM users WHERE is_va = 1 ORDER BY name').all();
  const { results: packages } = await env.DB.prepare(
    'SELECT k.*, u.name AS set_by_name FROM project_packages k LEFT JOIN users u ON u.id = k.set_by WHERE k.project_id = ? ORDER BY k.effective_from'
  ).bind(project.id).all();
  const { results: history } = await env.DB.prepare(
    'SELECT h.*, u.name AS user_name FROM project_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.project_id = ? ORDER BY h.id DESC LIMIT 50'
  ).bind(project.id).all();
  const { results: exceptions } = await env.DB.prepare(
    `SELECT e.*, u.name AS va_name, a.name AS approved_by_name FROM log_exceptions e JOIN users u ON u.id = e.user_id
     LEFT JOIN users a ON a.id = e.approved_by WHERE e.project_id = ? ORDER BY e.to_date DESC, e.id DESC LIMIT 50`
  ).bind(project.id).all();
  const { results: typeRows } = await env.DB.prepare(
    `SELECT t.id, t.name, t.hidden, l.task_type_id IS NOT NULL AS linked FROM task_types t
     LEFT JOIN project_task_types l ON l.project_id = ? AND l.task_type_id = t.id ORDER BY t.position, t.id`
  ).bind(project.id).all();
  const inhouse = (await inhouseId(env)) === String(project.id);
  const ownTypes = typeRows.some((t) => t.linked);
  const taskTypes = typeRows.map((t) => ({ id: t.id, name: t.name, on: ownTypes ? Boolean(t.linked) : !t.hidden }));
  const creator = settings.createdBy ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(settings.createdBy).first() : null;
  const usage = packages.length ? await projectUsage(env, project, packages, today, settings.billingDay) : null;
  return page(pv.projectPage({
    user, project, settings, today, cycle: billingCycle(today, settings.billingDay), assignments: assignments.filter((a) => a.is_va), vas,
    packages, history, exceptions, creator: creator?.name, message, usage, taskTypes, ownTypes, inhouse,
  }));
}

// The in-house project (setting inhouse_project_id): every VA can log on it, and its task types are fixed.
export const inhouseId = async (env) => (await env.DB.prepare("SELECT value FROM settings WHERE key = 'inhouse_project_id'").first())?.value || null;

// Handles the project pages and Settings > Task types / Pay periods. Returns null for addresses it doesn't own.
export async function projectRoutes(env, user, path, method, field, fieldAll, message) {
  const now = new Date().toISOString();
  let m;

  if (path === '/admin/projects/new' && method === 'POST') return createProject(env, user, field, fieldAll, now);

  // Task types of one project: the chosen list (VAs pick only from it), or back to the company-wide list.
  if ((m = path.match(new RegExp(`^/admin/projects/${PID}/task-types$`))) && method === 'POST') {
    const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(m[1]).first();
    if (!project) return redirect('/admin/projects');
    const here = `/admin/projects/${project.id}`;
    if ((await inhouseId(env)) === String(project.id)) return redirect(`${here}?msg=types-locked#task-types`);
    const { results: all } = await env.DB.prepare('SELECT id, name FROM task_types').all();
    const reset = field('op') === 'reset';
    const chosen = all.filter((t) => fieldAll('type').includes(String(t.id)));
    if (!reset && !chosen.length) return redirect(`${here}?msg=types-none#task-types`);
    const statements = [env.DB.prepare('DELETE FROM project_task_types WHERE project_id = ?').bind(project.id)];
    if (!reset) statements.push(...chosen.map((t) => env.DB.prepare('INSERT INTO project_task_types (project_id, task_type_id) VALUES (?, ?)').bind(project.id, t.id)));
    statements.push(projectLog(env, project.id, user.id, reset ? 'Task types: back to the company-wide list'
      : `Task types set to ${chosen.length}: ${chosen.map((t) => t.name).join(', ')}`, now));
    await env.DB.batch(statements);
    return redirect(`${here}?msg=saved#task-types`);
  }

  // Past-date exceptions: an admin allows a VA to add or change time for some earlier days in this project.
  if ((m = path.match(new RegExp(`^/admin/projects/${PID}/exceptions(?:/(\\d+)/delete)?$`))) && method === 'POST') {
    const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(m[1]).first();
    if (!project) return redirect('/admin/projects');
    const here = `/admin/projects/${project.id}`;
    if (m[2]) {
      await removeException(env, user, project, Number(m[2]), now);
      return redirect(`${here}?msg=removed#exceptions`);
    }
    const ok = await addException(env, user, project, field, now);
    return redirect(`${here}?msg=${ok ? 'exception-added' : 'exception-bad'}#exceptions`);
  }

  if ((m = path.match(new RegExp(`^/admin/projects/${PID}(?:/(settings|package|close|reopen)|/package/(\\d+)/delete)?$`)))) {
    const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(m[1]).first();
    if (!project) return redirect('/admin/projects');
    const here = `/admin/projects/${project.id}`;
    if (method === 'GET' && !m[2] && !m[3]) return projectPage(env, user, project, message);
    if (method !== 'POST') return redirect(here);
    const app = project.id.startsWith('p-');

    if (m[2] === 'settings') {
      const before = await projectSettings(env, project);
      const zone = cleanZone(field('time_zone'));
      const day = parseInt(field('billing_day'), 10);
      const billingDay = day >= 1 && day <= 28 ? day : null;
      const name = app ? field('name').slice(0, 120) : '';
      const changes = [];
      if ((before.saved?.time_zone || null) !== zone) changes.push(`time zone ${zone || `default (${before.zone})`}`);
      if ((before.saved?.billing_day || null) !== billingDay) changes.push(`billing day ${billingDay || `default (${before.billingDay})`}`);
      if (name && name !== project.name) changes.push(`name "${name}"`);
      if (!changes.length) return redirect(`${here}?msg=no-changes`);
      const statements = [
        env.DB.prepare(`INSERT INTO project_settings (project_id, time_zone, billing_day) VALUES (?, ?, ?)
          ON CONFLICT (project_id) DO UPDATE SET time_zone = excluded.time_zone, billing_day = excluded.billing_day`).bind(project.id, zone, billingDay),
        projectLog(env, project.id, user.id, `Changed ${changes.join(', ')}`, now),
      ];
      if (name && name !== project.name) statements.push(env.DB.prepare('UPDATE projects SET name = ? WHERE id = ?').bind(name, project.id));
      await env.DB.batch(statements);
      return redirect(`${here}?msg=saved`);
    }

    if (m[2] === 'package') {
      const hours = Number(field('hours'));
      const from = field('effective_from');
      if (field('hours') === '' || !Number.isFinite(hours) || hours < 0 || hours > 10000 || !isDate(from)) return redirect(`${here}?msg=package-bad#package`);
      const rounded = Math.round(hours * 100) / 100;
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO project_packages (project_id, hours, effective_from, set_by, set_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (project_id, effective_from) DO UPDATE SET hours = excluded.hours, set_by = excluded.set_by, set_at = excluded.set_at`)
          .bind(project.id, rounded, from, user.id, now),
        projectLog(env, project.id, user.id, `Package set to ${rounded} hours per billing cycle, starting ${from}`, now),
      ]);
      return redirect(`${here}?msg=package-saved#package`);
    }

    // Only a change that has not started yet can be removed (past packages are history).
    if (m[3]) {
      const settings = await projectSettings(env, project);
      const today = partsIn(ZONES[settings.zone]).date;
      const row = await env.DB.prepare('SELECT * FROM project_packages WHERE id = ? AND project_id = ?').bind(Number(m[3]), project.id).first();
      if (row && row.effective_from > today) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM project_packages WHERE id = ?').bind(row.id),
          projectLog(env, project.id, user.id, `Removed the upcoming package change (${row.hours} hours from ${row.effective_from})`, now),
        ]);
        return redirect(`${here}?msg=package-deleted#package`);
      }
      return redirect(`${here}#package`);
    }

    // Projects made in the app can be closed (they then stop counting, like a Zoho project that was closed) and reopened.
    if ((m[2] === 'close' || m[2] === 'reopen') && app) {
      const close = m[2] === 'close';
      await env.DB.batch([
        env.DB.prepare('UPDATE projects SET active = ? WHERE id = ?').bind(close ? 0 : 1, project.id),
        projectLog(env, project.id, user.id, close ? 'Closed the project' : 'Reopened the project', now),
      ]);
      return redirect(close ? '/admin/projects?msg=project-closed' : `${here}?msg=project-reopened`);
    }
    return redirect(here);
  }

  if (path === '/admin/settings/task-types') return taskTypes(env, user, method, field, message, now);
  if (path === '/admin/settings/pay-periods') return payPeriods(env, user, method, field, message, now);
  return null;
}

// A new project: the client is required and never changes afterwards. Name: typed, or "Client - VA" (" - Coverage").
async function createProject(env, user, field, fieldAll, now) {
  const client = await env.DB.prepare("SELECT id, name, data FROM records WHERE id = ? AND module = 'clients'").bind(Number(field('client_id')) || 0).first();
  if (!client) return redirect('/admin/projects?msg=project-missing#new-project');
  const va = field('user_id') ? await env.DB.prepare('SELECT id, name, time_zone FROM users WHERE id = ? AND is_va = 1').bind(Number(field('user_id'))).first() : null;
  const coverage = field('coverage') === '1';
  const name = (field('name') || [client.name, va?.name, coverage ? 'Coverage' : null].filter(Boolean).join(' - ')).slice(0, 120);
  const next = await env.DB.prepare("SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 AS n FROM projects WHERE id LIKE 'p-%'").first();
  const id = `p-${next.n}`;
  // The project's time zone and billing day start as the defaults (client record, else the VA), saved so they stay put.
  const defaults = await projectSettings(env, { id, client_record_id: client.id });
  const zone = defaults.zoneFrom === 'client' ? defaults.zone : ZONES[va?.time_zone] ? va.time_zone : defaults.zone;
  const statements = [
    env.DB.prepare(`INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?, 1)`).bind(id, name, client.name, va?.name || null, coverage ? 1 : 0, client.id),
    env.DB.prepare('INSERT INTO project_settings (project_id, time_zone, billing_day, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, zone, defaults.billingDay, user.id, now),
    projectLog(env, id, user.id, `Created the project for ${client.name}${va ? ` with ${va.name}` : ''} (time zone ${zone}, billing day ${defaults.billingDay})`, now),
  ];
  if (va) {
    statements.push(env.DB.prepare('INSERT INTO assignments (project_id, user_id, start_time, time_zone, days) VALUES (?, ?, ?, ?, ?)')
      .bind(id, va.id, isTime(field('start_time')) ? field('start_time') : null, cleanZone(field('time_zone')), cleanDays(fieldAll('days'))));
  }
  await env.DB.batch(statements);
  return redirect(`/admin/projects/${id}?msg=project-created`);
}

// ---- Settings > Task types ----

const typeLog = (env, user, summary, now) =>
  env.DB.prepare("INSERT INTO field_log (module, user_id, summary, at) VALUES ('task_types', ?, ?, ?)").bind(user.id, summary.slice(0, 500), now);

async function taskTypes(env, user, method, field, message, now) {
  const load = async () => (await env.DB.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM time_logs l WHERE l.task_type_id = t.id) + (SELECT COUNT(*) FROM work_timers w WHERE w.task_type_id = t.id) AS used,
       (SELECT COUNT(*) FROM project_task_types x WHERE x.task_type_id = t.id) AS linked
     FROM task_types t ORDER BY t.position, t.id`
  ).all()).results;
  const show = async (error = null, status = 200) => {
    const { results: log } = await env.DB.prepare(
      "SELECT l.summary, l.at, u.name AS user_name FROM field_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.module = 'task_types' ORDER BY l.id DESC LIMIT 20"
    ).all();
    return page(pv.taskTypesPage({ user, types: await load(), log, message: error ? ['bad', error] : message }), status);
  };
  if (method !== 'POST') return show();

  const types = await load();
  const op = field('op');
  const name = field('name').replace(/\s+/g, ' ').slice(0, 60);
  const type = types.find((t) => t.id === Number(field('id')));
  const taken = (n, except = 0) => types.some((t) => t.id !== except && t.name.toLowerCase() === n.toLowerCase());
  const statements = [];
  if (op === 'add') {
    if (!name) return show('Please type the name of the task type.', 400);
    if (taken(name)) return show(`There is already a task type called "${name}".`, 400);
    statements.push(env.DB.prepare('INSERT INTO task_types (name, position, created_at) VALUES (?, ?, ?)').bind(name, (types.at(-1)?.position || 0) + 1, now),
      typeLog(env, user, `Added the task type "${name}"`, now));
  } else if (!type) {
    return show('That task type is not there any more.', 400);
  } else if (op === 'rename') {
    if (!name) return show('Please type the new name.', 400);
    if (taken(name, type.id)) return show(`There is already a task type called "${name}".`, 400);
    if (name !== type.name) statements.push(env.DB.prepare('UPDATE task_types SET name = ? WHERE id = ?').bind(name, type.id),
      typeLog(env, user, `Renamed the task type "${type.name}" to "${name}"`, now));
  } else if (op === 'up' || op === 'down') {
    const order = types.map((t) => t.id);
    const i = order.indexOf(type.id), j = op === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < order.length) {
      [order[i], order[j]] = [order[j], order[i]];
      statements.push(...order.map((id, k) => env.DB.prepare('UPDATE task_types SET position = ? WHERE id = ?').bind(k + 1, id)),
        typeLog(env, user, `Moved the task type "${type.name}" ${op}`, now));
    }
  } else if (op === 'hide' || op === 'show') {
    statements.push(env.DB.prepare('UPDATE task_types SET hidden = ? WHERE id = ?').bind(op === 'hide' ? 1 : 0, type.id),
      typeLog(env, user, `${op === 'hide' ? 'Hid' : 'Showed again'} the task type "${type.name}"`, now));
  } else if (op === 'delete') {
    if (type.used) return show(`"${type.name}" has time logged with it, so it can't be deleted. Hide it instead: it then can't be picked for new time.`, 400);
    if (type.linked) return show(`"${type.name}" is on the task type list of ${type.linked === 1 ? 'a project' : `${type.linked} projects`}, so it can't be deleted. Hide it instead.`, 400);
    statements.push(env.DB.prepare('DELETE FROM task_types WHERE id = ?').bind(type.id), typeLog(env, user, `Deleted the task type "${type.name}"`, now));
  }
  if (statements.length) await env.DB.batch(statements);
  return redirect(`/admin/settings/task-types?msg=${statements.length ? 'saved' : 'no-changes'}`);
}

// ---- Settings > Pay periods ----

async function payPeriods(env, user, method, field, message, now) {
  const { results: periods } = await env.DB.prepare('SELECT * FROM pay_periods ORDER BY start_date').all();
  const show = async (error = null, status = 200) => {
    const { results: log } = await env.DB.prepare(
      "SELECT l.summary, l.at, u.name AS user_name FROM field_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.module = 'pay_periods' ORDER BY l.id DESC LIMIT 20"
    ).all();
    return page(pv.payPeriodsPage({ user, periods, today: partsIn('America/New_York').date, log, message: error ? ['bad', error] : message }), status);
  };
  if (method !== 'POST') return show();

  const op = field('op');
  const period = periods.find((p) => p.id === Number(field('id')));
  const logIt = (summary) => env.DB.prepare("INSERT INTO field_log (module, user_id, summary, at) VALUES ('pay_periods', ?, ?, ?)").bind(user.id, summary, now);
  if (op === 'delete') {
    if (!period) return show('That pay period is not there any more.', 400);
    await env.DB.batch([env.DB.prepare('DELETE FROM pay_periods WHERE id = ?').bind(period.id),
      logIt(`Deleted the pay period ${period.start_date} to ${period.end_date} (pay day ${period.pay_day})`)]);
    return redirect('/admin/settings/pay-periods?msg=removed');
  }
  if (op !== 'add' && !(op === 'edit' && period)) return show('That pay period is not there any more.', 400);
  const start = field('start_date'), end = field('end_date'), pay = field('pay_day');
  if (!isDate(start) || !isDate(end) || !isDate(pay)) return show('Please enter the first day, the last day and the pay day.', 400);
  if (end < start) return show('The last day must be the same as or after the first day.', 400);
  if (pay < end) return show('The pay day must be on or after the last day of the period.', 400);
  const overlap = periods.find((p) => p.id !== period?.id && p.start_date <= end && p.end_date >= start);
  if (overlap) return show(`These dates overlap the pay period ${overlap.start_date} to ${overlap.end_date}. Change that one first.`, 400);
  if (op === 'add') {
    await env.DB.batch([env.DB.prepare('INSERT INTO pay_periods (start_date, end_date, pay_day, created_at) VALUES (?, ?, ?, ?)').bind(start, end, pay, now),
      logIt(`Added the pay period ${start} to ${end} (pay day ${pay})`)]);
  } else {
    await env.DB.batch([env.DB.prepare('UPDATE pay_periods SET start_date = ?, end_date = ?, pay_day = ? WHERE id = ?').bind(start, end, pay, period.id),
      logIt(`Changed the pay period ${period.start_date} to ${period.end_date} (pay day ${period.pay_day}) to ${start} to ${end} (pay day ${pay})`)]);
  }
  return redirect('/admin/settings/pay-periods?msg=saved');
}
