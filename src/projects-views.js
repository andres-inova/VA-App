// The pages of projects.js: a project's settings page, Settings > Task types and Settings > Pay periods.

import { esc } from './util.js';
import { layout, icon, avatar, chip, section, empty, zohoTime, settingsTabs, dayBoxes, isAppProject } from './views.js';
import { formatDate, formatHM, parseHHMM, zoneFor } from './time.js';
import { usageBlock } from './timeadmin-views.js';

const ZONE_NAMES = { PST: 'Pacific (PST)', MST: 'Mountain (MST)', CST: 'Central (CST)', EST: 'Eastern (EST)' };
const hours = (h) => `${Number(h)} hour${Number(h) === 1 ? '' : 's'}`;
const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const logList = (log) => (log.length ? log.map((l) => `<div class="item flat"><div class="item-head"><div class="grow"><div class="title">${esc(l.summary)}</div>
  <div class="sub">${esc(l.user_name || 'Automatic')} · ${esc(zohoTime(l.at))}</div></div></div></div>`).join('') : empty('No changes yet.'));

// ---- A project's page ----

export function projectPage({ user, project, settings, today, cycle, assignments, vas, packages, history, exceptions = [], creator, message, usage = null, taskTypes = [], ownTypes = false }) {
  const app = isAppProject(project);
  const here = `/admin/projects/${esc(project.id)}`;
  const client = settings.client;
  const from = { client: 'from the client record', va: "from the VA's time zone", none: 'no client or VA time zone, so Eastern', saved: '' };
  const zoneSelect = (name, selected, first) => `<select name="${name}" aria-label="Time zone">${first}
    ${['PST', 'MST', 'CST', 'EST'].map((z) => `<option value="${z}" ${z === selected ? 'selected' : ''}>${ZONE_NAMES[z]}</option>`).join('')}</select>`;

  const top = `<div class="card">
    <div style="display:flex;gap:12px;align-items:center">${avatar(project.client)}<div class="grow">
      <h2 style="margin:0">${esc(project.name)}</h2>
      <div class="meta">Client: ${client ? `<a href="/admin/clients/${client.id}"><b>${esc(client.name)}</b></a>` : `<b>${esc(project.client || 'No client')}</b>`}
        ${app ? `${icon('lock')} <span class="small">can't change</span>` : '<span class="small">(chosen on the Projects page)</span>'}</div></div></div>
    <div class="chips">${app ? chip('Made in the app', 'info') : chip('From Zoho Projects', 'muted')}${project.is_coverage ? chip('Coverage', 'info') : ''}${project.active ? '' : chip('Closed', 'bad')}</div>
    ${app && creator ? `<p class="small" style="margin:0">Made by ${esc(creator)}${settings.createdAt ? ` on ${esc(zohoTime(settings.createdAt))}` : ''}.</p>` : ''}
    <p style="margin:8px 0 0"><a href="/admin/projects">&larr; All projects</a></p></div>`;

  const settingsForm = `<form method="post" action="${here}/settings" style="padding:0 8px 8px">
    ${app ? `<label for="pj-name">Project name</label><input type="text" id="pj-name" name="name" maxlength="120" value="${esc(project.name)}" required>` : ''}
    <div class="row">
      <div><label for="pj-zone">Time zone</label>${zoneSelect('time_zone', settings.saved?.time_zone || '', `<option value="">${esc(settings.zoneFrom === 'saved' ? 'Default (the client record, else the VA)' : `Default: ${settings.zone}, ${from[settings.zoneFrom]}`)}</option>`).replace('<select', '<select id="pj-zone"')}
        <p class="small" style="margin:4px 0 0">Time logged counts on the day it is in this time zone. VAs log time for "today" here.</p></div>
      <div><label for="pj-billing">Billing day of the month</label>
        <select id="pj-billing" name="billing_day"><option value="">${esc(settings.billingFrom === 'saved' ? "Default (the client's first Invoice date, else the 1st)" : `Default: the ${ordinal(settings.billingDay)}${settings.billingFrom === 'client' ? " (from the client's Invoice date)" : ' (the client has no Invoice date)'}`)}</option>
        ${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${settings.saved?.billing_day === d ? 'selected' : ''}>${ordinal(d)}</option>`).join('')}</select>
        <p class="small" style="margin:4px 0 0">A billing cycle runs from this day to the day before it next month.</p></div>
    </div>
    <button>Save settings</button></form>`;

  // Packages: the current one, changes still to come, and older ones.
  const current = [...packages].reverse().find((p) => p.effective_from <= today) || null;
  const upcoming = packages.filter((p) => p.effective_from > today);
  const past = packages.filter((p) => p.effective_from <= today && p !== current).reverse();
  const pkgRow = (p, side = '', del = false) => `<div class="item flat"><div class="item-head"><div class="grow">
    <div class="title">${esc(hours(p.hours))} per billing cycle</div>
    <div class="sub">From ${esc(formatDate(p.effective_from, true))} · set by ${esc(p.set_by_name || 'someone')} on ${esc(zohoTime(p.set_at))}</div></div>${side}
    ${del ? `<form method="post" action="${here}/package/${p.id}/delete" data-confirm="Remove this upcoming package change?"><button class="sm danger" style="margin:0">Remove</button></form>` : ''}</div></div>`;
  const packageBody = `<div style="padding:0 8px">
      <p class="meta">This billing cycle: <b>${esc(formatDate(cycle.start, false))} – ${esc(formatDate(cycle.end, true))}</b>. Package now: <b>${current ? esc(hours(current.hours)) : 'not set'}</b>.</p></div>
    ${usage && (usage.current || usage.last) ? `<div style="padding:0 8px 8px" id="package-use">${usageBlock(usage.current, { label: 'Hours this cycle' })}${usageBlock(usage.last, { label: 'Last cycle' })}
      <p class="small" style="margin:6px 0 0">Time of every VA on this project${usage.coverageCounted ? ', plus the client’s coverage projects' : ''}, against the package in effect on the cycle’s first day. <a href="/admin/time?project=${esc(encodeURIComponent(project.id))}&amp;range=cycle">See the time logs</a> · <a href="/admin/time/packages">All packages</a></p></div>` : ''}
    ${current ? pkgRow(current, chip('Now', 'good')) : ''}
    ${upcoming.map((p) => pkgRow(p, chip('Upcoming', 'info'), true)).join('')}
    ${past.length ? `<details class="section" style="margin:8px 0;box-shadow:none;background:var(--surface-2)"><summary>Earlier packages <span class="count">${past.length}</span>${icon('chevron', 'chev')}</summary>
      <div class="sec-body">${past.map((p) => pkgRow(p)).join('')}</div></details>` : ''}
    <form method="post" action="${here}/package" style="padding:0 8px 8px">
      <div class="row">
        <div><label for="pk-hours">Hours per billing cycle</label><input type="number" id="pk-hours" name="hours" min="0" max="10000" step="0.25" required
          value="${current ? '' : esc(settings.packageHint ?? '')}" placeholder="${current ? esc(current.hours) : 'For example 40'}"></div>
        <div><label for="pk-from">Takes effect on</label><input type="date" id="pk-from" name="effective_from" required value="${esc(current ? billingNext(cycle) : cycle.start)}"></div>
      </div>
      <p class="small">${current ? 'A change takes effect on the date you choose (for example the start of the next billing cycle); until then the current package counts.' : `No package yet.${settings.packageHint ? ` The hours above come from "Package hours" on the client record (${esc(settings.packageHint)}).` : ''}`}</p>
      <button>${current ? 'Change package' : 'Set package'}</button></form>`;

  // VAs: the same rows and addresses as on the Projects page (they come back here).
  const vaZone = (a) => (zoneFor(a.va_zone) ? a.va_zone : 'EST');
  const startZone = (selected, vz) => `<select name="time_zone" aria-label="Time zone of the start time">
    <option value="">${vz ? `VA's zone (${esc(vz)})` : "VA's zone"}</option>
    ${['PST', 'MST', 'CST', 'EST'].map((z) => `<option value="${z}" ${z === selected ? 'selected' : ''}>${z}</option>`).join('')}</select>`;
  const back = `<input type="hidden" name="back" value="${here}">`;
  const vaRow = (a) => `<div class="assign">
    <form method="post" action="/admin/assignments/${a.id}" class="assign" style="border:0;padding:0;flex:1">${back}
      <span class="who">${avatar(a.va_name)}${esc(a.va_name)}</span>
      <input type="time" name="start_time" value="${esc(a.start_time || '')}" aria-label="Start time">
      ${startZone(zoneFor(a.time_zone) ? a.time_zone : '', vaZone(a))}
      ${project.is_coverage ? `${a.days.split(',').map((d) => `<input type="hidden" name="days" value="${esc(d)}">`).join('')}<span class="small">Only on days they cover this client</span>` : dayBoxes(a.days)}
      <button class="sm" style="margin:0">Save</button></form>
    <form method="post" action="/admin/assignments/${a.id}/delete" data-confirm="${esc(`Take ${a.va_name} off this project?`)}">${back}<button class="sm danger" style="margin:0">Remove</button></form>
    ${parseHHMM(a.start_time) ? `<span class="small" style="width:100%">Starts ${esc(formatHM(parseHHMM(a.start_time)))} ${esc(zoneFor(a.time_zone) ? a.time_zone : vaZone(a))}</span>` : `<div style="width:100%">${chip('No start time: no check-in or late alerts for this project', 'warn')}</div>`}
  </div>`;
  const addVa = `<form method="post" action="/admin/projects/${esc(project.id)}/assign" class="assign" style="border:0;padding:10px 8px">${back}
    <select name="user_id" required aria-label="VA"><option value="">Add a VA</option>${vas.filter((v) => !assignments.some((a) => a.user_id === v.id)).map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
    <input type="time" name="start_time" aria-label="Start time">${startZone('', '')}${dayBoxes()}
    <button class="sm" style="margin:0">${icon('plus')} Add</button></form>`;

  // Past-date exceptions: who may log time for which earlier days (all projects: Time > Exceptions).
  const exceptionBody = `${exceptions.map((e) => `<div class="item flat"><div class="item-head">${avatar(e.va_name)}<div class="grow">
      <div class="title">${esc(e.va_name)} · ${esc(formatDate(e.from_date, true))}${e.to_date !== e.from_date ? ` – ${esc(formatDate(e.to_date, true))}` : ''}</div>
      <div class="sub">${e.reason ? `${esc(e.reason)} · ` : ''}allowed by ${esc(e.approved_by_name || 'someone')}${e.approved_at ? ` on ${esc(zohoTime(e.approved_at))}` : ''}</div></div>
      <form method="post" action="${here}/exceptions/${e.id}/delete" data-confirm="Remove this exception? The VA can then no longer add or change time for those days."><button class="sm danger" style="margin:0">Remove</button></form></div></div>`).join('') || empty('No exceptions. VAs can log time only for today.')}
    <form method="post" action="${here}/exceptions" style="padding:0 8px 8px">
      <div class="row">
        <div><label for="ex-va">VA</label><select id="ex-va" name="user_id" required><option value="">Choose…</option>${assignments.map((a) => `<option value="${a.user_id}">${esc(a.va_name)}</option>`).join('')}</select></div>
        <div><label for="ex-from">First day</label><input type="date" id="ex-from" name="from_date" required max="${esc(today)}"></div>
        <div><label for="ex-to">Last day</label><input type="date" id="ex-to" name="to_date" required max="${esc(today)}"></div>
      </div>
      <label for="ex-reason">Reason</label><input type="text" id="ex-reason" name="reason" maxlength="500" placeholder="For example: forgot to log on Monday">
      <button>Allow these days</button></form>
    <p class="small" style="padding:0 8px 8px;margin:0"><a href="/admin/time/exceptions">See the exceptions of all projects</a></p>`;

  const closeForm = app ? `<div class="card"><form method="post" action="${here}/${project.active ? 'close' : 'reopen'}"
      ${project.active ? 'data-confirm="Close this project? It stops showing on the Projects page and for its VAs. Nothing is deleted."' : ''}>
      <p class="meta" style="margin:0">${project.active ? 'Close the project when the work for this client ends. Nothing is deleted, and it can be reopened from this page.' : 'This project is closed.'}</p>
      <button class="${project.active ? 'danger' : ''} sm">${project.active ? 'Close project' : 'Reopen project'}</button></form></div>` : '';

  const typesBody = `<form method="post" action="${here}/task-types" style="padding:0 8px 8px">
      <div class="checks">${taskTypes.map((t) => `<label class="check"><input type="checkbox" name="type" value="${t.id}" ${t.on ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}</div>
      <p class="small">${ownTypes ? 'This project has its own list: VAs pick only from the ticked task types.' : 'This project uses the company-wide list (Settings > Task types). Save to give it its own list.'}
        Logs already saved keep their task type.</p>
      <button name="op" value="save">Save list</button>
      ${ownTypes ? '<button name="op" value="reset" class="sm" data-confirm="Go back to the company-wide list for this project?">Use the company-wide list</button>' : ''}</form>`;

  return layout({
    title: 'Project', user, active: '/admin/projects', message,
    body: `${top}
    ${section({ title: 'Settings', open: true, key: 'settings', body: settingsForm })}
    ${section({ title: 'Package', open: true, key: 'package', count: packages.length || undefined, hint: 'How many hours the client buys per billing cycle. A change can start on a later date.', body: packageBody })}
    ${section({ title: 'VAs', count: assignments.length, open: true, key: 'vas', hint: project.is_coverage ? 'Coverage project: the start time is used only on days the VA covers this client.' : 'Start time and work days of each VA on this project (same as on the Projects page).', body: `${assignments.length ? assignments.map(vaRow).join('') : empty('No VA on this project yet.')}${addVa}` })}
    ${section({ title: 'Task types', count: taskTypes.filter((t) => t.on).length, open: false, key: 'task-types', hint: 'What VAs can choose when they log time on this project.', body: typesBody })}
    ${section({ title: 'Past-date exceptions', count: exceptions.length || undefined, open: exceptions.length > 0, key: 'exceptions', hint: `VAs log time only for today (${esc(settings.zone)}). Here you can allow a VA to add or change time for earlier days in this project.`, body: exceptionBody })}
    ${section({ title: 'History', count: history.length, open: false, key: 'history', hint: 'Changes to this project, newest first (the last 50).', body: logList(history) })}
    ${closeForm}`,
  });
}

// The first day of the next billing cycle (the suggested date for a package change).
function billingNext(cycle) {
  const d = new Date(`${cycle.end}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---- Settings > Task types ----

const opForm = (op, id, inner, confirm = '', action = '/admin/settings/task-types') => `<form method="post" action="${action}" class="inline-form"${confirm ? ` data-confirm="${esc(confirm)}"` : ''}>
  <input type="hidden" name="op" value="${op}">${id ? `<input type="hidden" name="id" value="${id}">` : ''}${inner}</form>`;

export function taskTypesPage({ user, types, log, message }) {
  const row = (t, i) => `<details class="item ${t.hidden ? 'muted-row' : ''}"><summary class="item-head"><div class="grow">
      <div class="title">${esc(t.name)}</div><div class="sub">${t.used ? `Used by ${t.used} time log${t.used === 1 ? '' : 's'} or timer${t.used === 1 ? '' : 's'}` : 'Not used yet'}</div></div>
      <span class="chips side-chips">${t.hidden ? chip('Hidden', 'muted') : ''}</span>${icon('chevron', 'chev')}</summary>
    <div class="item-body" style="padding-left:12px">
      ${opForm('rename', t.id, `<input type="text" name="name" maxlength="60" required value="${esc(t.name)}" aria-label="New name" style="flex:1 1 200px;width:auto"><button class="sm">Rename</button>`)}
      <div class="actions">
        ${i > 0 ? opForm('up', t.id, '<button class="sm plain">Move up</button>') : ''}
        ${i < types.length - 1 ? opForm('down', t.id, '<button class="sm plain">Move down</button>') : ''}
        ${opForm(t.hidden ? 'show' : 'hide', t.id, `<button class="sm plain">${t.hidden ? 'Show again' : 'Hide'}</button>`)}
        ${t.used ? '<span class="small">Has time logged, so it can only be hidden.</span>'
          : opForm('delete', t.id, '<button class="sm danger">Delete</button>', `Delete the task type "${t.name}"?`)}
      </div></div></details>`;
  return layout({
    title: 'Task types', user, active: '/admin/settings', message,
    body: `${settingsTabs('/admin/settings/task-types')}
    <p class="lead">The kinds of work a VA picks when logging time (one list for the whole company, in this order). A hidden type can't be picked for new time; time already logged keeps it. A type that has time logged can't be deleted, only hidden.</p>
    ${section({ title: 'Task types', count: types.filter((t) => !t.hidden).length, open: true, key: 'task-types', body: types.length ? types.map(row).join('') : empty('No task types yet. Add one below.') })}
    <form method="post" action="/admin/settings/task-types" class="card"><input type="hidden" name="op" value="add">
      <div class="row"><div><label for="tt-name" style="margin-top:0">Add a task type</label><input type="text" id="tt-name" name="name" maxlength="60" required placeholder="For example: Reviews and reputation"></div>
      <div style="flex:0"><button class="sm">${icon('plus')} Add</button></div></div></form>
    ${section({ title: 'Recent changes', count: log.length, open: false, key: 'task-types-log', hint: 'The last 20 changes to task types.', body: logList(log) })}`,
  });
}

// ---- Settings > Pay periods ----

export function payPeriodsPage({ user, periods, today, log, message }) {
  const days = (p) => Math.round((Date.parse(p.end_date) - Date.parse(p.start_date)) / 86400000) + 1;
  const fields = (p, id) => `<div class="row">
    <div><label for="${id}-s">First day</label><input type="date" id="${id}-s" name="start_date" required value="${esc(p?.start_date || '')}"></div>
    <div><label for="${id}-e">Last day</label><input type="date" id="${id}-e" name="end_date" required value="${esc(p?.end_date || '')}"></div>
    <div><label for="${id}-p">Pay day</label><input type="date" id="${id}-p" name="pay_day" required value="${esc(p?.pay_day || '')}"></div></div>`;
  const row = (p) => {
    const now = p.start_date <= today && p.end_date >= today;
    return `<details class="item" id="pp-${p.id}"><summary class="item-head"><div class="grow">
        <div class="title">${esc(formatDate(p.start_date, false))} – ${esc(formatDate(p.end_date, true))}</div>
        <div class="sub">Pay day ${esc(formatDate(p.pay_day, true))} · ${days(p)} days</div></div>
        <span class="chips side-chips">${now ? chip('Now', 'good') : ''}${days(p) !== 14 ? chip(`${days(p)} days`, 'warn') : ''}</span>${icon('chevron', 'chev')}</summary>
      <div class="item-body" style="padding-left:12px">
        <form method="post" action="/admin/settings/pay-periods"><input type="hidden" name="op" value="edit"><input type="hidden" name="id" value="${p.id}">
          ${fields(p, `pp${p.id}`)}<button class="sm">Save</button></form>
        ${opForm('delete', p.id, '<button class="sm danger">Delete</button>', 'Delete this pay period?', '/admin/settings/pay-periods')}
      </div></details>`;
  };
  const years = [...new Set(periods.map((p) => p.end_date.slice(0, 4)))].sort().reverse();
  const thisYear = today.slice(0, 4);
  return layout({
    title: 'Pay periods', user, active: '/admin/settings', message,
    body: `${settingsTabs('/admin/settings/pay-periods')}
    <p class="lead">The pay periods used for VA time totals (copied from the "2026 Pay Periods" sheet). Click one to change or delete it. Periods can't overlap.</p>
    ${years.length ? years.map((y) => section({
      title: `Pay periods ending in ${y}`, count: periods.filter((p) => p.end_date.slice(0, 4) === y).length, open: y === thisYear, key: `pay-${y}`,
      body: periods.filter((p) => p.end_date.slice(0, 4) === y).map(row).join(''),
    })).join('') : section({ title: 'Pay periods', count: 0, body: empty('No pay periods yet. Add one below.') })}
    <form method="post" action="/admin/settings/pay-periods" class="card"><input type="hidden" name="op" value="add">
      <h2>Add a pay period</h2>${fields(null, 'pp-new')}<button class="sm">${icon('plus')} Add</button></form>
    ${section({ title: 'Recent changes', count: log.length, open: false, key: 'pay-periods-log', hint: 'The last 20 changes to pay periods.', body: logList(log) })}`,
  });
}
