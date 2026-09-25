// What happens when a VA checks in or calls out. Used by the app's buttons and by the Slack commands.

import { dayInfo, getGraceMinutes } from './jobs.js';
import { postToSlack, slackSafe } from './notify.js';
import { formatDate, formatTimeIn } from './time.js';

// Returns { result: 'checked-in' | 'already-in', status, time, day }.
export async function checkIn(env, user, now = new Date()) {
  const day = await dayInfo(env, user, now);
  const today = await env.DB.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?')
    .bind(user.id, day.local.date).first();
  if (today?.checked_in_at) {
    return { result: 'already-in', status: today.status, time: formatTimeIn(today.checked_in_at, day.zone), day };
  }
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
  return { result: 'checked-in', status, time: formatTimeIn(now.toISOString(), day.zone), day };
}

// Returns { result: 'called-out' | 'reason-needed' }.
export async function callOut(env, user, reasonText, now = new Date()) {
  const reason = (reasonText || '').trim().slice(0, 1000);
  if (reason.length < 3) return { result: 'reason-needed' };
  const day = await dayInfo(env, user, now);
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
  return { result: 'called-out', day };
}
