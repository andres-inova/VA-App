// The pages of client-time.js: the client's Time page and one log. Plain HTML, desktop and phone width; the bars
// are drawn on the server with their numbers as text next to them (the same bars as My hours).

import { esc } from './util.js';
import { layout, icon, avatar, empty, chip } from './views.js';
import { formatDate, formatTimeIn, partsIn, ZONES } from './time.js';
import { duration } from './timelog-views.js';
import { shareRow, columns, span } from './timehours-views.js';
import { usageBlock } from './timeadmin-views.js';

const hm = (minutes) => duration(minutes);
export const projectName = (p) => `${p.name || p.client || 'Project'}${p.is_coverage && !/coverage/i.test(p.name || '') ? ' (coverage)' : ''}${p.active ? '' : ' (closed)'}`;

const LABELS = { cycle: 'This billing cycle', lastcycle: 'Last billing cycle', month: 'This month', prevmonth: 'Last month', custom: 'Choose dates' };

function linker(s, query) {
  return (changes = {}) => {
    const p = new URLSearchParams();
    const next = { range: s.kind, project: s.project?.id || '', from: query.get('from') || '', to: query.get('to') || '', ...changes };
    for (const [k, v] of Object.entries(next)) if (v !== '' && v !== null && v !== undefined) p.set(k, String(v));
    if (next.range !== 'custom') { p.delete('from'); p.delete('to'); }
    const qs = p.toString();
    return qs ? `/client/time?${qs}` : '/client/time';
  };
}

export function timePage({ user, message, s, cards, total, count, projectRows, vaRows, typeRows, chart, logs, more, show, query }) {
  const link = linker(s, query);
  const opt = (value, label, on) => `<option value="${esc(value)}" ${on ? 'selected' : ''}>${esc(label)}</option>`;
  const filter = s.projects.length > 1 ? `<form method="get" action="/client/time" class="card"><input type="hidden" name="range" value="${esc(s.kind)}">
      ${s.kind === 'custom' ? `<input type="hidden" name="from" value="${esc(s.range.from)}"><input type="hidden" name="to" value="${esc(s.range.to)}">` : ''}
      <label for="ct-project" style="margin-top:0">Project</label>
      <select id="ct-project" name="project" onchange="this.form.submit()">${opt('', 'All projects', !s.project)}${s.projects.map((p) => opt(p.id, projectName(p), s.project?.id === p.id)).join('')}</select></form>` : '';
  const buttons = `<nav class="pj-grid hr-ranges ta-ranges" aria-label="Time range">${Object.entries(LABELS).map(([k, label]) =>
    `<a class="pj-btn ${k === s.kind ? 'on' : ''}" href="${esc(link({ range: k, show: '' }))}" ${k === s.kind ? 'aria-current="page"' : ''}><b>${esc(label)}</b></a>`).join('')}</nav>`;
  const custom = s.kind === 'custom' ? `<form method="get" action="/client/time" class="card"><input type="hidden" name="range" value="custom">${s.project ? `<input type="hidden" name="project" value="${esc(s.project.id)}">` : ''}
      <div class="hm hr-dates"><div><label for="ct-from" style="margin-top:0">From</label><input type="date" id="ct-from" name="from" value="${esc(s.range.from)}" required></div>
        <div><label for="ct-to" style="margin-top:0">To</label><input type="date" id="ct-to" name="to" value="${esc(s.range.to)}" required></div></div>
      <button>${icon('check')} Show these dates</button>
      ${s.range.note ? `<p class="small">${esc(s.range.note)}</p>` : '<p class="small">Up to one year.</p>'}</form>` : '';

  const rangeText = (s.kind === 'cycle' || s.kind === 'lastcycle') && s.range.perProject
    ? `${LABELS[s.kind]}: each project’s own cycle, ${span(s.range.from, s.range.to)} in all`
    : `${LABELS[s.kind]}: ${span(s.range.from, s.range.to)}`;
  const totalCard = `<div class="card hr-total"><p class="meta" style="margin:0">${esc(rangeText)}</p>
      <div class="hr-big">${esc(hm(total))}</div>
      <p class="meta" style="margin:0">${count ? `${count} time log${count === 1 ? '' : 's'}` : 'No time logged in this range.'}${s.project ? ` · ${esc(projectName(s.project))}` : ''}</p></div>`;
  const breakdown = (title, rows) => (rows.length > 1 ? `<div class="card"><h2>${esc(title)}</h2>${rows.map((r) => shareRow(r.name, r.minutes, total)).join('')}</div>` : '');

  const packageCards = cards.length ? `<div class="card"><h2>Hours used this billing cycle</h2>
      ${cards.map((c) => `<div style="margin:10px 0">${usageBlock(c.usage, { label: projectName(c.project) })}</div>`).join('')}
      <p class="small" style="margin:0">Time on coverage projects counts toward the project that has the package.</p></div>` : '';

  const here = link({ show: show > 100 ? show : '' });
  const days = [...new Set(logs.map((l) => l.work_date))];
  const rows = logs.length ? days.map((d) => {
    const dayLogs = logs.filter((l) => l.work_date === d);
    return `<h3 class="hs-day"><span>${esc(formatDate(d, true))}</span><span>${esc(hm(dayLogs.reduce((t, l) => t + l.minutes, 0)))}${more && d === days[days.length - 1] ? '+' : ''}</span></h3>
      ${dayLogs.map((l) => `<div class="item flat hs-row"><div class="item-head">${avatar(l.va || '?')}<div class="grow">
        <a class="title" href="/client/time/log/${l.id}?back=${esc(encodeURIComponent(here))}">${esc(l.va || 'A VA')} · ${esc(l.type_name || 'General')}</a>
        <div class="sub">${esc(l.project ? projectName(l.project) : 'Project')}</div></div>
        <span class="chip info tl-mins">${esc(hm(l.minutes))}</span></div></div>`).join('')}`;
  }).join('') : empty('No time logged in this range.');
  const listCard = `<div class="card" id="logs"><h2>Time logs</h2>
      <p class="small" style="margin:0 0 6px">Newest first. Open a log to read its description.</p>
      ${rows}${more ? `<a class="btn big-btn plain" href="${esc(link({ show: String(show + 100) }))}#logs">Show more</a>` : ''}</div>`;

  return layout({
    title: 'Time', user, active: '/client/time', message,
    body: `${packageCards}${filter}${buttons}${custom}${totalCard}
      <div class="ta-grid">${breakdown('By project', projectRows)}${breakdown('By VA', vaRows)}${breakdown('By task type', typeRows)}</div>
      ${chart && total ? columns(chart) : ''}${listCard}
      <p class="small">Days are counted in each project’s time zone.</p>`,
  });
}

export function logPage({ user, message, log, zone, backTo }) {
  const z = ZONES[zone] || ZONES.EST;
  const project = { name: log.project_name, is_coverage: log.is_coverage, active: log.active };
  const entered = log.source === 'zoho' ? '' : `Entered ${formatTimeIn(log.entered_at, z)} ${zone}${partsIn(z, new Date(log.entered_at)).date === log.work_date ? '' : `, ${formatDate(partsIn(z, new Date(log.entered_at)).date)}`}`;
  return layout({
    title: 'Time log', user, active: '/client/time', message,
    body: `<div class="card">
      <div style="display:flex;gap:12px;align-items:center">${avatar(log.va || '?')}<div class="grow">
        <p class="meta" style="margin:0"><b>${esc(log.va || 'A VA')}</b> · ${esc(projectName(project))} · ${esc(formatDate(log.work_date, true))}</p>
        <h2 style="margin:0">${esc(log.type_name || 'General')} · ${esc(hm(log.minutes))}</h2></div></div>
      ${entered ? `<p class="stamp">${icon('lock')} ${esc(entered)}</p>` : ''}
      ${log.description ? `<label>Description</label><div class="bubble">${esc(log.description)}</div>` : '<p class="small">No description was written for this log.</p>'}
      <p style="margin:12px 0 0"><a href="${esc(backTo)}">&larr; Back</a></p></div>`,
  });
}
