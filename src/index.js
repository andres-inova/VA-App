// The app's entry point: decides what happens for each web address,
// and runs the scheduled job every minute.

import { checkLogin, startSession, currentUser, endSession, endAllSessions, hashPassword, verifyPassword, passwordProblem, temporaryPassword } from './auth.js';
import { dayInfo, getGraceMinutes, runEveryMinute, reportPeriod, sendReport, getReportRecipients } from './jobs.js';
import { syncFromZoho } from './zoho.js';
import { handleFormWebhook } from './forms.js';
import { postToSlack, slackSafe } from './notify.js';
import { formatDate, formatTimeIn, addDays } from './time.js';
import { redirect, page, isDate, isTime } from './util.js';
import * as views from './views.js';

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
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
      return page(views.loginPage());
    }
    const result = await checkLogin(env, field('email').toLowerCase(), field('password'));
    if (result.error) return page(views.loginPage(result.error), 401);
    return redirect('/', await startSession(env, result.user.id));
  }

  if (path === '/logout' && method === 'POST') return redirect('/login', await endSession(request, env));

  // ---- Everything below needs a logged-in person ----

  const user = await currentUser(request, env);
  if (!user) return redirect('/login');

  if (path === '/account') return account(env, user, method, field, message);
  if (user.must_change_password) return redirect('/account');

  if (path === '/') return redirect(user.is_va ? '/va' : '/admin');

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
    if (today?.checked_in_at) return redirect('/va?msg=already-in');
    let status = 'checked_in';
    if (day.expected) {
      const grace = await getGraceMinutes(env);
      status = now <= new Date(day.scheduled.getTime() + grace * 60000) ? 'on_time' : 'late';
    }
    await env.DB.prepare(
      `INSERT INTO attendance (user_id, work_date, scheduled_start, checked_in_at, status, projects) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, work_date) DO UPDATE SET checked_in_at = excluded.checked_in_at, status = excluded.status,
         scheduled_start = excluded.scheduled_start, projects = excluded.projects`
    ).bind(user.id, day.local.date, day.scheduled?.toISOString() || null, now.toISOString(), status, day.projectNames || null).run();

    // If a late alert already went out, tell the channel the VA has now checked in.
    if (today?.alert_10_sent) {
      await postToSlack(env, env.CHECKIN_CHANNEL_ID,
        `:white_check_mark: *${slackSafe(user.name)}* checked in at ${formatTimeIn(now.toISOString(), day.zone)} ${day.zoneLabel}.`);
    }
    return redirect('/va?msg=checked-in');
  }

  if (path === '/va/callout' && method === 'POST') {
    const reason = field('reason').slice(0, 1000);
    if (reason.length < 3) return redirect('/va?msg=reason-needed');
    await env.DB.prepare(
      `INSERT INTO attendance (user_id, work_date, scheduled_start, status, callout_reason, projects) VALUES (?, ?, ?, 'called_out', ?, ?)
       ON CONFLICT (user_id, work_date) DO UPDATE SET status = 'called_out', callout_reason = excluded.callout_reason, projects = excluded.projects`
    ).bind(user.id, day.local.date, day.scheduled?.toISOString() || null, reason, day.projectNames || null).run();

    const covering = day.projectNames ? ` Projects affected: ${slackSafe(day.projectNames)}.` : '';
    const text = `:red_circle: *${slackSafe(user.name)}* called out today (${formatDate(day.local.date)}).${covering}\n>${slackSafe(reason).replace(/\n/g, '\n>')}`;
    if (user.slack_channel_id) {
      await postToSlack(env, user.slack_channel_id, text);
    } else {
      await postToSlack(env, env.CHECKIN_CHANNEL_ID, `${text}\n_(${slackSafe(user.name)} has no management channel set in Zoho, so this was posted here.)_`);
    }
    return redirect('/va?msg=called-out');
  }

  // Time-off and coverage requests are made with the Google Form (see src/forms.js).
  return redirect('/va');
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
        statusHtml: views.todayStatusHtml(row, day, now),
        checkedIn: row?.checked_in_at ? `${formatTimeIn(row.checked_in_at, day.zone)} ${day.zoneLabel}` : '',
        note: row?.callout_reason || (day.projectsOffNames ? `Off today for: ${day.projectsOffNames}` : ''),
      });
    }
    rows.sort((a, b) => a.exempt - b.exempt); // exempt VAs at the bottom; otherwise alphabetical
    return page(views.adminTodayPage({ user, rows, message }));
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
    const { results: vas } = await env.DB.prepare('SELECT id, name FROM users WHERE is_va = 1 ORDER BY name').all();
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
    return page(views.timeOffPage({
      user, pending: withProjects(pending), current: withProjects(current), recent: withProjects(recent),
      vas, unmatched, vaProjects, formUrl: env.TIME_OFF_FORM_URL, message,
    }));
  }

  if ((m = path.match(/^\/admin\/time-off\/(\d+)\/(approve|deny)$/)) && method === 'POST') {
    const status = m[2] === 'approve' ? 'approved' : 'denied';
    const req = await env.DB.prepare('SELECT * FROM time_off_requests WHERE id = ?').bind(m[1]).first();
    if (req?.status === 'pending') {
      await env.DB.prepare('UPDATE time_off_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
        .bind(status, user.id, now.toISOString(), req.id).run();
      // A request for some projects only leaves the VA working on the others, so past days stay as they were.
      if (status === 'approved' && !req.project_ids) await markPeriod(env, req);
    }
    return redirect(`/admin/time-off?msg=${status}`);
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
    const kind = field('kind') === 'coverage' ? 'coverage' : 'time_off';
    const res = await env.DB.prepare(
      `INSERT INTO time_off_requests (user_id, start_date, end_date, note, status, kind, added_by_admin, source, decided_by, decided_at)
       VALUES (?, ?, ?, ?, 'approved', ?, 1, 'admin', ?, ?)`
    ).bind(va.id, start, end, field('note').slice(0, 1000) || null, kind, user.id, now.toISOString()).run();
    await markPeriod(env, { user_id: va.id, start_date: start, end_date: end, kind, id: res.meta.last_row_id });
    return redirect('/admin/time-off?msg=period-added');
  }

  // Cancelling a period: check-ins are expected again from the VA's today onward.
  if ((m = path.match(/^\/admin\/time-off\/(\d+)\/cancel$/)) && method === 'POST') {
    const req = await env.DB.prepare("SELECT * FROM time_off_requests WHERE id = ? AND status = 'approved'").bind(m[1]).first();
    if (req) {
      await env.DB.prepare('UPDATE time_off_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
        .bind('cancelled', user.id, now.toISOString(), req.id).run();
      const va = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(req.user_id).first();
      const today = (await dayInfo(env, va, now)).local.date;
      await env.DB.prepare(
        `UPDATE attendance SET status = 'pending' WHERE user_id = ? AND work_date BETWEEN ? AND ?
         AND status IN ('time_off', 'coverage') AND checked_in_at IS NULL`
      ).bind(req.user_id, today > req.start_date ? today : req.start_date, req.end_date).run();
    }
    return redirect('/admin/time-off?msg=period-cancelled');
  }

  if (path === '/admin/people' && method === 'GET') {
    return page(views.peoplePage({ user, people: await allPeople(env), message }));
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
    const password = temporaryPassword();
    await env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?')
      .bind(await hashPassword(password), person.id).run();
    await endAllSessions(env, person.id);
    if (person.id === user.id) return redirect('/login');
    return page(views.peoplePage({ user, people: await allPeople(env), tempPassword: { name: person.name, password } }));
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
  ).bind(period.kind === 'coverage' ? 'coverage' : 'time_off', period.user_id, period.start_date, period.end_date).run();
}

// Checkbox values ["1", "3", "5"] -> "1,3,5" (only valid day numbers, in order).
function cleanDays(values) {
  return [...new Set(values.filter((v) => /^[0-6]$/.test(v)))].sort().join(',');
}

async function allPeople(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.*, (SELECT GROUP_CONCAT(p.client, ', ') FROM assignments a JOIN projects p ON p.id = a.project_id
       WHERE a.user_id = u.id AND p.active = 1) AS project_list
     FROM users u WHERE u.is_admin = 1 OR u.is_va = 1 ORDER BY u.name`
  ).all();
  return results;
}
