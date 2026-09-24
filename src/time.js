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
