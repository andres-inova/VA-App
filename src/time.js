// Time zone and schedule helpers.

// Zoho stores a short label. These full names also handle daylight saving time.
export const ZONES = {
  PST: 'America/Los_Angeles',
  MST: 'America/Denver',
  CST: 'America/Chicago',
  EST: 'America/New_York',
};

// Reports are scheduled on Eastern time.
export const REPORT_ZONE = 'America/New_York';

export function zoneFor(label) {
  return ZONES[label] || null;
}

// The date, hour, minute and weekday of a moment, as seen in a time zone.
export function partsIn(zone, date = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: p.weekday,
    day: Number(p.day),
  };
}

function offsetMinutes(zone, date) {
  const p = partsIn(zone, date);
  const [y, m, d] = p.date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, p.hour, p.minute);
  const actual = Math.floor(date.getTime() / 60000) * 60000;
  return (asUtc - actual) / 60000;
}

// Converts "this date at this hour in this time zone" to an exact moment.
export function zonedTimeToUtc(dateStr, hour, minute, zone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = offsetMinutes(zone, new Date(guess));
  let result = guess - first * 60000;
  const second = offsetMinutes(zone, new Date(result));
  if (second !== first) result = guess - second * 60000;
  return new Date(result);
}

// Reads the start time from a Zoho Availability value such as "8:30am - 4:30pm".
// Returns null for values without a start time, such as "Open availability".
export function parseStart(availability) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(availability || '');
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'pm') hour += 12;
  return { hour, minute: Number(m[2] || 0) };
}

// "09:30" -> { hour: 9, minute: 30 }
export function parseHHMM(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '');
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "Mon" -> 1
export function weekdayIndex(weekday) {
  return DAY_NAMES.indexOf(weekday);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
}

export function formatDate(dateStr, withYear = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function formatHM({ hour, minute }) {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function formatTimeIn(iso, zone) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
}

// ---- Time logging: each project's own day ----

// The time zone label (PST, MST, CST or EST) of each project, in one query: the project's saved zone, else the
// client record's "Timezone", else the first VA's, else EST (the same order as the project settings page).
export async function projectZones(env, ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  const zones = new Map();
  for (let i = 0; i < list.length; i += 90) {  // D1 takes at most 100 values per query
    const part = list.slice(i, i + 90);
    const { results } = await env.DB.prepare(
    `SELECT p.id, ps.time_zone AS saved, CASE WHEN json_valid(r.data) THEN json_extract(r.data, '$.Timezone') END AS client_zone,
       (SELECT u.time_zone FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.project_id = p.id AND u.is_va = 1 ORDER BY a.id LIMIT 1) AS va_zone
     FROM projects p LEFT JOIN project_settings ps ON ps.project_id = p.id LEFT JOIN records r ON r.id = p.client_record_id AND r.module = 'clients'
     WHERE p.id IN (${part.map(() => '?').join(',')})`
    ).bind(...part).all();
    for (const r of results) zones.set(String(r.id), [r.saved, r.client_zone, r.va_zone].find((z) => ZONES[z]) || 'EST');
  }
  return zones;
}

// A timer stops by itself after 8 hours, and never runs past 11:59 PM of the day it started in the project's
// time zone. Returns when it must stop and why (1 = 8 hours, 2 = midnight).
export const TIMER_MAX_HOURS = 8;
export function timerLimit(startedAt, zoneLabel) {
  const start = new Date(startedAt);
  const eight = new Date(start.getTime() + TIMER_MAX_HOURS * 3600000);
  const day = partsIn(ZONES[zoneLabel] || ZONES.EST, start).date;
  const midnight = zonedTimeToUtc(day, 23, 59, ZONES[zoneLabel] || ZONES.EST);
  if (midnight < start) return { at: start, reason: 2 };
  return midnight < eight ? { at: midnight, reason: 2 } : { at: eight, reason: 1 };
}
