// The "My hours" page of timehours.js: range buttons, project picker, totals, charts (plain HTML bars drawn on the
// server, with the numbers as text next to them), the VA's package for one project, and the history list.
// Phone first: big buttons, short words.

import { esc } from './util.js';
import { layout, icon, empty } from './views.js';
import { formatDate } from './time.js';
import { duration, stamp } from './timelog-views.js';

export const hm = (minutes) => duration(minutes);  // "12h 30m" (a function: the two view files import each other)
export const projectName = (p) => `${p.client || p.name || 'Project'}${p.is_coverage ? ' (coverage)' : ''}${p.active ? '' : ' (closed)'}`;

// The Time / My hours buttons at the top of both pages.
export const timeTabs = (on) => `<nav class="chips proj-tabs" aria-label="Time pages">${[['/va/time', 'Log time'], ['/va/time/hours', 'My hours']].map(([href, label]) =>
  `<a class="chip ${href === on ? 'on' : 'muted'}" href="${href}" ${href === on ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;

export const RANGE_LABELS = {
  today: 'Today', pay: 'This pay period', prevpay: 'Last pay period', cycle: 'This billing cycle',
  week: 'This week', month: 'This month', custom: 'Choose dates',
};
export const shortDate = (d) => formatDate(d).replace(/^\w+, /, '');  // "Oct 23"
export const span = (from, to) => (from === to ? formatDate(from, true) : `${shortDate(from)}${from.slice(0, 4) === to.slice(0, 4) ? '' : `, ${from.slice(0, 4)}`} – ${shortDate(to)}, ${to.slice(0, 4)}`);
export const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

// A horizontal bar with its label, time and share as text (the bar only repeats what the text says).
export const shareRow = (name, minutes, total, sub = '') => `<div class="hb-row">
    <div class="hb-text"><span class="hb-name">${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="hb-val">${esc(hm(minutes))} · ${minutes && !percent(minutes, total) ? '&lt;1' : percent(minutes, total)}%</span></div>
    <div class="hb-track" aria-hidden="true"><div class="hb-fill" style="width:${Math.max(minutes ? 1 : 0, percent(minutes, total))}%"></div></div></div>`;

// Columns for each day (or week, or month), with a list of the same numbers under it.
export function columns(chart) {
  const max = Math.max(...chart.list.map((b) => b.minutes), 0);
  const label = (b) => (chart.size === 'month' ? new Date(`${b.key}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' })
    : chart.size === 'week' ? `Week of ${shortDate(b.key)}` : formatDate(b.key));
  const tick = (b, i) => (chart.size === 'month' ? new Date(`${b.key}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' })
    : chart.size === 'week' ? shortDate(b.key) : String(Number(b.key.slice(8))));
  const every = chart.list.length <= 8 ? 1 : chart.list.length <= 16 ? 2 : 7;
  const title = chart.size === 'day' ? 'Hours per day' : chart.size === 'week' ? 'Hours per week' : 'Hours per month';
  const bars = chart.list.map((b, i) => `<div class="hc-col" title="${esc(`${label(b)}: ${hm(b.minutes)}`)}">
      <div class="hc-bar" style="height:${max ? Math.max(b.minutes ? 2 : 0, Math.round((b.minutes / max) * 100)) : 0}%"></div>
      <span class="hc-tick">${i % every === 0 ? esc(tick(b, i)) : ''}</span></div>`).join('');
  const list = chart.list.filter((b) => b.minutes).map((b) => `<li><span>${esc(label(b))}</span><b>${esc(hm(b.minutes))}</b></li>`).join('');
  return `<div class="card"><h2>${esc(title)}</h2>
    <p class="meta" style="margin:0 0 6px">Highest: <b>${esc(hm(max))}</b></p>
    <div class="hc" role="img" aria-label="${esc(`${title}, as a chart. The same numbers are in the list below.`)}">${bars}</div>
    <details class="hc-list"><summary>Show as a list</summary>${list ? `<ul>${list}</ul>` : empty('No time in this range.')}</details></div>`;
}

// One log in the history list (read-only here; the title opens it).
function historyRow(l) {
  const zone = l.project?.zone || 'EST';
  return `<div class="item flat hs-row"><div class="item-head"><div class="grow">
      <a class="title" href="/va/time/entry/${l.id}?from=hours">${esc(l.type_name || 'General')}</a>
      <div class="sub">${esc(l.project ? projectName(l.project) : `Project ${l.project_id}`)}</div>
      ${l.description ? `<div class="sub log-desc">${esc(l.description)}</div>` : ''}
      ${l.fileList.length ? `<div class="hs-files">${l.fileList.map((f) => `<a href="/time-files/${f.id}" target="_blank" rel="noopener">${icon('doc')} ${esc(f.name)}</a>`).join('')}</div>` : ''}
      <div class="stamp">${icon('lock')} ${esc(stamp(l, zone))}</div></div>
      <span class="chip info tl-mins">${esc(hm(l.minutes))}</span></div></div>`;
}

export function hoursPage({ user, message, projects, project, kind, range, today, myZone, windows, total, count, projectRows, typeRows, chart, logs, more, show, pkg, query }) {
  const link = (changes) => {
    const p = new URLSearchParams();
    const next = { range: kind, project: project?.id || '', from: query.get('from') || '', to: query.get('to') || '', ...changes };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    if (next.range !== 'custom') { p.delete('from'); p.delete('to'); }
    return `/va/time/hours?${p}`;
  };

  // The project picker and the range buttons.
  const picker = `<form method="get" action="/va/time/hours" class="card hr-pick">
      <input type="hidden" name="range" value="${esc(kind)}">
      ${kind === 'custom' ? `<input type="hidden" name="from" value="${esc(range.from || '')}"><input type="hidden" name="to" value="${esc(range.to || '')}">` : ''}
      <label for="hr-project" style="margin-top:0">Project</label>
      <div class="hr-row"><select id="hr-project" name="project" onchange="this.form.submit()">
        <option value="">All projects</option>
        ${projects.map((p) => `<option value="${esc(p.id)}" ${p.id === project?.id ? 'selected' : ''}>${esc(projectName(p))}</option>`).join('')}
      </select><button class="plain">Show</button></div></form>`;
  const buttons = `<nav class="pj-grid hr-ranges" aria-label="Time range">${Object.entries(RANGE_LABELS).map(([k, label]) =>
    `<a class="pj-btn ${k === kind ? 'on' : ''}" href="${esc(link({ range: k }))}" ${k === kind ? 'aria-current="page"' : ''}><b>${esc(label)}</b></a>`).join('')}</nav>`;
  const custom = kind === 'custom' ? `<form method="get" action="/va/time/hours" class="card">
      <input type="hidden" name="range" value="custom">${project ? `<input type="hidden" name="project" value="${esc(project.id)}">` : ''}
      <div class="hm hr-dates"><div><label for="hr-from" style="margin-top:0">From</label><input type="date" id="hr-from" name="from" value="${esc(range.from || '')}" required></div>
        <div><label for="hr-to" style="margin-top:0">To</label><input type="date" id="hr-to" name="to" value="${esc(range.to || '')}" required></div></div>
      <button class="big-btn">${icon('check')} Show these dates</button>
      ${range.note ? `<p class="small">${esc(range.note)}</p>` : '<p class="small">Up to one year.</p>'}</form>` : '';

  // What the range is.
  let what;
  if (range.none) what = `<p class="meta" style="margin:0">${esc(range.none)}</p>`;
  else if (kind === 'cycle' && !project) what = `<p class="meta" style="margin:0"><b>Each project has its own billing cycle</b> (it starts on the project’s billing day), so each project below counts its own current cycle.</p>`;
  else if (kind === 'cycle') what = `<p class="meta" style="margin:0">Billing cycle: <b>${esc(span(range.from, range.to))}</b></p>`;
  else what = `<p class="meta" style="margin:0">${esc(RANGE_LABELS[kind])}: <b>${esc(span(range.from, range.to))}</b>${range.payDay ? ` · <b>Paid ${esc(shortDate(range.payDay))}</b>` : ''}</p>`;

  const csvHref = link({}).replace('/va/time/hours?', '/va/time/hours.csv?');
  const totalCard = `<div class="card hr-total">${what}
      <div class="hr-big">${esc(hm(total))}</div>
      <p class="meta" style="margin:0">${count ? `${count} time log${count === 1 ? '' : 's'}` : 'No time logged in this range.'}${project ? ` · ${esc(projectName(project))}` : ' · All projects'}</p>
      ${count ? `<a class="btn plain" href="${esc(csvHref)}" download>${icon('download')} Download my hours (CSV)</a>` : ''}</div>`;

  const pkgCard = pkg ? `<div class="card"><h2>Package</h2>
      <p class="meta" style="margin:0">This billing cycle: <b>${esc(hm(pkg.minutes))} of ${esc(hm(Math.round(pkg.hours * 60)))}</b></p>
      <div class="hb-track" aria-hidden="true" style="margin-top:8px"><div class="hb-fill" style="width:${Math.min(100, percent(pkg.minutes, pkg.hours * 60))}%"></div></div>
      <p class="small" style="margin:6px 0 0">${esc(span(pkg.cycle.start, pkg.cycle.end))} · your own time on this project</p></div>` : '';

  const byProject = projectRows.length && (!project || projectRows.length > 1) ? `<div class="card"><h2>By project</h2>
      ${projectRows.map((r) => shareRow(r.name, r.minutes, total, r.cycle ? `Cycle ${span(r.cycle.start, r.cycle.end)}` : '')).join('')}</div>` : '';
  const byType = typeRows.length ? `<div class="card"><h2>By task type</h2>${typeRows.map((r) => shareRow(r.name, r.minutes, total)).join('')}</div>` : '';
  const chartCard = chart && total ? columns(chart) : '';

  // History, grouped by day (newest first).
  const days = [...new Set(logs.map((l) => l.work_date))];
  const history = logs.length ? days.map((d) => {
    const dayLogs = logs.filter((l) => l.work_date === d);
    return `<h3 class="hs-day"><span>${esc(formatDate(d, true))}</span><span>${esc(hm(dayLogs.reduce((s, l) => s + l.minutes, 0)))}${more && d === days[days.length - 1] ? '+' : ''}</span></h3>${dayLogs.map(historyRow).join('')}`;
  }).join('') : empty('No time logged in this range.');
  const historyCard = `<div class="card" id="history"><h2>History</h2>
      <p class="small" style="margin:0 0 6px">Every time log in this range, newest first. Tap one to see it. Time can be changed only on the Log time page, on the day it is for.</p>
      ${history}
      ${more ? `<a class="btn big-btn plain" href="${esc(link({ show: String(show + 100) }))}#history">Show more</a>` : ''}</div>`;

  return layout({
    title: 'My hours', user, active: '/va/time', message,
    body: `${timeTabs('/va/time/hours')}${picker}${buttons}${custom}${totalCard}${pkgCard}${byProject}${byType}${chartCard}${historyCard}
      <p class="small">Days are counted in each project’s time zone${project ? ` (${esc(project.zone)})` : ` (“today” is ${esc(formatDate(today))} in your time zone, ${esc(myZone)})`}. Closed projects and projects you no longer work on are included.</p>`,
  });
}
