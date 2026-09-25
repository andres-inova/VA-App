// The app's entry point: decides what happens for each web address,
// and runs the scheduled job every minute.

import { checkLogin, startSession, currentUser, endSession, renewedCookie, rememberedEmail, rememberEmailCookie, hashPassword, verifyPassword, passwordProblem } from './auth.js';
import { dayInfo, getGraceMinutes, runEveryMinute, reportPeriod, sendReport, getReportRecipients, checkInStats, flaggedVAs } from './jobs.js';
import { syncFromZoho } from './zoho.js';
import { handleFormWebhook } from './forms.js';
import { handleSlackCommand } from './slack-commands.js';
import { checkIn, callOut } from './actions.js';
import { sendInvite, newTemporaryPassword } from './invites.js';
import { createCoverageChecklist, clickupReady } from './clickup.js';
import { formatTimeIn, formatDate, addDays, partsIn, weekdayIndex, weekdayOf, REPORT_ZONE } from './time.js';
import { redirect, page, isDate, isTime } from './util.js';
import * as work from './work.js';
import * as views from './views.js';

export default {
  async fetch(request, env) {
    try {
      let response = await handle(request, env);
      const cookie = renewedCookie(request);
      if (cookie) {
        response = new Response(response.body, response);
        response.headers.append('Set-Cookie', cookie);
      }
      return response;
    } catch (err) {
      console.error(err.stack || err.message);
      return page(views.layout({ title: 'Error', body: '<div class="card"><h1>Something went wrong</h1><p>Please go back and try again. If it keeps happening, tell an admin.</p></div>' }), 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runEveryMinute(env, new Date(event.scheduledTime)));
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const message = url.searchParams.get('msg');

  // Responses from the Google Form come from Google, not from the app's pages. They are checked with a secret instead.
  if (path === '/api/form/time-off' && method === 'POST') return handleFormWebhook(request, env);
  // Slack slash commands (/checkin, /callout) come from Slack and are checked with Slack's signature instead.
  if (path === '/api/slack/command' && method === 'POST') return handleSlackCommand(request, env);

  // Only accept form submissions that come from this app's own pages.
  if (method === 'POST' && request.headers.get('Origin') !== url.origin) {
    return new Response('This form must be sent from the check-in app.', { status: 403 });
  }
  const isForm = /form/.test(request.headers.get('Content-Type') || '');
  const form = method === 'POST' && isForm ? await request.formData() : null;
  const field = (name) => (form?.get(name) || '').toString().trim();
  const fieldAll = (name) => (form ? form.getAll(name).map(String) : []);

  // ---- Pages anyone can open ----

  if (path === '/setup') return setup(env, method, field);

  if (path === '/login') {
    if (method === 'GET') {
      if (await needsSetup(env)) return redirect('/setup');
      if (await currentUser(request, env)) return redirect('/');
      return page(views.loginPage(null, rememberedEmail(request)));
    }
    const email = field('email').toLowerCase();
    const result = await checkLogin(env, email, field('password'));
    if (result.error) return page(views.loginPage(result.error, email), 401);
    const response = redirect('/', await startSession(env, result.user.id, field('remember') === '1'));
    response.headers.append('Set-Cookie', rememberEmailCookie(email));
    return response;
  }

  if (path === '/logout' && method === 'POST') return redirect('/login', await endSession(request, env));

  // ---- Everything below needs a logged-in person ----

  const user = await currentUser(request, env);
  if (!user) return redirect('/login');

  if (path === '/account') return account(env, user, method, field, message);
  if (user.must_change_password) return redirect('/account');

  // Admins see how many time-off requests are waiting, as a badge in the menu.
  if (user.is_admin) {
    const waiting = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM time_off_requests WHERE status = 'pending') + (SELECT COUNT(*) FROM form_unmatched) AS n"
    ).first();
    user.pending_requests = waiting?.n || 0;
  }

  if (path === '/') return redirect(user.is_va ? '/va' : '/admin');

  if (user.is_va) {
    user.timer = await env.DB.prepare('SELECT t.*, p.client FROM timers t LEFT JOIN projects p ON p.id = t.project_id WHERE t.user_id = ?').bind(user.id).first();
  }

  if (path === '/va/work' || path.startsWith('/va/work/')) {
    if (!user.is_va) return redirect('/admin');
    return workRoutes(env, user, path, method, field, message, url);
  }

  if (path === '/va' || path.startsWith('/va/')) {
    if (!user.is_va) return redirect('/admin');
    return vaRoutes(env, user, path, method, field, message);
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    if (!user.is_admin) return redirect('/va');
    return adminRoutes(env, user, path, method, field, message, url, fieldAll);
  }

  return page(views.layout({ title: 'Not found', user, body: '<div class="card"><h1>Page not found</h1></div>' }), 404);
}

// ---- Setup and passwords ----

async function needsSetup(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND password_hash IS NOT NULL').first();
  return row.n === 0;
}

async function setup(env, method, field) {
  if (!(await needsSetup(env))) return redirect('/login');
  const { results: admins } = await env.DB.prepare('SELECT email FROM users WHERE is_admin = 1 ORDER BY name').all();
  if (method === 'GET') return page(views.setupPage(admins));

  const email = field('email');
  const problem = passwordProblem(field('password'), field('confirm'));
  if (problem) return page(views.setupPage(admins, problem), 400);
  const admin = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND is_admin = 1').bind(email).first();
  if (!admin) return page(views.setupPage(admins, 'Please choose an email from the list.'), 400);

  await env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .bind(await hashPassword(field('password')), admin.id).run();
  return redirect('/', await startSession(env, admin.id));
}

async function account(env, user, method, field, message) {
  if (method === 'GET') return page(views.accountPage(user, null, message));
  if (!(await verifyPassword(field('current'), user.password_hash))) {
    return page(views.accountPage(user, 'Your current password is not correct.'), 400);
  }
  const problem = passwordProblem(field('password'), field('confirm'));
  if (problem) return page(views.accountPage(user, problem), 400);
  await env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .bind(await hashPassword(field('password')), user.id).run();
  return redirect(`${user.is_va ? '/va' : '/admin'}?msg=password-changed`);
}

// ---- VA pages ----

async function vaRoutes(env, user, path, method, field, message) {
  const now = new Date();
  const day = await dayInfo(env, user, now);
  const today = await env.DB.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?')
    .bind(user.id, day.local.date).first();

  if (path === '/va' && method === 'GET') {
    const { results: requests } = await env.DB.prepare(
      'SELECT * FROM time_off_requests WHERE user_id = ? ORDER BY start_date DESC LIMIT 20'
    ).bind(user.id).all();
    const { results: history } = await env.DB.prepare(
      'SELECT * FROM attendance WHERE user_id = ? AND work_date >= ? ORDER BY work_date DESC'
    ).bind(user.id, addDays(day.local.date, -30)).all();
    return page(views.vaPage({ user, day, today, requests, history, formUrl: env.TIME_OFF_FORM_URL, message }));
  }

  if (path === '/va/checkin' && method === 'POST') {
    const r = await checkIn(env, user, now);
    return redirect(`/va?msg=${r.result}`);
  }

  if (path === '/va/callout' && method === 'POST') {
    const r = await callOut(env, user, field('reason'), now);
    return redirect(`/va?msg=${r.result}`);
  }

  // Time-off and coverage requests are made with the Google Form (see src/forms.js).
  return redirect('/va');
}

// ---- Tasks and time (Zoho Projects) ----

async function workRoutes(env, user, path, method, field, message, url) {
  const now = new Date();
  const day = await dayInfo(env, user, now);
  const { results: projects } = await env.DB.prepare(
    `SELECT p.id, p.client, p.name FROM assignments a JOIN projects p ON p.id = a.project_id
     WHERE a.user_id = ? AND p.active = 1 ORDER BY p.client`
  ).bind(user.id).all();
  const projectId = field('project') || url.searchParams.get('project') || user.timer?.project_id || projects[0]?.id || '';
  const project = projects.find((p) => p.id === projectId);
  const back = (params) => redirect(`/va/work?${new URLSearchParams({ project: projectId, ...params })}`);

  if (path === '/va/work' && method === 'GET') {
    // Weeks run Sunday to Saturday, as in Zoho.
    const weekParam = url.searchParams.get('week');
    const today = day.local.date;
    const thisWeek = addDays(today, -weekdayIndex(day.local.weekday));
    const week = isDate(weekParam) ? addDays(weekParam, -weekdayIndex(weekdayOf(weekParam))) : thisWeek;
    // Tasks and time logs load separately, so a problem with one doesn't hide the other.
    const problem = (err) => {
      if (!(err instanceof work.ZohoError)) console.error(err.stack || err.message);
      return err instanceof work.ZohoError ? err.message : 'Zoho Projects could not be reached. Please try again in a minute.';
    };
    let lists = [], logs = [], zohoError = url.searchParams.get('err') || '', logsError = '';
    if (project) {
      const [a, b] = await Promise.allSettled([
        work.projectWork(env, project.id),
        work.myLogs(env, project.id, user.zoho_projects_user_id, user.email, week, addDays(week, 6)),
      ]);
      if (a.status === 'fulfilled') lists = a.value; else zohoError = zohoError || `Tasks could not be loaded. ${problem(a.reason)}`;
      if (b.status === 'fulfilled') logs = b.value; else logsError = `Your time logs could not be loaded. ${problem(b.reason)}`;
    }
    return page(views.workPage({ user, day, projects, project, lists, logs, week, thisWeek, today, message, zohoError, logsError }));
  }

  if (method !== 'POST' || !project) return redirect('/va/work');
  const done = (key) => back({ msg: key });
  const needName = (name) => (name.length < 1 || name.length > 500 ? 'Please enter a name.' : '');

  try {
    // ---- Timer ----
    if (path === '/va/work/timer/start') {
      if (user.timer) {
        return back({ err: user.timer.stopped_at ? 'Please save or discard your stopped timer first.' : 'Please stop your running timer first.' });
      }
      await env.DB.prepare('INSERT INTO timers (user_id, project_id, task_id, task_name, started_at) VALUES (?, ?, ?, ?, ?)')
        .bind(user.id, project.id, field('task') || null, field('task_name').slice(0, 500) || 'General', now.toISOString()).run();
      // Starting work counts as the day's check-in.
      const row = await env.DB.prepare('SELECT status, checked_in_at FROM attendance WHERE user_id = ? AND work_date = ?')
        .bind(user.id, day.local.date).first();
      const off = ['called_out', 'time_off', 'emergency', 'coverage'].includes(row?.status);
      if (!row?.checked_in_at && !off) {
        await checkIn(env, user, now);
        return done('timer-started-checked-in');
      }
      return done('timer-started');
    }
    if (path === '/va/work/timer/stop') {
      await env.DB.prepare('UPDATE timers SET stopped_at = ? WHERE user_id = ? AND stopped_at IS NULL').bind(now.toISOString(), user.id).run();
      return redirect(`/va/work?project=${encodeURIComponent(user.timer?.project_id || projectId)}&msg=timer-stopped#timer`);
    }
    if (path === '/va/work/timer/discard') {
      await env.DB.prepare('DELETE FROM timers WHERE user_id = ?').bind(user.id).run();
      return done('timer-discarded');
    }

    // ---- Time logs ----
    if (path === '/va/work/log' || path === '/va/work/log/edit') {
      if (!user.zoho_projects_user_id) {
        return back({ err: 'Your Zoho Projects account was not found, so time cannot be saved under your name yet. Please ask an admin to check that your email in Zoho Projects matches your email here.' });
      }
      const [task, taskName] = field('task').split('|');
      const log = {
        date: field('date'), start: field('start'), end: field('end'), billable: field('billable') !== 'no',
        notes: field('notes').slice(0, 10000), taskId: task || '', name: (field('name') || taskName || 'General').slice(0, 1000),
      };
      if (!isDate(log.date) || !isTime(log.start) || !isTime(log.end)) return back({ err: 'Please enter the date, start time and end time.' });
      if (log.end <= log.start) return back({ err: 'The end time must be after the start time.' });
      if (path === '/va/work/log') {
        await work.addLog(env, project.id, user.zoho_projects_user_id, log);
        if (field('from_timer') === '1') await env.DB.prepare('DELETE FROM timers WHERE user_id = ?').bind(user.id).run();
        return done('log-added');
      }
      await work.updateLog(env, project.id, field('log'), user.zoho_projects_user_id, log);
      return done('log-updated');
    }
    if (path === '/va/work/log/delete') {
      await work.deleteLog(env, project.id, field('log'), field('type') === 'general' ? 'general' : 'task', user.zoho_projects_user_id);
      return done('log-deleted');
    }

    // ---- Tasks and task lists ----
    const name = field('name');
    if (path === '/va/work/task/add') {
      if (needName(name)) return back({ err: needName(name) });
      await work.createTask(env, project.id, field('list'), name);
      return done('task-added');
    }
    if (path === '/va/work/task/edit') {
      if (needName(name)) return back({ err: needName(name) });
      await work.renameTask(env, project.id, field('task'), name);
      if (field('list') && field('list') !== field('old_list')) await work.moveTask(env, project.id, field('task'), field('list'));
      return done('task-updated');
    }
    if (path === '/va/work/task/delete') {
      await work.deleteTask(env, project.id, field('task'));
      return done('task-deleted');
    }
    if (path === '/va/work/list/add') {
      if (needName(name)) return back({ err: needName(name) });
      await work.createList(env, project.id, name);
      return done('list-added');
    }
    if (path === '/va/work/list/rename') {
      if (needName(name)) return back({ err: needName(name) });
      await work.renameList(env, project.id, field('list'), name);
      return done('list-updated');
    }
    if (path === '/va/work/list/delete') {
      await work.deleteList(env, project.id, field('list'));
      return done('list-deleted');
    }
  } catch (err) {
    if (!(err instanceof work.ZohoError)) console.error(err.stack || err.message);
    return back({ err: err instanceof work.ZohoError ? err.message : 'Something went wrong while talking to Zoho. Please try again.' });
  }
  return redirect('/va/work');
}

// ---- Admin pages ----

async function adminRoutes(env, user, path, method, field, message, url, fieldAll) {
  const now = new Date();
  let m;

  if (path === '/admin' && method === 'GET') {
    const { results: vas } = await env.DB.prepare('SELECT * FROM users WHERE is_va = 1 ORDER BY name').all();
    const rows = [];
    for (const va of vas) {
      const day = await dayInfo(env, va, now);
      const row = await env.DB.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?').bind(va.id, day.local.date).first();
      rows.push({
        name: va.name,
        exempt: day.exempt,
        startLabel: day.exempt ? '' : day.startLabel,
        projects: day.projectNames,
        status: views.todayStatus(row, day, now),
        checkedIn: row?.checked_in_at ? `${formatTimeIn(row.checked_in_at, day.zone)} ${day.zoneLabel}` : '',
        note: row?.callout_reason || (day.projectsOffNames ? `Off today for: ${day.projectsOffNames}` : ''),
      });
    }
    rows.sort((a, b) => a.exempt - b.exempt); // exempt VAs at the bottom; otherwise alphabetical
    // This week so far (Monday to today, Eastern time).
    const et = partsIn(REPORT_ZONE, now);
    const monday = addDays(et.date, -((weekdayIndex(et.weekday) + 6) % 7));
    const stats = await checkInStats(env, monday, et.date);
    const week = {
      ...stats, flagged: flaggedVAs(stats.rows, 2),
      label: `${formatDate(monday)} to ${monday === et.date ? 'today' : `today (${formatDate(et.date)})`}`,
    };
    return page(views.adminTodayPage({ user, rows, week, message }));
  }

  // A month calendar of time off (approved and waiting) and holidays.
  if (path === '/admin/calendar' && method === 'GET') {
    const today = partsIn(REPORT_ZONE, now).date;
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : today.slice(0, 7);
    const first = `${month}-01`;
    const last = addDays(`${addDays(first, 32).slice(0, 7)}-01`, -1);
    // Include the days of the previous and next month shown in the grid.
    const from = addDays(first, -7);
    const to = addDays(last, 7);
    const { results: requests } = await env.DB.prepare(
      `SELECT r.id, r.start_date, r.end_date, r.kind, r.status, r.backup_name, u.name FROM time_off_requests r
       JOIN users u ON u.id = r.user_id
       WHERE r.status IN ('pending', 'approved') AND r.end_date >= ? AND r.start_date <= ? ORDER BY u.name`
    ).bind(from, to).all();
    const events = [];
    for (const r of requests) {
      for (let d = r.start_date < from ? from : r.start_date; d <= r.end_date && d <= to; d = addDays(d, 1)) {
        events.push({ date: d, name: r.name, kind: r.kind === 'emergency' ? 'emergency' : 'time_off', status: r.status, backup: r.backup_name, id: r.id });
      }
    }
    const { results: holidays } = await env.DB.prepare('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?').bind(from, to).all();
    return page(views.calendarPage({
      user, month, today, events, holidays, message,
      prev: addDays(first, -1).slice(0, 7), next: addDays(first, 32).slice(0, 7),
    }));
  }

  if (path === '/admin/history' && method === 'GET') {
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : now.toISOString().slice(0, 7);
    const first = `${month}-01`;
    const nextMonth = addDays(first, 32).slice(0, 7);
    const prevMonth = addDays(first, -1).slice(0, 7);
    const last = addDays(`${nextMonth}-01`, -1);
    const dates = [];
    for (let d = first; d <= last; d = addDays(d, 1)) {
    }
    const { results: records } = await env.DB.prepare('SELECT * FROM attendance WHERE work_date BETWEEN ? AND ?').bind(first, last).all();
    // Show weekdays, plus any weekend day that has a record.
    const recordDates = new Set(records.map((r) => r.work_date));
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      if ((wd !== 0 && wd !== 6) || recordDates.has(d)) dates.push(d);
    }
    const ids = new Set(records.map((r) => r.user_id));
    const { results: people } = await env.DB.prepare('SELECT id, name, is_va FROM users ORDER BY name').all();
    const vas = people.filter((p) => p.is_va || ids.has(p.id));
    const cells = new Map(records.map((r) => [`${r.user_id}|${r.work_date}`, r]));
    return page(views.historyPage({ user, month, prev: prevMonth, next: nextMonth, dates, vas, cells }));
  }

  if (path === '/admin/time-off' && method === 'GET') {
    const base = `SELECT r.*, u.name, d.name AS decided_by_name FROM time_off_requests r
      JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by`;
    const today = now.toISOString().slice(0, 10);
    const { results: pending } = await env.DB.prepare(`${base} WHERE r.status = 'pending' ORDER BY r.start_date`).all();
    // Approved periods that have not ended yet (a day of margin for time zones).
    const { results: current } = await env.DB.prepare(
      `${base} WHERE r.status = 'approved' AND r.end_date >= ? ORDER BY r.start_date`
    ).bind(addDays(today, -1)).all();
    const { results: recent } = await env.DB.prepare(
      `${base} WHERE r.status IN ('denied', 'cancelled') OR (r.status = 'approved' AND r.end_date < ?) ORDER BY r.decided_at DESC LIMIT 30`
    ).bind(addDays(today, -1)).all();
    const { results: vas } = await env.DB.prepare('SELECT id, name, email, zoho_id FROM users WHERE is_va = 1 ORDER BY name').all();
    const { results: unmatched } = await env.DB.prepare('SELECT * FROM form_unmatched ORDER BY received_at').all();
    // Each VA's active projects, for the project checkboxes when assigning an unknown-name request.
    const { results: vaProjects } = await env.DB.prepare(
      `SELECT a.user_id, p.id, p.client FROM assignments a JOIN projects p ON p.id = a.project_id
       WHERE p.active = 1 ORDER BY p.client`
    ).all();
    // Project names for requests that cover only some projects.
    const { results: allProjects } = await env.DB.prepare('SELECT id, client FROM projects').all();
    const clientById = new Map(allProjects.map((p) => [p.id, p.client]));
    const withProjects = (rows) => rows.map((r) => ({
      ...r,
      project_names: r.project_ids ? r.project_ids.split(',').map((id) => clientById.get(id) || id).join(', ') : '',
    }));
    const { results: backups } = await env.DB.prepare('SELECT * FROM backup_candidates ORDER BY status, name').all();
    return page(views.timeOffPage({
      user, pending: withProjects(pending), current: withProjects(current), recent: withProjects(recent),
      vas, unmatched, vaProjects, backups, clickupReady: clickupReady(env), formUrl: env.TIME_OFF_FORM_URL, message,
    }));
  }

  if ((m = path.match(/^\/admin\/time-off\/(\d+)\/(approve|deny)$/)) && method === 'POST') {
    const status = m[2] === 'approve' ? 'approved' : 'denied';
    const req = await env.DB.prepare('SELECT * FROM time_off_requests WHERE id = ?').bind(m[1]).first();
    if (req?.status === 'pending') {
      if (status === 'approved' && needsBackup(req) && !req.backup_zoho_id) return redirect('/admin/time-off?msg=choose-backup');
      await env.DB.prepare('UPDATE time_off_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
        .bind(status, user.id, now.toISOString(), req.id).run();
      if (status === 'approved') {
        // A request for some projects only leaves the VA working on the others, so past days stay as they were.
        if (!req.project_ids) await markPeriod(env, req);
        if (needsBackup(req) && !(await makeChecklist(env, req.id))) return redirect('/admin/time-off?msg=clickup-failed');
      }
    }
    return redirect(`/admin/time-off?msg=${status}`);
  }

  // An admin changes a request's VA, type, dates, whether coverage is needed, and who covers.
  if ((m = path.match(/^\/admin\/time-off\/(\d+)\/edit$/)) && method === 'POST') {
    const req = await env.DB.prepare("SELECT * FROM time_off_requests WHERE id = ? AND status IN ('pending', 'approved')").bind(m[1]).first();
    if (!req) return redirect('/admin/time-off');
    const va = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND is_va = 1').bind(field('user_id') || req.user_id).first();
    const start = field('start_date');
    const end = field('end_date');
    if (!va || !isDate(start) || !isDate(end) || end < start) return redirect('/admin/time-off?msg=bad-dates');
    const kind = field('kind') === 'emergency' ? 'emergency' : 'time_off';
    const needsCoverage = field('needs_coverage') === '1' ? 1 : 0;
    const backup = kind === 'time_off' && needsCoverage ? await backupCandidate(env, field('backup')) : null;
    if (req.status === 'approved' && kind === 'time_off' && needsCoverage && !backup) return redirect('/admin/time-off?msg=choose-backup');

    // For an approved request, first undo its effect on today and later days, then apply the new version.
    if (req.status === 'approved') await reopenDays(env, req, now);
    await env.DB.prepare(
      `UPDATE time_off_requests SET user_id = ?, kind = ?, start_date = ?, end_date = ?, needs_coverage = ?,
         backup_zoho_id = ?, backup_name = ?, project_ids = CASE WHEN user_id = ? THEN project_ids ELSE NULL END
       WHERE id = ?`
    ).bind(va.id, kind, start, end, needsCoverage, backup?.zoho_id || null, backup?.name || null, va.id, req.id).run();
    const updated = await env.DB.prepare('SELECT * FROM time_off_requests WHERE id = ?').bind(req.id).first();
    if (updated.status === 'approved') {
      if (!updated.project_ids) await markPeriod(env, updated);
      if (needsBackup(updated) && !updated.clickup_list_url && !(await makeChecklist(env, updated.id))) {
        return redirect('/admin/time-off?msg=clickup-failed');
      }
    }
    return redirect('/admin/time-off?msg=saved');
  }

  // Try again to create the ClickUp checklist for an approved coverage request.
  if ((m = path.match(/^\/admin\/time-off\/(\d+)\/clickup$/)) && method === 'POST') {
    const req = await env.DB.prepare("SELECT * FROM time_off_requests WHERE id = ? AND status = 'approved'").bind(m[1]).first();
    if (req && needsBackup(req) && !req.clickup_list_url) {
      return redirect(`/admin/time-off?msg=${(await makeChecklist(env, req.id)) ? 'clickup-created' : 'clickup-failed'}`);
    }
    return redirect('/admin/time-off');
  }

  // A form response whose name matched no VA: an admin picks the VA and the projects it covers
  // (all of that VA's projects are ticked to start with). It then becomes a normal request.
  if ((m = path.match(/^\/admin\/form-unmatched\/(\d+)\/(assign|discard)$/)) && method === 'POST') {
    const row = await env.DB.prepare('SELECT * FROM form_unmatched WHERE id = ?').bind(m[1]).first();
    if (row && m[2] === 'assign') {
      const va = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND is_va = 1').bind(field('user_id')).first();
      if (!va) return redirect('/admin/time-off?msg=choose-va');
      const { results: theirs } = await env.DB.prepare(
        'SELECT p.id FROM assignments a JOIN projects p ON p.id = a.project_id WHERE a.user_id = ? AND p.active = 1'
      ).bind(va.id).all();
      const theirIds = theirs.map((p) => p.id);
      const chosen = fieldAll(`projects_${va.id}`).filter((id) => theirIds.includes(id));
      if (theirIds.length && !chosen.length) return redirect('/admin/time-off?msg=choose-projects');
      // All of the VA's projects ticked means the whole day, which is stored as "no project list".
      const projectIds = chosen.length && chosen.length < theirIds.length ? chosen.join(',') : null;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO time_off_requests (user_id, start_date, end_date, needs_coverage, note, details, source, form_response_id, project_ids)
           VALUES (?, ?, ?, 1, ?, ?, 'form', ?, ?)`
        ).bind(va.id, row.start_date, row.end_date, row.note, [`Name in the form: ${row.name}`, row.details].filter(Boolean).join('\n'),
          row.form_response_id, projectIds),
        env.DB.prepare('DELETE FROM form_unmatched WHERE id = ?').bind(row.id),
      ]);
    } else if (row) {
      await env.DB.prepare('DELETE FROM form_unmatched WHERE id = ?').bind(row.id).run();
    }
    return redirect(`/admin/time-off?msg=${m[2] === 'assign' ? 'saved' : 'removed'}`);
  }

  // An admin adds a time-off or coverage period directly. It applies right away.
  if (path === '/admin/time-off/add' && method === 'POST') {
    const va = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND is_va = 1').bind(field('user_id')).first();
    const start = field('start_date');
    const end = field('end_date');
    if (!va || !isDate(start) || !isDate(end) || end < start) return redirect('/admin/time-off?msg=bad-dates');
    const kind = field('kind') === 'emergency' ? 'emergency' : 'time_off';
    const needsCoverage = field('needs_coverage') === '1' ? 1 : 0;
    const backup = kind === 'time_off' && needsCoverage ? await backupCandidate(env, field('backup')) : null;
    if (kind === 'time_off' && needsCoverage && !backup) return redirect('/admin/time-off?msg=choose-backup');
    const res = await env.DB.prepare(
      `INSERT INTO time_off_requests (user_id, start_date, end_date, note, status, kind, needs_coverage, backup_zoho_id, backup_name,
         added_by_admin, source, decided_by, decided_at)
       VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?, 1, 'admin', ?, ?)`
    ).bind(va.id, start, end, field('note').slice(0, 1000) || null, kind, needsCoverage, backup?.zoho_id || null, backup?.name || null,
      user.id, now.toISOString()).run();
    const id = res.meta.last_row_id;
    await markPeriod(env, { user_id: va.id, start_date: start, end_date: end, kind });
    if (backup && !(await makeChecklist(env, id))) return redirect('/admin/time-off?msg=clickup-failed');
    return redirect('/admin/time-off?msg=period-added');
  }

  // Cancelling a period: check-ins are expected again from the VA's today onward.
  if ((m = path.match(/^\/admin\/time-off\/(\d+)\/cancel$/)) && method === 'POST') {
    const req = await env.DB.prepare("SELECT * FROM time_off_requests WHERE id = ? AND status = 'approved'").bind(m[1]).first();
    if (req) {
      await env.DB.prepare('UPDATE time_off_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
        .bind('cancelled', user.id, now.toISOString(), req.id).run();
      await reopenDays(env, req, now);
    }
    return redirect('/admin/time-off?msg=period-cancelled');
  }

  if (path === '/admin/people' && method === 'GET') {
    return page(views.peoplePage({ user, people: await allPeople(env), onDeck: await onDeckVAs(env), message }));
  }

  if (path === '/admin/sync' && method === 'POST') {
    const back = field('back') === '/admin/projects' ? '/admin/projects' : '/admin/people';
    try {
      await syncFromZoho(env);
      return redirect(`${back}?msg=synced`);
    } catch (err) {
      console.error(err.message);
      return redirect(`${back}?msg=sync-failed`);
    }
  }

  if ((m = path.match(/^\/admin\/people\/(\d+)\/temp-password$/)) && method === 'POST') {
    const person = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(m[1]).first();
    if (!person) return redirect('/admin/people');
    const password = await newTemporaryPassword(env, person);
    if (person.id === user.id) return redirect('/login');
    return page(views.peoplePage({ user, people: await allPeople(env), onDeck: await onDeckVAs(env), tempPassword: { name: person.name, password } }));
  }

  // Sends a login invite (email, plus Slack for VAs) with a new temporary password.
  if ((m = path.match(/^\/admin\/people\/(\d+)\/invite$/)) && method === 'POST') {
    const person = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND (is_va = 1 OR is_admin = 1)').bind(m[1]).first();
    if (!person) return redirect('/admin/people');
    const sent = await sendInvite(env, person);
    if (person.id === user.id) return redirect('/login');
    return page(views.peoplePage({
      user, people: await allPeople(env), onDeck: await onDeckVAs(env),
      tempPassword: { name: person.name, password: sent.password, emailed: sent.emailed, slacked: sent.slacked, email: person.email },
    }));
  }

  // ---- Projects and assignments ----

  if (path === '/admin/projects' && method === 'GET') {
    const { results: projects } = await env.DB.prepare('SELECT * FROM projects WHERE active = 1 ORDER BY client, name').all();
    const { results: assignments } = await env.DB.prepare(
      `SELECT a.*, u.name AS va_name, u.time_zone FROM assignments a JOIN users u ON u.id = a.user_id
       JOIN projects p ON p.id = a.project_id WHERE p.active = 1 ORDER BY u.name`
    ).all();
    const { results: vas } = await env.DB.prepare('SELECT id, name, time_zone FROM users WHERE is_va = 1 ORDER BY name').all();
    return page(views.projectsPage({ user, projects, assignments, vas, message }));
  }

  if ((m = path.match(/^\/admin\/projects\/(\d+)\/assign$/)) && method === 'POST') {
    const va = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND is_va = 1').bind(field('user_id')).first();
    const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(m[1]).first();
    if (va && project) {
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO assignments (project_id, user_id, start_time, days) VALUES (?, ?, ?, ?)')
          .bind(project.id, va.id, isTime(field('start_time')) ? field('start_time') : null, cleanDays(fieldAll('days'))),
        env.DB.prepare('UPDATE projects SET assignment_locked = 1 WHERE id = ?').bind(project.id),
      ]);
    }
    return redirect('/admin/projects?msg=saved');
  }

  if ((m = path.match(/^\/admin\/assignments\/(\d+)$/)) && method === 'POST') {
    await env.DB.prepare('UPDATE assignments SET start_time = ?, days = ? WHERE id = ?')
      .bind(isTime(field('start_time')) ? field('start_time') : null, cleanDays(fieldAll('days')), m[1]).run();
    return redirect('/admin/projects?msg=saved');
  }

  if ((m = path.match(/^\/admin\/assignments\/(\d+)\/delete$/)) && method === 'POST') {
    const a = await env.DB.prepare('SELECT project_id FROM assignments WHERE id = ?').bind(m[1]).first();
    if (a) {
      // Locking the project stops the hourly sync from assigning it again.
      await env.DB.batch([
        env.DB.prepare('DELETE FROM assignments WHERE id = ?').bind(m[1]),
        env.DB.prepare('UPDATE projects SET assignment_locked = 1 WHERE id = ?').bind(a.project_id),
      ]);
    }
    return redirect('/admin/projects?msg=removed');
  }

  if ((m = path.match(/^\/admin\/people\/(\d+)\/exempt$/)) && method === 'POST') {
    await env.DB.prepare('UPDATE users SET exempt = ? WHERE id = ?').bind(field('exempt') === '1' ? 1 : 0, m[1]).run();
    return redirect('/admin/people?msg=saved');
  }

  if ((m = path.match(/^\/admin\/people\/(\d+)\/remove-admin$/)) && method === 'POST') {
    if (Number(m[1]) !== user.id) await env.DB.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').bind(m[1]).run();
    return redirect('/admin/people?msg=removed');
  }

  if (path === '/admin/people/add-admin' && method === 'POST') {
    const email = field('email').toLowerCase();
    const name = field('name');
    if (email && name) {
      await env.DB.prepare('INSERT INTO users (email, name, is_admin) VALUES (?, ?, 1) ON CONFLICT(email) DO UPDATE SET is_admin = 1')
        .bind(email, name).run();
    }
    return redirect('/admin/people?msg=admin-added');
  }

  if (path === '/admin/holidays') {
    if (method === 'POST') {
      const date = field('date');
      if (isDate(date) && field('name')) {
        await env.DB.prepare('INSERT OR REPLACE INTO holidays (date, name) VALUES (?, ?)').bind(date, field('name')).run();
      }
      return redirect('/admin/holidays?msg=saved');
    }
    const { results: holidays } = await env.DB.prepare('SELECT * FROM holidays WHERE date >= ? ORDER BY date')
      .bind(addDays(now.toISOString().slice(0, 10), -60)).all();
    return page(views.holidaysPage({ user, holidays, message }));
  }

  if ((m = path.match(/^\/admin\/holidays\/(\d{4}-\d{2}-\d{2})\/delete$/)) && method === 'POST') {
    await env.DB.prepare('DELETE FROM holidays WHERE date = ?').bind(m[1]).run();
    return redirect('/admin/holidays?msg=removed');
  }

  if (path === '/admin/settings' && method === 'GET') {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_email_error'").first();
    const emailError = row ? JSON.parse(row.value) : null;
    const { results: admins } = await env.DB.prepare('SELECT name, email FROM users WHERE is_admin = 1 ORDER BY name').all();
    const recipients = await getReportRecipients(env);
    return page(views.settingsPage({ user, grace: await getGraceMinutes(env), emailError, admins, recipients, message }));
  }

  if (path === '/admin/settings/notifications' && method === 'POST') {
    await env.DB.prepare('UPDATE users SET notify_time_off = ? WHERE id = ?').bind(field('notify_time_off') === '1' ? 1 : 0, user.id).run();
    return redirect('/admin/settings?msg=saved');
  }

  // Who gets the report emails: ticked admins plus any other addresses typed in (one per line).
  if (path === '/admin/settings/recipients' && method === 'POST') {
    const typed = field('other').split(/[\s,;]+/);
    const emails = [...fieldAll('admin_email'), ...typed]
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    const unique = [...new Set(emails)];
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('report_recipients', ?)").bind(JSON.stringify(unique)).run();
    return redirect('/admin/settings?msg=saved');
  }

  if (path === '/admin/settings/grace' && method === 'POST') {
    const grace = Math.min(9, Math.max(0, parseInt(field('grace'), 10) || 0));
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('grace_minutes', ?)").bind(String(grace)).run();
    return redirect('/admin/settings?msg=saved');
  }

  if ((m = path.match(/^\/admin\/reports\/(weekly|monthly)$/)) && method === 'POST') {
    const { emailed } = await sendReport(env, m[1], reportPeriod(m[1], now));
    return redirect(`/admin/settings?msg=${emailed ? 'report-sent' : 'report-email-failed'}`);
  }

  return redirect('/admin');
}

// When a period is approved or added, days in it that were open or missed now count as time off or coverage.
async function markPeriod(env, period) {
  await env.DB.prepare(
    "UPDATE attendance SET status = ? WHERE user_id = ? AND work_date BETWEEN ? AND ? AND status IN ('pending', 'missed')"
  ).bind(period.kind === 'emergency' ? 'emergency' : 'time_off', period.user_id, period.start_date, period.end_date).run();
}

// Undoes a request's effect from the VA's today onward: those days expect a check-in again.
async function reopenDays(env, req, now) {
  const va = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(req.user_id).first();
  if (!va) return;
  const today = (await dayInfo(env, va, now)).local.date;
  await env.DB.prepare(
    `UPDATE attendance SET status = 'pending' WHERE user_id = ? AND work_date BETWEEN ? AND ?
     AND status IN ('time_off', 'emergency', 'coverage') AND checked_in_at IS NULL`
  ).bind(req.user_id, today > req.start_date ? today : req.start_date, req.end_date).run();
}

// A "time off" request that needs coverage must have a backup VA, and gets a ClickUp checklist when approved.
const needsBackup = (req) => req.kind !== 'emergency' && Boolean(req.needs_coverage);

// A VA who can cover (Active or On Deck in Zoho), chosen by their Zoho record id.
async function backupCandidate(env, zohoId) {
  if (!zohoId) return null;
  return env.DB.prepare('SELECT * FROM backup_candidates WHERE zoho_id = ?').bind(zohoId).first();
}

// Creates the ClickUp checklist for a request and saves its link, or saves why it failed. Returns true on success.
async function makeChecklist(env, requestId) {
  const req = await env.DB.prepare(
    'SELECT r.*, u.name AS va_name FROM time_off_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?'
  ).bind(requestId).first();
  try {
    const url = await createCoverageChecklist(env, req);
    await env.DB.prepare('UPDATE time_off_requests SET clickup_list_url = ?, clickup_error = NULL WHERE id = ?').bind(url, requestId).run();
    return true;
  } catch (err) {
    console.error(`ClickUp checklist for request ${requestId} failed: ${err.message}`);
    await env.DB.prepare('UPDATE time_off_requests SET clickup_error = ? WHERE id = ?').bind(err.message.slice(0, 500), requestId).run();
    return false;
  }
}

// Checkbox values ["1", "3", "5"] -> "1,3,5" (only valid day numbers, in order).
function cleanDays(values) {
  return [...new Set(values.filter((v) => /^[0-6]$/.test(v)))].sort().join(',');
}

// On Deck VAs from Zoho (they don't log in or check in, but can cover for others).
async function onDeckVAs(env) {
  const { results } = await env.DB.prepare("SELECT * FROM backup_candidates WHERE status = 'On Deck' ORDER BY name").all();
  return results;
}

async function allPeople(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.*, (SELECT GROUP_CONCAT(p.client, ', ') FROM assignments a JOIN projects p ON p.id = a.project_id
       WHERE a.user_id = u.id AND p.active = 1) AS project_list
     FROM users u WHERE u.is_admin = 1 OR u.is_va = 1 ORDER BY u.name`
  ).all();
  return results;
}
