// The job that runs every minute: late alerts, reports and the Zoho sync.

import { REPORT_ZONE, zoneFor, partsIn, zonedTimeToUtc, parseHHMM, weekdayIndex, addDays, formatHM, formatDate } from './time.js';
import { postToSlack, sendEmail, slackSafe } from './notify.js';
import { syncFromZoho } from './zoho.js';
import { esc } from './util.js';
import * as messages from './messages.js';

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
    `SELECT a.project_id, a.start_time, a.time_zone, a.days, p.client FROM assignments a JOIN projects p ON p.id = a.project_id
     WHERE a.user_id = ? AND p.active = 1 ORDER BY p.client`
  ).bind(user.id).all();
  // Each start time is in the assignment's own time zone, or the VA's when none is set.
  const allToday = assignments
    .filter((a) => a.days.split(',').includes(today))
    .map((a) => {
      const start = parseHHMM(a.start_time);
      const label = zoneFor(a.time_zone) ? a.time_zone : zoneLabel;
      const at = start ? zonedTimeToUtc(local.date, start.hour, start.minute, zoneFor(label)) : null;
      return { id: a.project_id, client: a.client, start, zoneLabel: label, at, startLabel: start ? `${formatHM(start)} ${label}` : null };
    })
    .sort((x, y) => (x.at && y.at ? x.at - y.at : x.at ? -1 : y.at ? 1 : x.client.localeCompare(y.client)));

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
  const first = timed[0] || null; // already sorted, so the first is the earliest
  const start = first ? first.start : null;

  const exempt = isExempt(user);
  const holiday = await env.DB.prepare('SELECT name FROM holidays WHERE date = ?').bind(local.date).first();
  const expected = Boolean(start) && !holiday && !exempt;
  const scheduled = expected ? first.at : null;
  const offKind = (wholeDayOff || offs[0])?.kind;
  return {
    zone, zoneLabel, local, start, holiday, expected, scheduled, exempt,
    onTimeOff,
    timeOffKind: offKind === 'emergency' ? 'emergency' : 'time_off',
    projects,
    projectNames: projects.map((p) => p.client).join(', '),
    projectsOffNames: onTimeOff ? '' : projectsOff.map((p) => p.client).join(', '),
    startLabel: first ? first.startLabel : null,
  };
}

// Admins can pause all check-ins (Settings). While paused, no check-ins are expected, no late alerts
// are sent and no day counts as missed. After resuming, only shifts that start after that moment count.
export async function checkinPause(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('checkins_paused', 'checkins_resumed_at')").all();
  const get = (k) => results.find((r) => r.key === k)?.value;
  return { paused: get('checkins_paused') === '1', resumedAt: get('checkins_resumed_at') || null };
}

async function checkShifts(env, now) {
  const pause = await checkinPause(env);
  if (pause.paused) return;
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
    // Shifts that started while check-ins were paused don't count.
    if (pause.resumedAt && day.scheduled.toISOString() < pause.resumedAt) continue;

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

// Counts check-ins for a date range: how many were on time, late, missing, and days off.
export async function checkInStats(env, start, end) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, a.work_date, a.status FROM attendance a JOIN users u ON u.id = a.user_id
     WHERE a.work_date BETWEEN ? AND ? ORDER BY u.name, a.work_date`
  ).bind(start, end).all();
  const count = (...statuses) => results.filter((r) => statuses.includes(r.status)).length;
  const onTime = count('on_time');
  const late = count('late');
  const missed = count('missed');
  const expected = onTime + late + missed;
  return {
    rows: results, onTime, late, missed, expected,
    calledOut: count('called_out'),
    daysOff: count('time_off', 'emergency', 'coverage'),
    rate: expected ? Math.round((onTime * 100) / expected) : null,
  };
}

// VAs with at least `threshold` late or missing check-ins in the rows.
export function flaggedVAs(rows, threshold) {
  const byPerson = new Map();
  for (const r of rows.filter((x) => x.status === 'late' || x.status === 'missed')) {
    if (!byPerson.has(r.name)) byPerson.set(r.name, { id: r.id, name: r.name, late: [], missed: [] });
    byPerson.get(r.name)[r.status === 'late' ? 'late' : 'missed'].push(r.work_date);
  }
  return [...byPerson.values()]
    .map((p) => ({ ...p, total: p.late.length + p.missed.length }))
    .filter((p) => p.total >= threshold)
    .sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));
}

// The weekly or monthly report, in the standard message format (see messages.js), for Slack and email.
export async function buildReport(env, kind, period) {
  const weekly = kind === 'weekly';
  const threshold = weekly ? 2 : 3;
  const stats = await checkInStats(env, period.start, period.end);
  const people = flaggedVAs(stats.rows, threshold);

  const title = weekly ? '📊 Weekly check-in report' : '📅 Monthly check-in report';
  const subtitle = `${formatDate(period.start, true)} to ${formatDate(period.end, true)}`;
  const rule = weekly ? '2 or more late or missing check-ins' : '3 or more late or missing check-ins';
  const intro = people.length
    ? `${people.length} VA${people.length > 1 ? 's' : ''} had ${rule} ${weekly ? 'last week' : 'last month'}.`
    : `Nobody had ${rule} ${weekly ? 'last week' : 'last month'}. Nice work, team! 🎉`;
  const figures = [
    { label: 'On-time rate', value: stats.rate === null ? '–' : `${stats.rate}%` },
    { label: 'On time', value: String(stats.onTime) },
    { label: 'Late', value: String(stats.late) },
    { label: 'No check-in', value: String(stats.missed) },
    { label: 'Call-outs', value: String(stats.calledOut) },
    { label: 'Days off', value: String(stats.daysOff) },
  ];
  const dayList = (dates) => dates.map((d) => formatDate(d)).join(' · ');
  const personLine = (p) => [p.late.length && `${p.late.length} late (${dayList(p.late)})`, p.missed.length && `${p.missed.length} no check-in (${dayList(p.missed)})`].filter(Boolean).join('; ');
  const button = { label: 'Open History in the app', url: `${env.APP_URL}/admin/history?month=${period.start.slice(0, 7)}` };
  const footer = 'On time means checked in by the start time (plus the grace period). Call-outs, approved time off and holidays are not counted as missed.';

  const slackMsg = messages.slack({
    title, subtitle, intro: people.length ? `*${intro}*` : intro, figures,
    details: people.map((p) => `• *${slackSafe(p.name)}*: ${slackSafe(personLine(p))}`),
    button, footer,
  });
  const mail = messages.email({
    title, subtitle, intro: `<strong>${esc(intro)}</strong>`, figures,
    details: people.length ? messages.emailTable(['VA', 'Late', 'No check-in', 'Days'],
      people.map((p) => [`<strong>${esc(p.name)}</strong>`, String(p.late.length), String(p.missed.length), esc(dayList([...p.late, ...p.missed].sort()))])) : '',
    plainDetails: people.map((p) => `- ${p.name}: ${personLine(p)}`).join('\n'),
    button, footer: esc(footer),
  });
  return { subject: `${title.replace(/^\S+\s/, '')}: ${subtitle}`, slack: slackMsg, email: mail };
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
  await postToSlack(env, env.CHECKIN_CHANNEL_ID, report.slack.text, report.slack.blocks);
  const recipients = await getReportRecipients(env);
  if (!recipients.length) return { emailed: true, recipients };
  const emailed = await sendEmail(env, recipients.join(', '), report.subject, report.email.text, report.email.html);
  return { emailed, recipients };
}

async function maybeSendReports(env, now) {
  if ((await checkinPause(env)).paused) return;
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
  await safely('Timers', () => stopLongTimers(env, now));
}

// A timer stops by itself after 8 hours. It then waits on the VA's Tasks & time page to be saved with notes.
export const TIMER_MAX_HOURS = 8;
async function stopLongTimers(env, now) {
  const cutoff = new Date(now.getTime() - TIMER_MAX_HOURS * 3600000).toISOString();
  const { results } = await env.DB.prepare('SELECT user_id, started_at FROM timers WHERE stopped_at IS NULL AND started_at <= ?').bind(cutoff).all();
  for (const t of results) {
    const stop = new Date(Date.parse(t.started_at) + TIMER_MAX_HOURS * 3600000).toISOString();
    await env.DB.prepare('UPDATE timers SET stopped_at = ?, auto_stopped = 1 WHERE user_id = ? AND stopped_at IS NULL').bind(stop, t.user_id).run();
  }
}
