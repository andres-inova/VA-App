// The client's "Projected bill" page (client portal, piece C4): what the current billing cycle will cost, by project.
// It follows the Billing Dashboard's rules:
//   hours so far = time logged in the cycle, up to today
//   billable hours so far = hours so far - training hours - credit hours (never below 0)
//   projected hours = billable hours so far / weekdays (Mon-Fri) elapsed * weekdays in the whole cycle
//   projected bill = projected hours * hourly rate
// Projects billed together (billing_pairs) are one line: hours and training/credit hours are added up and the higher of
// the two hourly rates is used. A project with no hourly rate shows its hours but no amount.
// Training and credit hours count only in the billing cycle they were set in (project_billing.adjust_set_on).

import { layout, empty, chip } from './views.js';
import { esc, page } from './util.js';
import { ZONES, partsIn, addDays, projectZones } from './time.js';
import { billingCycle } from './projects.js';
import { billingDayOf } from './timehours.js';
import { duration } from './timelog-views.js';
import { span } from './timehours-views.js';

const hm = (h) => duration(Math.round(h * 60));
const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Monday to Friday days from one date to another, both included (the Billing Dashboard's "business days").
export function weekdaysBetween(from, to) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

// One bill line from its numbers (pure, so it can be tested on its own).
export function billLine({ rawHours, trainingHours, creditHours, rate, cycle, today }) {
  const billable = Math.max(0, rawHours - trainingHours - creditHours);
  const until = today < cycle.end ? today : cycle.end;
  const elapsed = Math.max(1, weekdaysBetween(cycle.start, until));
  const total = Math.max(1, weekdaysBetween(cycle.start, cycle.end));
  const projectedHours = (billable / elapsed) * total;
  return {
    billable, projectedHours, elapsed, total,
    soFar: rate ? Math.round(billable * rate * 100) / 100 : null,
    projected: rate ? Math.round(projectedHours * rate * 100) / 100 : null,
  };
}

async function lines(env, client) {
  const { results: rows } = await env.DB.prepare(
    `SELECT p.id, p.name, p.active, p.is_coverage, ps.billing_day, b.hourly_rate, b.training_hours, b.credit_hours, b.credit_note, b.adjust_set_on,
       CASE WHEN json_valid(r.data) THEN json_extract(r.data, '$.Invoice_Date') END AS invoice_date
     FROM projects p LEFT JOIN project_settings ps ON ps.project_id = p.id LEFT JOIN project_billing b ON b.project_id = p.id
     LEFT JOIN records r ON r.id = p.client_record_id AND r.module = 'clients'
     WHERE p.client_record_id = ? ORDER BY p.is_coverage, p.name COLLATE NOCASE`
  ).bind(client.id).all();
  const projects = rows.map((p) => ({ ...p, id: String(p.id) }));
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const marks = ids.map(() => '?').join(',');
  const { results: pairs } = await env.DB.prepare(`SELECT project_id_a AS a, project_id_b AS b FROM billing_pairs WHERE project_id_a IN (${marks}) AND project_id_b IN (${marks})`).bind(...ids, ...ids).all();
  const zones = await projectZones(env, ids);
  const byId = new Map(projects.map((p) => [p.id, p]));

  // Groups: a pair is one group, every other project its own. A project in two pairs stays with its first pair.
  const used = new Set(), groups = [];
  for (const pr of pairs) {
    const a = byId.get(String(pr.a)), b = byId.get(String(pr.b));
    if (!a || !b || used.has(a.id) || used.has(b.id)) continue;
    used.add(a.id); used.add(b.id);
    groups.push([a, b]);
  }
  for (const p of projects) if (!used.has(p.id)) groups.push([p]);

  const out = [];
  for (const g of groups) {
    // The cycle (and "today") of the main project: an active one that is not coverage, else the first.
    const anchor = g.find((p) => p.active && !p.is_coverage) || g.find((p) => !p.is_coverage) || g[0];
    const zone = zones.get(anchor.id) || 'EST';
    const today = partsIn(ZONES[zone]).date;
    const cycle = billingCycle(today, billingDayOf(anchor));
    const gIds = g.map((p) => p.id);
    const { total } = await env.DB.prepare(
      `SELECT COALESCE(SUM(minutes), 0) AS total FROM time_logs WHERE deleted_at IS NULL AND work_date BETWEEN ? AND ? AND project_id IN (${gIds.map(() => '?').join(',')})`
    ).bind(cycle.start, today < cycle.end ? today : cycle.end, ...gIds).first();
    // Not shown: closed projects (and pairs of closed projects) with no time in this cycle.
    if (!g.some((p) => p.active) && !total) continue;
    // Not shown either: a project with no hourly rate and no time in this cycle (nothing to say about it).
    if (!g.some((p) => p.hourly_rate > 0) && !total) continue;
    const effective = g.filter((p) => p.adjust_set_on && p.adjust_set_on >= cycle.start && p.adjust_set_on <= cycle.end);
    const rates = g.map((p) => p.hourly_rate).filter((r) => r > 0);
    const rate = rates.length ? Math.max(...rates) : null;
    const calc = billLine({
      rawHours: total / 60, trainingHours: effective.reduce((t, p) => t + (p.training_hours || 0), 0),
      creditHours: effective.reduce((t, p) => t + (p.credit_hours || 0), 0), rate, cycle, today,
    });
    out.push({
      name: g.length > 1 ? client.name : anchor.name, projects: g.map((p) => p.name), together: g.length > 1, cycle, today, rate,
      rawHours: total / 60, trainingHours: effective.reduce((t, p) => t + (p.training_hours || 0), 0),
      creditHours: effective.reduce((t, p) => t + (p.credit_hours || 0), 0), ...calc,
    });
  }
  return out;
}

export async function clientBillRoutes(env, user, client, message) {
  const list = await lines(env, client);
  const priced = list.filter((l) => l.projected !== null);
  const total = priced.reduce((t, l) => t + l.projected, 0);
  const unpriced = list.length - priced.length;

  const totalCard = `<div class="card hr-total"><p class="meta" style="margin:0">Projected bill for the current billing cycle</p>
      <div class="hr-big">${list.length ? money(total) : '$0.00'}</div>
      <p class="meta" style="margin:0">${priced.length ? `${priced.length} project${priced.length === 1 ? '' : 's'} with a rate` : 'No projects with an hourly rate yet.'}${unpriced ? ` · ${unpriced} without a rate yet (hours shown, amount to be confirmed)` : ''}</p></div>`;

  const card = (l) => `<div class="card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h2 style="margin:0" class="grow">${esc(l.name)}</h2>${l.together ? chip('Billed together', 'info') : ''}</div>
      <p class="meta" style="margin:2px 0 8px">${esc(span(l.cycle.start, l.cycle.end))}${l.together ? ` · ${esc(l.projects.join(' + '))}` : ''}</p>
      <div class="hb-text"><span class="hb-name">Projected bill</span><span class="hb-val">${l.projected === null ? 'Rate not set yet' : money(l.projected)}</span></div>
      <ul class="plainlist" style="margin:8px 0">
        <li>Time logged so far: <b>${esc(hm(l.rawHours))}</b></li>
        ${l.trainingHours ? `<li>Training credit: <b>− ${esc(hm(l.trainingHours))}</b></li>` : ''}
        ${l.creditHours ? `<li>Credit: <b>− ${esc(hm(l.creditHours))}</b></li>` : ''}
        <li>Billable so far: <b>${esc(hm(l.billable))}</b>${l.soFar !== null ? ` (${esc(money(l.soFar))})` : ''}</li>
        <li>Projected by the end of the cycle: <b>${esc(hm(l.projectedHours))}</b></li>
        ${l.rate ? `<li>Hourly rate: <b>${esc(money(l.rate))}</b></li>` : ''}
      </ul></div>`;

  return page(layout({
    title: 'Projected bill', user, active: '/client/bill', message,
    body: `${totalCard}${list.length ? list.map(card).join('') : `<div class="card">${empty('No projects to bill yet.')}</div>`}
      <p class="small">How this is worked out: the time your VAs logged so far this billing cycle, minus any training credit or credit, spread over the weekdays (Monday to Friday) left in the cycle, times the hourly rate. It is an estimate: it changes as more time is logged, and your invoice is the final amount.</p>`,
  }));
}
