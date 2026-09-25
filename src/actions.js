// What happens when a VA checks in. Used by the app's button, the Slack /checkin command and the first timer of the day.

import { dayInfo, getGraceMinutes } from './jobs.js';
import { postToSlack, slackSafe } from './notify.js';
import { formatTimeIn } from './time.js';

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
