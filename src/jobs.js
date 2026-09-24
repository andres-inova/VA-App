// The job that runs every minute: late alerts, reports and the Zoho sync.

import { REPORT_ZONE, zoneFor, partsIn, zonedTimeToUtc, parseHHMM, weekdayIndex, addDays, formatHM, formatDate } from './time.js';
import { postToSlack, sendEmail, slackSafe } from './notify.js';
import { syncFromZoho } from './zoho.js';
import { esc } from './util.js';

const ALERT_WINDOW_MINUTES = 120; // Never send a late alert more than 2 hours after the start time.

export async function getGraceMinutes(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'grace_minutes'").first();
  return row ? Number(row.value) : 0;
}

// A VA is exempt (never expected to check in) when an admin marked them exempt in the app,
// or when their Zoho "VA Company Affiliation" is anything other than "InoVA Local" (including empty).
export function isExempt(user) {
  return Boolean(user.exempt) || (user.affiliation || '').trim() !== 'InoVA Local';
}

// Everything about a VA's day: their local date, today's projects, and whether a check-in is expected.
// A VA with several projects today checks in once, by the earliest start time, and that check-in covers all of them.
export async function dayInfo(env, user, now = new Date()) {
  const zoneLabel = zoneFor(user.time_zone) ? user.time_zone : 'EST';
  const zone = zoneFor(zoneLabel);
  const local = partsIn(zone, now);
  const today = String(weekdayIndex(local.weekday));

  const { results: assignments } = await env.DB.prepare(
    `SELECT a.project_id, a.start_time, a.days, p.client FROM assignments a JOIN projects p ON p.id = a.project_id
     WHERE a.user_id = ? AND p.active = 1 ORDER BY a.start_time IS NULL, a.start_time, p.client`
  ).bind(user.id).all();
  const allToday = assignments
    .filter((a) => a.days.split(',').includes(today))
    .map((a) => ({ id: a.project_id, client: a.client, start: parseHHMM(a.start_time) }));

  // Approved time off today. A request with no project list covers the whole day;
  // one with a project list covers only those projects.
  const { results: offs } = await env.DB.prepare(
    "SELECT kind, project_ids FROM time_off_requests WHERE user_id = ? AND status = 'approved' AND ? BETWEEN start_date AND end_date"
  ).bind(user.id, local.date).all();
  const wholeDayOff = offs.find((o) => !o.project_ids);
  const offIds = new Set(offs.flatMap((o) => (o.project_ids || '').split(',').filter(Boolean)));
  const working = wholeDayOff ? [] : allToday.filter((p) => !offIds.has(p.id));
  const projectsOff = wholeDayOff ? [] : allToday.filter((p) => offIds.has(p.id));
  // Off for the day when a request covers the whole day, or covers every project the VA has today.
  const onTimeOff = Boolean(wholeDayOff) || (projectsOff.length > 0 && working.length === 0);
  // On a day off, keep today's projects so the day is still recorded (as time off) in History.
  const projects = onTimeOff ? allToday : working;
  const timed = projects.filter((p) => p.start);
  const start = timed.length ? timed[0].start : null; // already sorted, so the first is the earliest

  const exempt = isExempt(user);
  const holiday = await env.DB.prepare('SELECT name FROM holidays WHERE date = ?').bind(local.date).first();
  const expected = Boolean(start) && !holiday && !exempt;
  const scheduled = expected ? zonedTimeToUtc(local.date, start.hour, start.minute, zone) : null;
  const offKind = (wholeDayOff || offs[0])?.kind;
  return {
    zone, zoneLabel, local, start, holiday, expected, scheduled, exempt,
    onTimeOff,
    timeOffKind: offKind === 'emergency' ? 'emergency' : 'time_off',
    projects,
    projectNames: projects.map((p) => p.client).join(', '),
    projectsOffNames: onTimeOff ? '' : projectsOff.map((p) => p.client).join(', '),
    startLabel: start ? `${formatHM(start)} ${zoneLabel}` : null,
  };
}

async function checkShifts(env, now) {
  const { results: vas } = await env.DB.prepare('SELECT * FROM users WHERE is_va = 1').all();
  for (const va of vas) {
    const day = await dayInfo(env, va, now);
    if (day.exempt) {
      // If the VA became exempt today, today's open check-in no longer counts.
      await env.DB.prepare("UPDATE attendance SET status = 'exempt' WHERE user_id = ? AND work_date = ? AND status = 'pending'")
        .bind(va.id, day.local.date).run();
      continue;
    }
    if (!day.expected) continue;

    await env.DB.prepare(
      'INSERT OR IGNORE INTO attendance (user_id, work_date, scheduled_start, status, projects) VALUES (?, ?, ?, ?, ?)'
    ).bind(va.id, day.local.date, day.scheduled.toISOString(), day.onTimeOff ? day.timeOffKind : 'pending', day.projectNames).run();
    // Keep the start time and project list current in case an admin changed an assignment today.
    await env.DB.prepare("UPDATE attendance SET scheduled_start = ?, projects = ? WHERE user_id = ? AND work_date = ? AND status = 'pending'")
      .bind(day.scheduled.toISOString(), day.projectNames, va.id, day.local.date).run();
    if (day.onTimeOff) {
      await env.DB.prepare("UPDATE attendance SET status = ? WHERE user_id = ? AND work_date = ? AND status = 'pending'")
        .bind(day.timeOffKind, va.id, day.local.date).run();
      continue;
    }

    const row = await env.DB.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?')
      .bind(va.id, day.local.date).first();
    if (row.status !== 'pending') continue;

    const minutesLate = (now - day.scheduled) / 60000;
    if (minutesLate >= ALERT_WINDOW_MINUTES) continue;

    const projects = slackSafe(day.projectNames);
    // Mark the alert as sent first, so two overlapping runs never send it twice.
    if (minutesLate >= 10 && (await claim(env, row.id, 'alert_10_sent'))) {
      await postToSlack(env, env.CHECKIN_CHANNEL_ID,
        `:warning: <@${env.VA_LEAD_SLACK_ID}> *${slackSafe(va.name)}* has not checked in. Their first project today started at ${day.startLabel} (${projects}).`);
      if (va.slack_channel_id) {
        await postToSlack(env, va.slack_channel_id,
          `:warning: ${va.slack_user_id ? `<@${va.slack_user_id}>` : `*${slackSafe(va.name)}*`} has not checked in yet. Your first project today started at ${day.startLabel} (${projects}).`);
      }
    }
    if (minutesLate >= 15 && (await claim(env, row.id, 'alert_15_sent'))) {
      await postToSlack(env, env.CHECKIN_CHANNEL_ID,
        `:rotating_light: <@${env.KELLI_SLACK_ID}> *${slackSafe(va.name)}* still has not checked in, 15 minutes after their ${day.startLabel} start (${projects}).`);
    }
  }

  // A shift with no check-in 12 hours after it started counts as missed.
  const cutoff = new Date(now - 12 * 3600000).toISOString();
  await env.DB.prepare("UPDATE attendance SET status = 'missed' WHERE status = 'pending' AND scheduled_start < ?")
    .bind(cutoff).run();
}

async function claim(env, attendanceId, column) {
  const res = await env.DB.prepare(`UPDATE attendance SET ${column} = 1 WHERE id = ? AND ${column} = 0`)
    .bind(attendanceId).run();
  return res.meta.changes === 1;
}

// ---- Reports ----

// The last complete week (Monday to Sunday) or month before "now", on Eastern time.
export function reportPeriod(kind, now = new Date()) {
  const today = partsIn(REPORT_ZONE, now).date;
  if (kind === 'weekly') {
    const daysSinceMonday = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(partsIn(REPORT_ZONE, now).weekday));
    const thisMonday = addDays(today, -daysSinceMonday);
    return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
  }
  const firstOfThisMonth = `${today.slice(0, 8)}01`;
  const end = addDays(firstOfThisMonth, -1);
  return { start: `${end.slice(0, 8)}01`, end };
}

export async function buildReport(env, kind, period) {
  const threshold = kind === 'weekly' ? 2 : 3;
  const { results } = await env.DB.prepare(
    `SELECT u.name, a.work_date, a.status FROM attendance a JOIN users u ON u.id = a.user_id
     WHERE a.work_date BETWEEN ? AND ? AND a.status IN ('late', 'missed')
     ORDER BY u.name, a.work_date`
  ).bind(period.start, period.end).all();

  const byPerson = new Map();
  for (const r of results) {
    if (!byPerson.has(r.name)) byPerson.set(r.name, []);
    byPerson.get(r.name).push(r);
  }
  const people = [...byPerson.entries()]
    .filter(([, rows]) => rows.length >= threshold)
    .map(([name, rows]) => ({
      name,
      total: rows.length,
      late: rows.filter((r) => r.status === 'late').length,
      missed: rows.filter((r) => r.status === 'missed').length,
      days: rows.map((r) => `${formatDate(r.work_date)} (${r.status === 'late' ? 'late' : 'no check-in'})`),
    }));

  const title = kind === 'weekly' ? 'Weekly check-in report' : 'Monthly check-in report';
  const range = `${formatDate(period.start, true)} to ${formatDate(period.end, true)}`;
  const rule = kind === 'weekly' ? 'VAs who missed more than one on-time check-in' : 'VAs who missed 3 or more on-time check-ins';

  const lines = people.map((p) => `• ${slackSafe(p.name)}: ${p.total} missed (${p.late} late, ${p.missed} no check-in). ${p.days.join(', ')}`);
  const empty = 'Nobody reached this number. :tada:';
  const slack = `*${title}* (${range})\n${rule}:\n${lines.length ? lines.join('\n') : empty}`;
  const text = `${title} (${range})\n${rule}:\n\n${lines.length ? lines.join('\n') : 'Nobody reached this number.'}\n\n"Missed" means the VA checked in late or did not check in. Call-outs and approved time off are not counted.`;
  const html = `<h2>${esc(title)}</h2><p>${esc(range)}<br>${esc(rule)}:</p>` +
    (people.length
      ? `<table cellpadding="6" style="border-collapse:collapse" border="1"><tr><th align="left">VA</th><th>Missed</th><th>Late</th><th>No check-in</th><th align="left">Days</th></tr>` +
        people.map((p) => `<tr><td>${esc(p.name)}</td><td align="center">${p.total}</td><td align="center">${p.late}</td><td align="center">${p.missed}</td><td>${esc(p.days.join(', '))}</td></tr>`).join('') +
        '</table>'
      : '<p>Nobody reached this number.</p>') +
    '<p style="color:#666">"Missed" means the VA checked in late or did not check in. Call-outs and approved time off are not counted.</p>' +
    (env.APP_URL ? `<p><a href="${esc(env.APP_URL)}/admin/history">Open the check-in tracker</a></p>` : '');

  return { title: `${title}: ${range}`, slack, text, html };
}

// Who gets the weekly and monthly report emails. Admins choose this on the Settings page;
// until someone saves a choice, every admin gets them.
export async function getReportRecipients(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'report_recipients'").first();
  if (row) return JSON.parse(row.value);
  const { results: admins } = await env.DB.prepare('SELECT email FROM users WHERE is_admin = 1 ORDER BY name').all();
  return admins.map((a) => a.email);
}

// Posts the report in Slack and sends it as one email with every recipient on it.
export async function sendReport(env, kind, period) {
  const report = await buildReport(env, kind, period);
  await postToSlack(env, env.CHECKIN_CHANNEL_ID, report.slack);
  const recipients = await getReportRecipients(env);
  if (!recipients.length) return { emailed: true, recipients };
  const emailed = await sendEmail(env, recipients.join(', '), report.title, report.text, report.html);
  return { emailed, recipients };
}

async function maybeSendReports(env, now) {
  const et = partsIn(REPORT_ZONE, now);
  if (et.hour !== 9) return;
  const due = [];
  if (et.weekday === 'Mon') due.push('weekly');
  if (et.day === 1) due.push('monthly');
  for (const kind of due) {
    const res = await env.DB.prepare('INSERT OR IGNORE INTO sent_log (key) VALUES (?)').bind(`${kind}:${et.date}`).run();
    if (res.meta.changes === 1) await sendReport(env, kind, reportPeriod(kind, now));
  }
}

// ---- The every-minute job ----

async function safely(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} failed: ${err.stack || err.message}`);
  }
}

export async function runEveryMinute(env, now = new Date()) {
  const vaCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_va = 1').first();
  if (now.getUTCMinutes() === 0 || vaCount.n === 0) await safely('Zoho sync', () => syncFromZoho(env));
  await safely('Shift check', () => checkShifts(env, now));
  await safely('Reports', () => maybeSendReports(env, now));
}
