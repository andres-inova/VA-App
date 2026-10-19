// The daily time check (time logging piece T5): each VA must log at least 1 hour per project on each of their
// workdays for that project. It fills the missed_time table (admin Time > Missed time) and, when an admin chose
// "Log and send Slack DMs", sends the VA a Slack direct message.
//
// - Switch (admin, on the Missed time page): Off (the default) / Log only / Log and send Slack DMs. Only days from
//   the day it was switched on are checked, never older days.
// - A project-day is checked once, after 12:30 AM the next day in the project's time zone (sent_log key
//   "timecheck:<zone>:<date>"). One zone-day per run, so each run stays small.
// - Skipped: the in-house project (everyone's, setting inhouse_project_id), days that are not the VA's workdays for the project, approved time off (whole day or that project),
//   emergencies, holidays, closed projects, VAs exempt from check-ins, and the days up to and including the day
//   the VA joined the project (assignment_starts). Coverage projects count only on the days the VA covers.
// - Minutes = all saved logs of the VA in the project for that day (work_date is already in the project's zone).
//   A running timer, or one stopped but not saved yet, does not count.
// - Safe to run twice: missed_time has one row per date + project + VA, and each DM is claimed before sending.

import { ZONES, partsIn, addDays, weekdayOf, weekdayIndex, zonedTimeToUtc, formatDate, projectZones } from './time.js';
import { postToSlack, slackSafe } from './notify.js';
import { isExempt } from './jobs.js';
import { sameClient } from './util.js';
import * as messages from './messages.js';

export const MINIMUM_MINUTES = 60;
export const MODES = { off: 'Off', log: 'Log only', send: 'Log and send Slack DMs' };
const DM_PER_RUN = 5;       // Slack messages per run at most; the rest go out in the next runs
const DM_MAX_AGE_DAYS = 4;  // a DM not sent within 4 days of the day is not sent any more
const CHECK_AFTER = 30;     // minutes after midnight (project time) before a day is checked
const LOOK_BACK = 3;        // a day missed by the job (app down) is still checked up to 3 days later

const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

// The switch: { mode: off|log|send, since: ISO time it was switched on, last: what the last check did }.
export async function getTimeCheck(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('time_check_mode', 'time_check_since', 'time_check_last')").all();
  return readSettings(results);
}
function readSettings(rows) {
  const get = (k) => rows.find((r) => r.key === k)?.value;
  let last = null;
  try { last = JSON.parse(get('time_check_last') || 'null'); } catch { last = null; }
  const mode = MODES[get('time_check_mode')] ? get('time_check_mode') : 'off';
  return { mode, since: get('time_check_since') || null, last };
}

// Saves the switch. Switching on from Off starts a new "since" (no back-fill); Log only <-> Send keeps it.
export async function setTimeCheck(env, mode, now = new Date()) {
  if (!MODES[mode]) return false;
  const cur = await getTimeCheck(env);
  const statements = [env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('time_check_mode', ?)").bind(mode)];
  if (mode !== 'off' && (cur.mode === 'off' || !cur.since)) {
    statements.push(env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('time_check_since', ?)").bind(now.toISOString()));
  }
  // Leaving "send": messages not sent yet are not sent later.
  if (mode !== 'send') statements.push(env.DB.prepare("UPDATE missed_time_state SET dm = 'none' WHERE dm = 'due'"));
  await env.DB.batch(statements);
  return true;
}

// The zone-days that may be checked now: for each zone, the last LOOK_BACK days that have ended (+ 30 minutes).
function candidateDays(now) {
  const list = [];
  for (const [label, zone] of Object.entries(ZONES)) {
    const local = partsIn(zone, now);
    const lastEnded = addDays(local.date, local.hour * 60 + local.minute >= CHECK_AFTER ? -1 : -2);
    for (let i = LOOK_BACK - 1; i >= 0; i -= 1) {
      const date = addDays(lastEnded, -i);
      list.push({ zone: label, date, key: `timecheck:${label}:${date}` });
    }
  }
  return list;
}

// Called by the every-minute job (not on the hour, when the Zoho sync runs). When Off it reads the switch and
// notes new assignments, nothing else.
export async function runTimeCheck(env, now = new Date()) {
  const days = candidateDays(now);
  const [{ results: set }, , , { results: done }] = await env.DB.batch([
    env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('time_check_mode', 'time_check_since', 'time_check_last')"),
    // When each VA joined each project (first time the job saw the assignment), and forget removed ones.
    env.DB.prepare('INSERT OR IGNORE INTO assignment_starts (project_id, user_id, first_seen) SELECT project_id, user_id, ? FROM assignments').bind(now.toISOString()),
    env.DB.prepare('DELETE FROM assignment_starts WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.project_id = assignment_starts.project_id AND a.user_id = assignment_starts.user_id)'),
    env.DB.prepare(`SELECT key FROM sent_log WHERE key IN (${days.map(() => '?').join(',')})`).bind(...days.map((d) => d.key)),
  ]);
  const tc = readSettings(set);
  if (tc.mode === 'off' || !tc.since) return { mode: tc.mode };
  const since = new Date(tc.since);
  const doneKeys = new Set(done.map((r) => r.key));
  // Oldest first; only days on or after the switch-on day (in that zone).
  const due = days.filter((d) => !doneKeys.has(d.key) && d.date >= partsIn(ZONES[d.zone], since).date)
    .sort((a, b) => a.date.localeCompare(b.date));
  let result = { mode: tc.mode };
  if (due.length) result = { ...result, ...(await checkZoneDay(env, due[0], tc, now)) };
  if (tc.mode === 'send') result.sent = await sendDueMessages(env, now);
  return result;
}

// Checks one day of every project in one time zone, and saves the misses (and marks the day as done) in one batch.
async function checkZoneDay(env, { zone, date, key }, tc, now) {
  const [{ results: rows }, { results: holiday }, { results: offs }, { results: covers }, { results: sums }] = await env.DB.batch([
    env.DB.prepare(
      `SELECT a.project_id, a.user_id, a.days, p.is_coverage, p.client, p.client_record_id, u.zoho_id, u.exempt, u.affiliation, s.first_seen
       FROM assignments a JOIN projects p ON p.id = a.project_id JOIN users u ON u.id = a.user_id
       LEFT JOIN assignment_starts s ON s.project_id = a.project_id AND s.user_id = a.user_id
       WHERE p.active = 1 AND u.is_va = 1
         AND p.id != COALESCE((SELECT value FROM settings WHERE key = 'inhouse_project_id'), '')`
    ),
    env.DB.prepare('SELECT name FROM holidays WHERE date = ?').bind(date),
    env.DB.prepare("SELECT user_id, project_ids FROM time_off_requests WHERE status = 'approved' AND ? BETWEEN start_date AND end_date").bind(date),
    env.DB.prepare(
      `SELECT DISTINCT cp.backup_zoho_id, cp.client, p.client_record_id FROM coverage_projects cp JOIN time_off_requests r ON r.id = cp.request_id
       LEFT JOIN projects p ON p.id = cp.project_id
       WHERE cp.backup_zoho_id IS NOT NULL AND cp.project_id != '' AND r.status = 'approved' AND r.kind != 'emergency' AND ? BETWEEN r.start_date AND r.end_date`
    ).bind(date),
    env.DB.prepare('SELECT user_id, project_id, SUM(minutes) AS minutes FROM time_logs WHERE work_date = ? AND deleted_at IS NULL GROUP BY user_id, project_id').bind(date),
  ]);
  const misses = [];
  let checked = 0;
  if (!holiday.length && rows.length) {
    const zones = await projectZones(env, rows.map((r) => r.project_id));
    const dayStart = zonedTimeToUtc(date, 0, 0, ZONES[zone]).toISOString();
    const weekday = String(weekdayIndex(weekdayOf(date)));
    const minutes = new Map(sums.map((r) => [`${r.user_id}|${r.project_id}`, Number(r.minutes) || 0]));
    for (const a of rows) {
      if ((zones.get(String(a.project_id)) || 'EST') !== zone) continue;
      if (isExempt(a)) continue;
      // Joined the project on this day or later (first seen after the day started): not checked.
      if (!a.first_seen || a.first_seen >= dayStart) continue;
      const scheduled = a.is_coverage
        ? covers.some((c) => c.backup_zoho_id === a.zoho_id && a.zoho_id && sameClient(c, a))
        : (a.days || '').split(',').includes(weekday);
      if (!scheduled) continue;
      const off = offs.filter((o) => o.user_id === a.user_id);
      if (off.some((o) => !o.project_ids || o.project_ids.split(',').includes(String(a.project_id)))) continue;
      checked += 1;
      const m = minutes.get(`${a.user_id}|${a.project_id}`) || 0;
      if (m < MINIMUM_MINUTES) misses.push({ d: date, p: String(a.project_id), u: a.user_id, m });
    }
  }
  const last = { at: now.toISOString(), zone, date, checked, missed: misses.length, holiday: holiday[0]?.name || null };
  const statements = [];
  if (misses.length) {
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO missed_time (work_date, project_id, user_id, minutes_logged, minimum)
       SELECT json_extract(value, '$.d'), json_extract(value, '$.p'), json_extract(value, '$.u'), json_extract(value, '$.m'), ? FROM json_each(?)`
    ).bind(MINIMUM_MINUTES, JSON.stringify(misses)));
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO missed_time_state (missed_id, dm) SELECT id, ? FROM missed_time WHERE work_date = ?')
      .bind(tc.mode === 'send' ? 'due' : 'none', date));
  }
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO sent_log (key) VALUES (?)').bind(key));
  statements.push(env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('time_check_last', ?)").bind(JSON.stringify(last)));
  await env.DB.batch(statements);
  return last;
}

// The Slack message to the VA about one missed day (standard format, messages.js).
export function missedMessage(env, row) {
  const first = (row.va_name || '').split(' ')[0] || 'there';
  const project = `${row.client || row.project_name || 'your project'}${row.is_coverage ? ' (coverage)' : ''}`;
  const day = formatDate(row.work_date, true);
  return messages.slack({
    title: '⏱️ Less than 1 hour logged',
    subtitle: `${day} · ${project}`,
    intro: `Hi ${slackSafe(first)}, on *${slackSafe(day)}* you logged *${hm(row.minutes_logged)}* in *${slackSafe(project)}*. Each workday needs at least *1 hour* logged per project.`,
    figures: [{ label: 'Logged', value: hm(row.minutes_logged) }, { label: 'Minimum', value: hm(row.minimum) }],
    details: ['• If you worked that day but didn’t log it, ask an admin for a *past-date exception* for that day and project, then add the time on the Time page (Log time).',
      '• Logs count on the day in the project’s time zone. A timer that was not saved does not count.'],
    button: { label: 'Open Log time', url: `${env.APP_URL || ''}/va/time?project=${encodeURIComponent(row.project_id)}` },
    footer: 'Days off, emergencies and holidays are not checked. Questions? Ask your VA lead.',
  });
}

// Sends up to DM_PER_RUN waiting messages. Each is claimed first (dm = 'sending'), so two runs never send the same one.
async function sendDueMessages(env, now) {
  const oldest = addDays(now.toISOString().slice(0, 10), -DM_MAX_AGE_DAYS);
  const { results: claimed } = await env.DB.prepare(
    `UPDATE missed_time_state SET dm = 'sending', dm_at = ?1 WHERE missed_id IN (
       SELECT s.missed_id FROM missed_time_state s JOIN missed_time m ON m.id = s.missed_id
       WHERE s.dm = 'due' AND s.excused_at IS NULL AND m.work_date >= ?2 ORDER BY m.work_date, m.id LIMIT ?3) AND dm = 'due' RETURNING missed_id`
  ).bind(now.toISOString(), oldest, DM_PER_RUN).all();
  if (!claimed.length) return 0;
  const ids = claimed.map((r) => r.missed_id);
  const { results: rows } = await env.DB.prepare(
    `SELECT m.*, u.name AS va_name, u.slack_user_id, p.client, p.name AS project_name, p.is_coverage FROM missed_time m
     JOIN users u ON u.id = m.user_id LEFT JOIN projects p ON p.id = m.project_id WHERE m.id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();
  const outcome = [];
  for (const row of rows) {
    if (!row.slack_user_id) { outcome.push({ id: row.id, dm: 'no_slack', error: 'No Slack ID on the VA record' }); continue; }
    const msg = missedMessage(env, row);
    let ok = false;
    try { ok = await postToSlack(env, row.slack_user_id, msg.text, msg.blocks); } catch (err) { console.error(`Time check DM failed: ${err.message}`); }
    outcome.push({ id: row.id, dm: ok ? 'sent' : 'failed', error: ok ? null : 'Slack did not accept the message' });
  }
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE missed_time_state SET dm = json_extract(j.value, '$.dm'), dm_error = json_extract(j.value, '$.error'), dm_at = ?
      FROM json_each(?) j WHERE missed_time_state.missed_id = json_extract(j.value, '$.id')`).bind(at, JSON.stringify(outcome)),
    env.DB.prepare(`UPDATE missed_time SET notified_at = ? WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?) WHERE json_extract(value, '$.dm') = 'sent')`)
      .bind(at, JSON.stringify(outcome)),
  ]);
  return outcome.filter((o) => o.dm === 'sent').length;
}
