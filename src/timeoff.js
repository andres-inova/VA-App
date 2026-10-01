// Other time off the same VA has close to a request, so admins notice several days off in a short time
// (clients don't like, for example, 2 days off in less than a week).

import { addDays, formatDate } from './time.js';

// Two periods count as "nearby" when 7 days or fewer separate them (or they overlap).
export const NEARBY_DAYS = 7;

const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;

export function isNearby(a, b) {
  return b.end_date >= addDays(a.start_date, -NEARBY_DAYS) && b.start_date <= addDays(a.end_date, NEARBY_DAYS);
}

// For example "Fri, Oct 2 (4 days before)", "Mon, Oct 12 – Tue, Oct 13 (2 days after, waiting for a decision)".
export function nearbyText(r, other) {
  const dates = other.start_date === other.end_date
    ? formatDate(other.start_date) : `${formatDate(other.start_date)} – ${formatDate(other.end_date)}`;
  const before = dayNumber(r.start_date) - dayNumber(other.end_date);
  const after = dayNumber(other.start_date) - dayNumber(r.end_date);
  const gap = before > 0 ? `${before} day${before === 1 ? '' : 's'} before`
    : after > 0 ? `${after} day${after === 1 ? '' : 's'} after` : 'overlaps';
  return `${dates} (${[gap, other.kind === 'emergency' && 'emergency', other.status === 'pending' && 'waiting for a decision'].filter(Boolean).join(', ')})`;
}

// The VA's other approved or waiting requests near this one, earliest first.
export async function nearbyTimeOff(env, r) {
  const { results } = await env.DB.prepare(
    `SELECT id, start_date, end_date, kind, status FROM time_off_requests
     WHERE user_id = ? AND id != ? AND status IN ('pending', 'approved') AND end_date >= ? AND start_date <= ?
     ORDER BY start_date`
  ).bind(r.user_id, r.id || 0, addDays(r.start_date, -NEARBY_DAYS), addDays(r.end_date, NEARBY_DAYS)).all();
  return results;
}
