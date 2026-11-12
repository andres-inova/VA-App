// The client's "Time off" page (client portal, piece C3): credits and training hours on the upcoming invoice, the next
// time off of the VAs on the client's projects (approved requests only, no reasons), and InoVA Local holidays.
//
// - Time off: approved requests of VAs assigned to the client's active, non-coverage projects, from today through the
//   next 60 days. A request limited to other projects (project_ids) is left out. Who covers is shown when chosen.
// - Credits: the training and credit hours an admin saved on a project (project_billing). They count only for the
//   billing cycle they were set in, so they disappear when the cycle rolls over. The upcoming invoice is the one for
//   the project's current billing cycle.
// - Holidays: every InoVA Local holiday from today through the next 12 months.

import { layout, section, empty, chip, avatar, icon } from './views.js';
import { esc, page, redirect } from './util.js';
import { ZONES, partsIn, addDays, formatDate, projectZones } from './time.js';
import { billingCycle } from './projects.js';
import { billingDayOf, daysBetween } from './timehours.js';
import { duration } from './timelog-views.js';
import { span } from './timehours-views.js';

const DAYS_AHEAD = 60;
const hours = (h) => duration(Math.round(h * 60));
const range = (a, b) => (a === b ? formatDate(a, true) : `${formatDate(a)} – ${formatDate(b, true)}`);

// Credits for each of the client's active projects: [{ name, cycle, training, credit, note }] (only those with hours).
async function credits(env, client) {
  const { results: rows } = await env.DB.prepare(
    `SELECT p.id, p.name, ps.billing_day, b.training_hours, b.credit_hours, b.credit_note, b.adjust_set_on,
       CASE WHEN json_valid(r.data) THEN json_extract(r.data, '$.Invoice_Date') END AS invoice_date
     FROM projects p JOIN project_billing b ON b.project_id = p.id LEFT JOIN project_settings ps ON ps.project_id = p.id
     LEFT JOIN records r ON r.id = p.client_record_id AND r.module = 'clients'
     WHERE p.client_record_id = ? AND p.active = 1 AND p.is_coverage = 0 AND (b.training_hours > 0 OR b.credit_hours > 0) ORDER BY p.name COLLATE NOCASE`
  ).bind(client.id).all();
  if (!rows.length) return [];
  const zones = await projectZones(env, rows.map((p) => p.id));
  const out = [];
  for (const p of rows) {
    const today = partsIn(ZONES[zones.get(String(p.id)) || 'EST']).date;
    const cycle = billingCycle(today, billingDayOf(p));
    if (!p.adjust_set_on || p.adjust_set_on < cycle.start || p.adjust_set_on > cycle.end) continue;
    out.push({ name: p.name, cycle, training: p.training_hours, credit: p.credit_hours, note: p.credit_note });
  }
  return out;
}

// Approved time off coming up for the VAs on the client's projects.
async function timeOff(env, client, today) {
  const end = addDays(today, DAYS_AHEAD);
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.start_date, t.end_date, t.project_ids, u.name AS va, p.id AS project_id, p.name AS project_name
     FROM time_off_requests t JOIN users u ON u.id = t.user_id JOIN assignments a ON a.user_id = t.user_id
     JOIN projects p ON p.id = a.project_id AND p.client_record_id = ?1 AND p.active = 1 AND p.is_coverage = 0
     WHERE t.status = 'approved' AND u.is_va = 1 AND t.end_date >= ?2 AND t.start_date <= ?3 ORDER BY t.start_date, u.name`
  ).bind(client.id, today, end).all();
  // A request for only some projects counts only when one of them is this client's project.
  const rows = results.filter((r) => {
    const only = (r.project_ids || '').split(',').map((x) => x.trim()).filter(Boolean);
    return !only.length || only.includes(String(r.project_id));
  });
  const ids = [...new Set(rows.map((r) => r.id))];
  const cover = new Map();
  if (ids.length) {
    const { results: cps } = await env.DB.prepare(
      `SELECT request_id, project_id, backup_name FROM coverage_projects WHERE request_id IN (${ids.map(() => '?').join(',')}) AND backup_name IS NOT NULL AND backup_name != ''`
    ).bind(...ids).all();
    for (const c of cps) cover.set(`${c.request_id}|${c.project_id}`, c.backup_name);
  }
  const seen = new Set();
  return rows.map((r) => ({ ...r, cover: cover.get(`${r.id}|${r.project_id}`) || cover.get(`${r.id}|`) || '' }))
    .filter((r) => { const k = `${r.id}|${r.project_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function clientCalendarRoutes(env, user, client, path, message) {
  if (path !== '/client/calendar') return redirect('/client/calendar');
  const today = partsIn(ZONES.EST).date;
  const [cr, off, { results: holidays }] = await Promise.all([
    credits(env, client),
    timeOff(env, client, today),
    env.DB.prepare('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date').bind(today, addDays(today, 365)).all(),
  ]);

  const creditCard = cr.length ? `<div class="card"><h2>Credits on your upcoming invoice</h2>
      ${cr.map((c) => `<div class="item flat"><div class="item-head"><div class="grow"><div class="title">${esc(c.name)}</div>
        <div class="sub">Invoice for ${esc(span(c.cycle.start, c.cycle.end))}</div>
        ${c.note ? `<div class="sub">${esc(c.note)}</div>` : ''}</div>
        <div class="chips">${c.training ? chip(`Training credit ${hours(c.training)}`, 'info') : ''}${c.credit ? chip(`Credit ${hours(c.credit)}`, 'good') : ''}</div></div></div>`).join('')}
      <p class="small" style="margin:6px 0 0">These hours are taken off the hours billed on that invoice.</p></div>`
    : `<div class="card"><h2>Credits on your upcoming invoice</h2><p class="meta" style="margin:0">No training credits or credits for the current billing cycle.</p></div>`;

  const offRows = off.length ? off.map((r) => {
    const days = daysBetween(r.start_date, r.end_date) + 1;
    const now = r.start_date <= today;
    return `<div class="item flat"><div class="item-head">${avatar(r.va)}<div class="grow"><div class="title">${esc(r.va)}</div>
      <div class="sub">${esc(range(r.start_date, r.end_date))} · ${days} day${days === 1 ? '' : 's'} · ${esc(r.project_name)}</div>
      <div class="sub">${r.cover ? `Covered by ${esc(r.cover)}` : 'Coverage not chosen yet'}</div></div>${now ? chip('Off now', 'warn') : ''}</div></div>`;
  }).join('') : empty(`No time off in the next ${DAYS_AHEAD} days.`);

  const holidayRows = holidays.length ? holidays.map((h) => `<div class="item flat"><div class="item-head">${`<span class="chip muted">${icon('calendar')}</span>`}
      <div class="grow"><div class="title">${esc(h.name)}</div><div class="sub">${esc(formatDate(h.date, true))}</div></div></div></div>`).join('')
    : empty('No holidays are listed yet.');

  return page(layout({
    title: 'Time off', user, active: '/client/calendar', message,
    body: `${creditCard}
      ${section({ title: 'Your VAs’ time off', count: off.length, open: true, hint: `Approved time off in the next ${DAYS_AHEAD} days.`, body: offRows })}
      ${section({ title: 'InoVA Local holidays', count: holidays.length, open: true, hint: 'Days InoVA Local is closed, for the next 12 months.', body: holidayRows })}`,
  }));
}
