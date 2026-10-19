// The pages of timeadmin.js: the admin Time page (filters, range buttons, totals, bars, log list), one log
// (read-only, with its changes), Packages, Exceptions and Missed time. Desktop first, but every part stacks at phone
// width. The bars are plain HTML drawn on the server with their numbers as text next to them (as on My hours).

import { esc } from './util.js';
import { layout, icon, avatar, chip, section, empty, zohoTime } from './views.js';
import { formatDate, formatTimeIn, partsIn, ZONES } from './time.js';
import { duration, stamp, zohoBox } from './timelog-views.js';
import { RANGE_LABELS, shortDate, span, shareRow, columns } from './timehours-views.js';

export const hm = (minutes) => duration(minutes);
export const projectName = (p) => `${p.client || p.name || 'Project'}${p.is_coverage ? ' (coverage)' : ''}${p.active ? '' : ' (closed)'}`;
const fullName = (p) => `${p.name || p.client || 'Project'}${p.is_coverage && !/coverage/i.test(p.name || '') ? ' (coverage)' : ''}${p.active ? '' : ' (closed)'}`;

// The Time / Packages / Exceptions / Missed time buttons at the top of each admin time page.
const TABS = [['/admin/time', 'Time'], ['/admin/time/packages', 'Packages'], ['/admin/time/exceptions', 'Exceptions'], ['/admin/time/missed', 'Missed time']];
export const adminTimeTabs = (on) => `<nav class="chips proj-tabs" aria-label="Time pages">${TABS.map(([href, label]) =>
  `<a class="chip ${href === on ? 'on' : 'muted'}" href="${href}" ${href === on ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;

// A package bar: "12h 30m of 40h · 31%", coloured from 80% (warning) and over 100% (red, "Over by 3h 10m").
export function usageBlock(u, { label = '', compact = false } = {}) {
  if (!u) return '';
  const over = u.used - u.limit;
  const state = over > 0 ? `<b class="u-text bad-text">Over by ${esc(hm(over))}</b>` : u.tone === 'warn' ? `<b class="u-text warn-text">${esc(hm(u.limit - u.used))} left</b>` : `${esc(hm(u.limit - u.used))} left`;
  return `<div class="usage${u.tone ? ` usage-${u.tone}` : ''}">
    ${label ? `<div class="hb-text"><span class="hb-name">${esc(label)}<small>${esc(span(u.start, u.end))}</small></span><span class="hb-val">${u.pct}%</span></div>` : ''}
    <div class="hb-track" aria-hidden="true"><div class="hb-fill ${u.tone ? `u-${u.tone}` : ''}" style="width:${Math.min(100, Math.max(u.used ? 1 : 0, u.pct))}%"></div></div>
    <p class="small" style="margin:4px 0 0"><b>${esc(hm(u.used))}</b> of ${esc(hm(u.limit))} (${u.pct}%) · ${state}${u.coverage ? ` · incl. coverage ${esc(hm(u.coverage))}` : ''}${!compact && u.fromNote ? ` · package starts ${esc(formatDate(u.fromNote, true))}` : ''}</p></div>`;
}

// ---- The admin Time page ----

const FILTERS = ['va', 'project', 'client', 'type'];

// A link to the same page with some values changed (filters, range, dates, show).
function linker(base, s, query) {
  return (changes = {}) => {
    const p = new URLSearchParams();
    const next = {
      range: s.kind, va: s.va?.id || '', project: s.project?.id || '', client: s.client?.id || '', type: s.type?.id || '',
      from: query.get('from') || '', to: query.get('to') || '', ...changes,
    };
    for (const [k, v] of Object.entries(next)) if (v !== '' && v !== null && v !== undefined) p.set(k, String(v));
    if (next.range !== 'custom') { p.delete('from'); p.delete('to'); }
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };
}

// The filter selects, the range buttons and the "Choose dates" form.
function filterParts(s, link, base, { types = true, clients = true, cycle = true } = {}) {
  const opt = (value, label, on) => `<option value="${esc(value)}" ${on ? 'selected' : ''}>${esc(label)}</option>`;
  const hidden = `<input type="hidden" name="range" value="${esc(s.kind)}">${s.kind === 'custom' ? `<input type="hidden" name="from" value="${esc(s.range.from || '')}"><input type="hidden" name="to" value="${esc(s.range.to || '')}">` : ''}`;
  const vas = s.people;
  const form = `<form method="get" action="${base}" class="card ta-filters">${hidden}
    <div class="row">
      <div><label for="ta-va">VA</label><select id="ta-va" name="va" onchange="this.form.submit()">${opt('', 'All VAs', !s.va)}${vas.map((u) => opt(u.id, `${u.name}${u.is_va ? '' : ' (not a VA now)'}`, s.va?.id === u.id)).join('')}</select></div>
      <div><label for="ta-project">Project</label><select id="ta-project" name="project" onchange="this.form.submit()">${opt('', 'All projects', !s.project)}${s.projects.map((p) => opt(p.id, fullName(p), s.project?.id === p.id)).join('')}</select></div>
      ${clients ? `<div><label for="ta-client">Client</label><select id="ta-client" name="client" onchange="this.form.submit()">${opt('', 'All clients', !s.client)}${s.clients.map((c) => opt(c.id, c.name, s.client?.id === c.id)).join('')}</select></div>` : ''}
      ${types ? `<div><label for="ta-type">Task type</label><select id="ta-type" name="type" onchange="this.form.submit()">${opt('', 'All task types', !s.type)}${s.types.map((t) => opt(t.id, `${t.name}${t.hidden ? ' (hidden)' : ''}`, s.type?.id === t.id)).join('')}</select></div>` : ''}
    </div>
    <div class="actions"><button class="sm">Show</button>${FILTERS.some((f) => s[f]) ? `<a class="btn sm plain" href="${esc(link({ va: '', project: '', client: '', type: '' }))}">Clear filters</a>` : ''}</div></form>`;
  const labels = Object.entries(RANGE_LABELS).filter(([k]) => k !== 'cycle' || (cycle && s.project));
  const buttons = `<nav class="pj-grid hr-ranges ta-ranges" aria-label="Time range">${labels.map(([k, label]) =>
    `<a class="pj-btn ${k === s.kind ? 'on' : ''}" href="${esc(link({ range: k, show: '' }))}" ${k === s.kind ? 'aria-current="page"' : ''}><b>${esc(label)}</b></a>`).join('')}</nav>`;
  const keep = ['va', 'project', 'client', 'type'].map((k) => (s[k] ? `<input type="hidden" name="${k}" value="${esc(s[k].id)}">` : '')).join('');
  const custom = s.kind === 'custom' ? `<form method="get" action="${base}" class="card"><input type="hidden" name="range" value="custom">${keep}
      <div class="hm hr-dates"><div><label for="ta-from" style="margin-top:0">From</label><input type="date" id="ta-from" name="from" value="${esc(s.range.from || '')}" required></div>
        <div><label for="ta-to" style="margin-top:0">To</label><input type="date" id="ta-to" name="to" value="${esc(s.range.to || '')}" required></div></div>
      <button>${icon('check')} Show these dates</button>
      ${s.range.note ? `<p class="small">${esc(s.range.note)}</p>` : '<p class="small">Up to one year.</p>'}</form>` : '';
  return { form, buttons, custom };
}

// "This pay period: Oct 2 – Oct 15, 2026 · Paid Oct 23"
function rangeLine(s) {
  if (s.range.none) return `<p class="meta" style="margin:0">${esc(s.range.none)}</p>`;
  const label = s.kind === 'cycle' ? 'Billing cycle' : RANGE_LABELS[s.kind];
  return `<p class="meta" style="margin:0">${esc(label)}: <b>${esc(span(s.range.from, s.range.to))}</b>${s.range.payDay ? ` · <b>Paid ${esc(shortDate(s.range.payDay))}</b>` : ''}</p>`;
}

function logRow(l, back) {
  return `<div class="item flat hs-row"><div class="item-head">${avatar(l.va_name || '?')}<div class="grow">
      <a class="title" href="/admin/time/log/${l.id}?back=${esc(encodeURIComponent(back))}">${esc(l.va_name || 'Someone')} · ${esc(l.type_name || 'General')}</a>
      <div class="sub">${esc(l.project ? projectName(l.project) : `Project ${l.project_id}`)}</div>
      ${l.description ? `<div class="sub log-desc">${esc(l.description)}</div>` : ''}
      ${l.fileList.length ? `<div class="hs-files">${l.fileList.map((f) => `<a href="/time-files/${f.id}" target="_blank" rel="noopener">${icon('doc')} ${esc(f.name)}</a>`).join('')}</div>` : ''}
      <div class="stamp">${icon('lock')} ${esc(stamp(l, l.zone))}</div></div>
      <span class="chip info tl-mins">${esc(hm(l.minutes))}</span></div></div>`;
}

export function timePage({ user, message, s, sum, logs, more, show, query }) {
  const base = '/admin/time';
  const link = linker(base, s, query);
  const { form, buttons, custom } = filterParts(s, link, base);
  const here = link({ show: show > 100 ? show : '' });
  const csv = link({}).replace('/admin/time', '/admin/time.csv');
  const summaryCsv = link({}).replace('/admin/time', '/admin/time/summary.csv');
  const filters = [s.va && s.va.name, s.project && projectName(s.project), s.client && s.client.name, s.type && s.type.name].filter(Boolean);
  const totalCard = `<div class="card hr-total">${rangeLine(s)}
      <div class="hr-big">${esc(hm(sum.total))}</div>
      <p class="meta" style="margin:0">${sum.count ? `${sum.count} time log${sum.count === 1 ? '' : 's'}` : 'No time logged in this range.'} · ${esc(filters.length ? filters.join(' · ') : 'All VAs and projects')}</p>
      ${sum.count ? `<div class="actions"><a class="btn sm plain" href="${esc(csv)}" download>${icon('download')} Logs (CSV)</a><a class="btn sm plain" href="${esc(summaryCsv)}" download>${icon('download')} Summary (CSV)</a></div>` : ''}
      ${sum.count > 10000 ? '<p class="small">The logs file holds the newest 10,000 logs. Choose a shorter range for the rest.</p>' : ''}</div>`;
  const breakdown = (title, rows) => (rows.length > 1 ? `<div class="card"><h2>${esc(title)}</h2>${rows.map((r) => shareRow(r.name, r.minutes, sum.total)).join('')}</div>` : '');
  const chartCard = sum.chart && sum.total ? columns(sum.chart) : '';

  const days = [...new Set(logs.map((l) => l.work_date))];
  const list = logs.length ? days.map((d) => {
    const dayLogs = logs.filter((l) => l.work_date === d);
    return `<h3 class="hs-day"><span>${esc(formatDate(d, true))}</span><span>${esc(hm(dayLogs.reduce((t, l) => t + l.minutes, 0)))}${more && d === days[days.length - 1] ? '+' : ''}</span></h3>${dayLogs.map((l) => logRow(l, here)).join('')}`;
  }).join('') : empty('No time logged in this range.');
  const listCard = `<div class="card" id="logs"><h2>Time logs</h2>
      <p class="small" style="margin:0 0 6px">Newest first. Open a log to see its changes. Logs are changed only by the VA, on the day they are for (or on a day you allowed under Exceptions).</p>
      ${list}${more ? `<a class="btn big-btn plain" href="${esc(link({ show: String(show + 100) }))}#logs">Show more</a>` : ''}</div>`;

  return layout({
    title: 'Time', user, active: '/admin/time', message,
    body: `${adminTimeTabs('/admin/time')}${form}${buttons}${custom}${totalCard}
      <div class="ta-grid">${breakdown('By VA', sum.vaRows)}${breakdown('By project', sum.projectRows)}${breakdown('By client', sum.clientRows)}${breakdown('By task type', sum.typeRows)}</div>
      ${chartCard}${listCard}
      <p class="small">Days are counted in each project’s time zone. ${s.project ? `“Today” is ${esc(formatDate(s.today))} in this project’s zone (${esc(s.zone)}).` : `“Today” is ${esc(formatDate(s.today))} in your time zone (${esc(s.myZone)}).`} Deleted logs are not counted.</p>`,
  });
}

// ---- One log (read-only) ----

const FIELD_WORDS = { task_type: 'Task type', description: 'Description', minutes: 'Time', file: 'File', deleted: 'Deleted' };
const changeValue = (c, v) => (v === null || v === undefined || v === '' ? '(empty)' : c.f === 'minutes' ? duration(v) : c.f === 'deleted' ? 'yes' : String(v));

export function logPage({ user, message, log, files, history, zone, backTo, zoho = null }) {
  const z = ZONES[zone] || ZONES.EST;
  const when = (iso) => `${formatDate(partsIn(z, new Date(iso)).date, true)}, ${formatTimeIn(iso, z)} ${zone}`;
  const project = { client: log.client, name: log.project_name, is_coverage: log.is_coverage, active: log.active };
  const changes = history.length ? history.map((h) => {
    let list = [];
    try { list = JSON.parse(h.changes || '[]'); } catch { list = []; }
    return `<div class="item flat"><div class="item-head"><div class="grow"><div class="title">${esc(h.summary)}</div>
      <div class="sub">${esc(h.user_name || 'Someone')} · ${esc(when(h.at))}</div>
      ${list.length ? `<ul class="changes">${list.map((c) => `<li><b>${esc(FIELD_WORDS[c.f] || c.f)}</b>: ${esc(changeValue(c, c.from))} → ${esc(changeValue(c, c.to))}</li>`).join('')}</ul>` : ''}</div></div></div>`;
  }).join('') : empty('No changes: the log is as it was entered.');
  const fileList = files.map((f) => `<div class="tl-file"><a href="/time-files/${f.id}" target="_blank" rel="noopener">${icon('doc')} ${esc(f.file_name)}</a></div>`).join('');
  return layout({
    title: 'Time log', user, active: '/admin/time', message,
    body: `<div class="card">
      <div style="display:flex;gap:12px;align-items:center">${avatar(log.va_name || '?')}<div class="grow">
        <p class="meta" style="margin:0"><b>${esc(log.va_name || 'Someone')}</b> · <a href="/admin/projects/${esc(encodeURIComponent(log.project_id))}">${esc(projectName(project))}</a> · ${esc(formatDate(log.work_date, true))}</p>
        <h2 style="margin:0">${esc(log.type_name || 'General')} · ${esc(hm(log.minutes))}</h2></div></div>
      <div class="chips">${log.deleted_at ? chip(`Deleted ${when(log.deleted_at)}${log.deleted_by_name ? ` by ${log.deleted_by_name}` : ''}`, 'bad') : ''}${chip(log.source === 'timer' ? 'From a timer' : log.source === 'zoho' ? 'Copied from Zoho' : 'Typed in', 'muted')}</div>
      <p class="stamp">${icon('lock')} ${esc(stamp(log, zone))}</p>
      ${log.started_at && log.ended_at ? `<p class="small" style="margin:4px 0 0">Timer ran ${esc(formatTimeIn(log.started_at, z))} – ${esc(formatTimeIn(log.ended_at, z))} ${esc(zone)}</p>` : ''}
      ${log.description ? `<div class="bubble">${esc(log.description)}</div>` : '<p class="small">No description.</p>'}
      ${zohoBox(zoho)}
      ${fileList ? `<label>Attachments</label>${fileList}` : ''}
      <p class="small">Read-only: time is changed only by the VA, on the day it is for. To let them fix an earlier day, add an <a href="/admin/time/exceptions">exception</a>.</p>
      <p style="margin:12px 0 0"><a href="${esc(backTo)}">&larr; Back</a></p></div>
      ${section({ title: 'Changes', count: history.length, open: true, key: 'changes', body: changes })}`,
  });
}

// ---- Packages ----

export function packagesPage({ user, message, list }) {
  const over = list.filter((r) => r.usage.tone === 'bad').length, near = list.filter((r) => r.usage.tone === 'warn').length;
  const rows = list.map((r) => {
    const p = r.project;
    return `<div class="item flat pk-row"><div class="item-head"><div class="grow">
      <a class="title" href="/admin/projects/${esc(encodeURIComponent(p.id))}">${esc(p.client_name || p.client)}</a>
      <div class="sub">${esc(p.name)} · ${esc(p.vas || 'No VA')}</div>
      <div class="sub">Cycle ${esc(span(r.usage.start, r.usage.end))} · package ${esc(String(Number(r.usage.hours)))} h${r.coverageCounted ? '' : p.is_coverage ? ' · coverage project' : ''}</div>
      ${usageBlock(r.usage)}</div>
      <span class="chip ${r.usage.tone || 'muted'} pk-pct">${r.usage.pct}%</span></div></div>`;
  }).join('');
  return layout({
    title: 'Packages', user, active: '/admin/time', message,
    body: `${adminTimeTabs('/admin/time/packages')}
      <div class="card"><h2>Package use this billing cycle</h2>
        <p class="meta" style="margin:0">${list.length ? `${list.length} project${list.length === 1 ? '' : 's'} with a package${over ? ` · <b class="bad-text">${over} over</b>` : ''}${near ? ` · <b class="warn-text">${near} at 80% or more</b>` : ''}` : 'No active project has a package yet.'}</p>
        <p class="small" style="margin:6px 0 0">Time of every VA on the project in its current billing cycle (each project has its own billing day), against the package in effect on the cycle’s first day. Time on the client’s coverage projects counts too, shown as “incl. coverage”. Most used first.</p></div>
      ${list.length ? `<div class="card">${rows}</div>` : `<div class="card">${empty('Set a package on a project’s page (Clients > Projects > the project > Package).')}</div>`}`,
  });
}

// ---- Exceptions ----

export function exceptionsPage({ user, message, exceptions, vas, projects, today }) {
  const status = (e) => (!e.active ? chip('Project closed', 'muted') : !e.on_project ? chip('VA no longer on the project', 'muted') : chip('In use', 'good'));
  const days = (e) => Math.round((Date.parse(`${e.to_date}T00:00:00Z`) - Date.parse(`${e.from_date}T00:00:00Z`)) / 86400000) + 1;
  const rows = exceptions.map((e) => `<div class="item flat"><div class="item-head">${avatar(e.va_name)}<div class="grow">
      <div class="title">${esc(e.va_name)} · ${esc(formatDate(e.from_date, true))}${e.to_date !== e.from_date ? ` – ${esc(formatDate(e.to_date, true))}` : ''} <span class="small">(${days(e)} day${days(e) === 1 ? '' : 's'})</span></div>
      <div class="sub"><a href="/admin/projects/${esc(encodeURIComponent(e.project_id))}#exceptions">${esc(projectName({ client: e.client, name: e.project_name, is_coverage: e.is_coverage, active: e.active }))}</a></div>
      <div class="sub">${e.reason ? `${esc(e.reason)} · ` : ''}allowed by ${esc(e.approved_by_name || 'someone')}${e.approved_at ? ` on ${esc(zohoTime(e.approved_at))}` : ''}</div>
      <div class="chips" style="margin:4px 0 0">${status(e)}</div></div>
      <form method="post" action="/admin/time/exceptions/${e.id}/delete" data-confirm="Remove this exception? The VA can then no longer add or change time for those days."><button class="sm danger" style="margin:0">Remove</button></form></div></div>`).join('');
  const addForm = `<form method="post" action="/admin/time/exceptions" style="padding:0 8px 8px">
      <div class="row">
        <div><label for="ex-va">VA</label><select id="ex-va" name="user_id" required><option value="">Choose…</option>${vas.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
        <div><label for="ex-project">Project</label><select id="ex-project" name="project_id" required><option value="">Choose…</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(fullName(p))}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div><label for="ex-from">First day</label><input type="date" id="ex-from" name="from_date" required max="${esc(today)}"></div>
        <div><label for="ex-to">Last day</label><input type="date" id="ex-to" name="to_date" required max="${esc(today)}"></div>
      </div>
      <label for="ex-reason">Reason</label><input type="text" id="ex-reason" name="reason" maxlength="500" placeholder="For example: forgot to log on Monday">
      <p class="small">The VA must be on the project. The days can’t be in the future (today in the project’s time zone is the last day allowed).</p>
      <button>Allow these days</button></form>`;
  return layout({
    title: 'Exceptions', user, active: '/admin/time', message,
    body: `${adminTimeTabs('/admin/time/exceptions')}
      ${section({ title: 'Allow a VA to log earlier days', key: 'add', open: true, hint: 'VAs log time only for today (in the project’s time zone). An exception lets one VA add or change time for some earlier days in one project. It stays until you remove it.', body: addForm })}
      ${section({ title: 'All exceptions', count: exceptions.length, key: 'list', open: true, hint: 'Newest first. Each project’s page also lists its own exceptions.', body: rows || empty('No exceptions yet. VAs can log time only for today.') })}`,
  });
}

// ---- Missed time ----

const CHECK_MODES = [['off', 'Off'], ['log', 'Log only'], ['send', 'Log and send Slack DMs']];

// The daily time check switch: what it is set to, since when, what the last check did, and the form to change it.
function timeCheckCard(check, back, myZone) {
  const zone = ZONES[myZone] || ZONES.EST;
  const label = CHECK_MODES.find(([k]) => k === check.mode)[1];
  const tone = check.mode === 'off' ? 'muted' : check.mode === 'log' ? 'info' : 'good';
  const since = check.mode !== 'off' && check.since ? ` · checking days from <b>${esc(formatDate(partsIn(zone, new Date(check.since)).date, true))}</b>` : '';
  const l = check.last;
  const last = l ? `Last check: ${esc(formatDate(l.date, true))} (${esc(l.zone)} projects), ran ${esc(formatDate(partsIn(zone, new Date(l.at)).date))} at ${esc(formatTimeIn(l.at, zone))} ${esc(myZone || 'EST')}
      · ${l.holiday ? `holiday (${esc(l.holiday)}), nothing checked` : `${l.checked} VA project-day${l.checked === 1 ? '' : 's'} checked, ${l.missed} missed`}`
    : check.mode === 'off' ? 'Not checked yet.' : 'Not checked yet. The first check runs after 12:30 AM tonight (project time).';
  const opts = CHECK_MODES.map(([k, t]) => `<option value="${k}" ${k === check.mode ? 'selected' : ''}>${esc(t)}</option>`).join('');
  return `<div class="card" id="time-check"><h2>${icon('timer')} Daily time check ${chip(label, tone)}</h2>
    <p class="meta" style="margin:0">Each night, after 12:30 AM in each project’s time zone, the app checks the day before: every VA must log at least 1 hour in each project on their workdays for it.${since}</p>
    <p class="small" style="margin:6px 0 0">${last}</p>
    <form method="post" action="/admin/time/check" class="actions" data-confirm="Change the daily time check?">
      <input type="hidden" name="back" value="${esc(back)}">
      <select id="tc-mode" name="mode" aria-label="Daily time check" style="flex:1 1 220px;width:auto">${opts}</select>
      <button class="sm">Save</button></form>
    <p class="small" style="margin:6px 0 0"><b>Log only</b>: missed days are added here, VAs get nothing. <b>Log and send Slack DMs</b>: the VA also gets a Slack message about each missed day (a few per minute). Turning it on never checks days before today.</p></div>`;
}

// Excuse a missed day (with a note), or take the excuse back.
function excuseForm(r, back) {
  if (r.excused_at) {
    return `<form method="post" action="/admin/time/missed/${r.id}/unexcuse" class="actions" style="margin:4px 0 0"><input type="hidden" name="back" value="${esc(back)}">
      <span class="small">Excused by ${esc(r.excused_by_name || 'an admin')} on ${esc(zohoTime(r.excused_at))}${r.excuse_note ? `: ${esc(r.excuse_note)}` : ''}</span>
      <button class="sm plain" style="margin:0">Undo excuse</button></form>`;
  }
  return `<details style="margin:4px 0 0"><summary class="small" style="cursor:pointer">Excuse this day</summary>
    <form method="post" action="/admin/time/missed/${r.id}/excuse" class="actions" style="margin:4px 0 0"><input type="hidden" name="back" value="${esc(back)}">
      <input type="text" name="note" maxlength="500" placeholder="Note, for example: client closed that day" aria-label="Note" style="flex:1 1 200px;width:auto">
      <button class="sm" style="margin:0">Excuse</button></form></details>`;
}

const DM_CHIPS = { sent: ['VA notified', 'good'], due: ['Slack DM waiting', 'info'], sending: ['Sending Slack DM', 'info'], failed: ['Slack DM failed', 'bad'], no_slack: ['No Slack ID', 'warn'] };

export function missedPage({ user, message, s, rows, more, perVa, everAny, query, check, back }) {
  const base = '/admin/time/missed';
  const link = linker(base, s, query);
  const { form, buttons, custom } = filterParts(s, link, base, { types: false, clients: false, cycle: false });
  const rangeWord = s.kind === 'custom' ? 'in these dates' : (RANGE_LABELS[s.kind] || '').toLowerCase();
  const counts = perVa.length ? perVa.map((r) => `<div class="hb-row"><div class="hb-text"><span class="hb-name"><a href="${esc(link({ va: r.user_id }))}">${esc(r.va_name || `User ${r.user_id}`)}</a></span>
      <span class="hb-val">Missed ${r.days} day${r.days === 1 ? '' : 's'} ${esc(rangeWord)}${r.n !== r.days ? ` (${r.n} project-days)` : ''}</span></div></div>`).join('') : empty('Nobody missed the daily minimum in this range.');
  const list = rows.map((r) => {
    const p = s.byProject.get(String(r.project_id));
    return `<div class="item flat"><div class="item-head">${avatar(r.va_name || '?')}<div class="grow">
      <div class="title">${esc(r.va_name || 'Someone')} · ${esc(formatDate(r.work_date, true))}</div>
      <div class="sub">${esc(p ? projectName(p) : `Project ${r.project_id}`)}</div>
      <div class="sub">Logged <b>${esc(hm(r.minutes_logged))}</b> of the ${esc(hm(r.minimum))} minimum</div>
      ${excuseForm(r, back)}</div>
      <span class="chips side-chips">${r.excused_at ? chip('Excused', 'muted') : ''}${r.notified_at ? chip('VA notified', 'good') : DM_CHIPS[r.dm] ? chip(...DM_CHIPS[r.dm]) : chip('Not notified', 'muted')}</span></div></div>`;
  }).join('');
  const csv = link({}).replace(base, '/admin/time/missed.csv');
  return layout({
    title: 'Missed time', user, active: '/admin/time', message,
    body: `${adminTimeTabs(base)}
      ${timeCheckCard(check, back, s.myZone)}
      ${everAny ? '' : `<div class="card"><p class="meta" style="margin:0"><b>Nothing here yet.</b> ${check.mode === 'off' ? 'The daily time check is off, so no days are added. Turn it on above (Log only first, to see what it finds).' : 'Missed days appear here the morning after.'}</p></div>`}
      ${form}${buttons}${custom}
      <div class="card">${rangeLine(s)}<p class="small" style="margin:6px 0 0">A day counts as missed when a VA logged less than the daily minimum (1 hour) in a project on one of their workdays. Approved time off, holidays and emergencies don’t count, and neither do excused days.</p>
        ${rows.length ? `<div class="actions"><a class="btn sm plain" href="${esc(csv)}" download>${icon('download')} Download (CSV)</a></div>` : ''}</div>
      <div class="card"><h2>By VA</h2>${counts}</div>
      <div class="card"><h2>Days</h2>${list || empty('No missed days in this range.')}${more ? '<p class="small">Showing the newest 1,000. Choose a shorter range, or download the CSV.</p>' : ''}</div>`,
  });
}

// ---- The Time box on a VA's record page ----

export function vaTimeBox(t) {
  if (!t) return '';
  const line = (label, p) => (p ? `<div class="hb-row"><div class="hb-text"><span class="hb-name">${esc(label)}<small>${esc(span(p.from, p.to))}${p.payDay ? ` · paid ${esc(shortDate(p.payDay))}` : ''}</small></span><span class="hb-val">${esc(hm(p.minutes))}</span></div></div>` : '');
  const body = `<div style="padding:0 8px 8px">${line('This pay period', t.cur)}${line('Last pay period', t.prev)}${!t.cur && !t.prev ? '<p class="meta">No pay periods around today (Settings > Pay periods).</p>' : ''}
    <div class="actions"><a class="btn sm plain" href="/admin/time?va=${t.userId}">${icon('timer')} See all their time</a></div></div>`;
  return section({ title: 'Time', key: 'time', open: true, hint: 'Hours logged in all projects (deleted logs not counted).', body });
}

