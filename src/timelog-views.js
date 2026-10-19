// The pages of timelog.js: the VA's Time page, "Start timer", "Save time", "Log time" and one time log.
// Phone first: big buttons, one main action per screen, short words.

import { esc } from './util.js';
import { layout, icon, chip, empty, section } from './views.js';
import { ZONES, formatDate, formatTimeIn, partsIn } from './time.js';
import { timeTabs } from './timehours-views.js';

const FILE_ACCEPT = '.pdf,.doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.ods,.png,.jpg,.jpeg';
const fileSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// 80 -> "1h 20m", 45 -> "45m", 120 -> "2h".
export const duration = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};
const projectName = (p) => `${p.client || p.name || 'Project'}${p.is_coverage ? ' (coverage)' : ''}`;
const typeName = (x) => x.type_name || x.task_name || 'General';

// What Zoho Projects had on a copied log (read-only). z = a time_log_zoho row, or none for logs made in the app.
export function zohoBox(z) {
  if (!z) return '';
  const row = (label, value) => (value && value !== '-' ? `<p class="small" style="margin:2px 0"><b>${esc(label)}:</b> ${esc(value)}</p>` : '');
  return `<div class="zoho-info"><p class="meta" style="margin:12px 0 4px"><b>From Zoho Projects</b></p>
    ${row('Task', z.task_name)}${row('Task list', z.task_list)}${row('Task ID', z.task_id)}${row('Project key', z.project_key)}${row('Billing', z.billing_type)}${row('Time of day', z.time_range)}${row('Added by', z.added_by)}</div>`;
}

// "Entered 2:14 PM CST by Ana Pérez" in the project's time zone (with the date when it is not the log's day).
export function stamp(log, zone) {
  const z = ZONES[zone] || ZONES.EST;
  const day = partsIn(z, new Date(log.entered_at)).date;
  const when = `${day === log.work_date ? '' : `${formatDate(day)}, `}${formatTimeIn(log.entered_at, z)} ${zone}`;
  return `Entered ${when} by ${log.entered_by_name || 'someone'}${log.edited_at ? ' · changed later' : ''}`;
}

const hoursBoxes = (minutes) => `<div class="hm">
    <div><label for="tl-h">Hours</label><input type="number" id="tl-h" name="hours" min="0" max="24" step="1" inputmode="numeric" value="${minutes ? Math.floor(minutes / 60) : ''}" placeholder="0"></div>
    <div><label for="tl-m">Minutes</label><input type="number" id="tl-m" name="minutes" min="0" max="59" step="1" inputmode="numeric" value="${minutes ? minutes % 60 : ''}" placeholder="0"></div>
  </div>`;
const typeSelect = (types, selected) => `<label for="tl-type">What did you work on?</label><select id="tl-type" name="task_type" required>
    <option value="">Choose…</option>${types.filter((t) => !t.hidden || t.id === selected).map((t) => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
const describe = (value) => `<label for="tl-desc">Description</label><textarea id="tl-desc" name="description" maxlength="5000" placeholder="What did you do?">${esc(value || '')}</textarea>`;
const fileBox = (left = 5) => (left > 0 ? `<label for="tl-files">Attachments (optional)</label><input type="file" id="tl-files" name="files" multiple accept="${FILE_ACCEPT}">
  <p class="small" style="margin:4px 0 0">Up to ${left} file${left === 1 ? '' : 's'}, 15 MB each: PDF, Word, Excel, text or a picture.</p>` : '');
const bad = (error) => (error ? `<div class="toast bad" role="alert">${esc(error)}</div>` : '');
const back = (projectId) => `<p style="margin:12px 0 0"><a href="/va/time${projectId ? `?project=${esc(encodeURIComponent(projectId))}` : ''}">&larr; Back to Time</a></p>`;

// A running timer or one waiting to be saved, as a card at the top of the Time page.
function timerCard(t) {
  const what = `<div class="tm-what"><b>${esc(projectName(t))}</b><span>${esc(typeName(t))}</span>${t.description ? `<span class="small">${esc(t.description)}</span>` : ''}</div>`;
  if (t.stopped_at) {
    const why = t.auto_stopped === 2 ? 'It stopped by itself at 11:59 PM (a timer can’t run past midnight).' : t.auto_stopped ? 'It stopped by itself after 8 hours.' : '';
    return `<div class="card tm-card stopped" id="timer-${t.id}">${what}
      <p class="meta" style="margin:6px 0 0"><b>Finish saving</b> · ${esc(duration(Math.max(1, Math.round((Date.parse(t.stopped_at) - Date.parse(t.started_at)) / 60000))))}${why ? ` · ${esc(why)}` : ''}</p>
      <a class="btn big-btn" href="/va/time/timer/${t.id}">${icon('check')} Finish saving</a></div>`;
  }
  return `<div class="card tm-card" id="timer-${t.id}"><div class="tm-row">${what}<div class="bigtime" data-since="${esc(t.started_at)}">0:00:00</div></div>
    <div class="tm-buttons">
      <form method="post" action="/va/time/timer/${t.id}/stop"><button class="big-btn">${icon('stop')} Stop</button></form>
      <form method="post" action="/va/time/timer/${t.id}/discard" data-confirm="Discard this timer? The time is not saved."><button class="danger sm">${icon('trash')} Discard</button></form>
    </div></div>`;
}

// A time log in a list: task type, description, time, files, stamp. Tapping it opens it.
function logRow(l, files, zone, editable) {
  return `<a class="item flat pick log-row" href="/va/time/entry/${l.id}"><div class="item-head"><div class="grow">
      <div class="title">${esc(l.type_name || 'General')}</div>
      ${l.description ? `<div class="sub log-desc">${esc(l.description)}</div>` : ''}
      ${(files || []).length ? `<div class="sub">${icon('doc')} ${files.length} file${files.length > 1 ? 's' : ''}</div>` : ''}
      <div class="stamp">${esc(stamp(l, zone))}</div></div>
      <span class="chip info tl-mins">${esc(duration(l.minutes))}</span>${editable ? icon('chevron', 'chev') : ''}</div></a>`;
}

export function timePage({ user, projects, project, timers, logs, files, coverageSop, message }) {
  const title = 'Time';
  const cards = timers.map(timerCard).join('');
  if (!project) {
    return layout({ title, user, active: '/va/time', message, body: `${timeTabs('/va/time')}${cards}<div class="card">${empty('You have no projects yet. An admin adds you to a project, and it shows up here.')}</div>` });
  }
  const runningIn = new Set(timers.filter((t) => !t.stopped_at).map((t) => String(t.project_id)));
  const switcher = `<nav class="pj-grid" aria-label="Projects">${projects.map((p) => `<a class="pj-btn ${p.id === project.id ? 'on' : ''}" href="/va/time?project=${esc(encodeURIComponent(p.id))}" ${p.id === project.id ? 'aria-current="page"' : ''}>
      <b>${esc(projectName(p))}</b><small>${esc(duration(p.todayMinutes || 0))} today</small>${runningIn.has(p.id) ? '<span class="dot" title="Timer running"></span>' : ''}</a>`).join('')}</nav>`;
  const canToday = !project.is_coverage || project.coveringToday;
  const coverageNote = project.is_coverage ? `<div class="card">${chip('Coverage', 'info')}
      <p class="meta" style="margin:8px 0 0">${canToday ? `Log the time you spend covering <b>${esc(project.client)}</b> here.` : `You are not covering <b>${esc(project.client)}</b> today. An admin allowed you to add time for other days.`}</p>
      ${coverageSop ? `<div class="actions">${coverageSop.has_content ? `<a class="btn sm" href="/sops/${esc(encodeURIComponent(coverageSop.id))}">${icon('doc')} Read the Coverage SOP</a>` : ''}
        ${coverageSop.file_key ? `<a class="btn sm plain" href="/sops/${esc(encodeURIComponent(coverageSop.id))}/file" target="_blank" rel="noopener">${icon('external')} Open the SOP file</a>` : ''}</div>` : ''}</div>` : '';
  const q = `project=${esc(encodeURIComponent(project.id))}`;
  const actions = `<div class="time-actions">
      ${canToday ? `<a class="btn big-btn" href="/va/time/start?${q}">${icon('play')} Start timer</a>` : ''}
      <a class="btn big-btn plain" href="/va/time/log?${q}">${icon('plus')} Log time</a></div>`;
  const today = logs.filter((l) => l.work_date === project.today);
  const total = today.reduce((s, l) => s + l.minutes, 0);
  const other = logs.filter((l) => l.work_date !== project.today);
  const otherDays = [...new Set(other.map((l) => l.work_date))];
  return layout({
    title, user, active: '/va/time', message,
    body: `${timeTabs('/va/time')}${cards}${switcher}${coverageNote}${actions}
    ${section({
      title: `Today · ${formatDate(project.today)}`, count: duration(total), key: 'today',
      body: today.map((l) => logRow(l, files.get(l.id), project.zone, true)).join('') || empty('No time logged here today yet.'),
    })}
    ${otherDays.map((d) => section({
      title: `${formatDate(d, true)} (allowed by an admin)`, count: duration(other.filter((l) => l.work_date === d).reduce((s, l) => s + l.minutes, 0)), key: `day-${d}`, open: false,
      body: other.filter((l) => l.work_date === d).map((l) => logRow(l, files.get(l.id), project.zone, true)).join(''),
    })).join('')}
    <p class="small">Times are in the project’s time zone (${esc(project.zone)}). Timers keep running when you close the app, and stop by themselves after 8 hours or at midnight. Your first timer of the day also checks you in.</p>`,
  });
}

// "Start timer": tap what you are working on (an optional description first).
export function startPage({ user, project, types, description = '', message }) {
  return layout({
    title: 'Start timer', user, active: '/va/time', message,
    body: `<div class="card"><p class="meta" style="margin:0">Project</p><h2 style="margin:0 0 8px">${esc(projectName(project))}</h2>
      <form method="post" action="/va/time/start"><input type="hidden" name="project" value="${esc(project.id)}">
        <label for="tl-desc">Description (optional)</label><input type="text" id="tl-desc" name="description" maxlength="5000" value="${esc(description)}" placeholder="You can add it later">
        <p class="meta" style="margin:16px 0 0"><b>What are you working on?</b> Tap one to start.</p>
        <div class="tt-list">${types.map((t) => `<button name="task_type" value="${t.id}">${icon('play')} ${esc(t.name)}</button>`).join('') || empty('No task types yet. Ask an admin.')}</div>
      </form>${back(project.id)}</div>`,
  });
}

// "Save time": the sheet after a timer stops.
export function savePage({ user, timer, zone, workDate, timerMinutes, types, error, values }) {
  const v = values || { description: timer.description || '', minutes: timerMinutes, task_type: timer.task_type_id };
  const z = ZONES[zone] || ZONES.EST;
  const why = timer.auto_stopped === 2 ? 'It stopped by itself at 11:59 PM, because a timer can’t run past midnight. If you kept working after midnight, use "Log time" for that.'
    : timer.auto_stopped ? 'It stopped by itself after 8 hours. If you stopped working earlier, lower the time below.' : '';
  return layout({
    title: 'Save time', user, active: '/va/time',
    body: `${bad(error)}<div class="card">
      <p class="meta" style="margin:0">${esc(projectName(timer))}</p>
      <h2 style="margin:0">${esc(duration(timerMinutes))}</h2>
      <p class="meta">${esc(formatDate(workDate))} · ${esc(formatTimeIn(timer.started_at, z))} – ${esc(formatTimeIn(timer.stopped_at, z))} ${esc(zone)}</p>
      ${why ? `<p class="small">${esc(why)}</p>` : ''}
      <form method="post" action="/va/time/timer/${timer.id}/save" enctype="multipart/form-data">
        ${typeSelect(types, v.task_type)}
        ${describe(v.description)}
        ${hoursBoxes(v.minutes)}
        ${fileBox()}
        <button class="big-btn">${icon('check')} Save</button>
      </form>
      <form method="post" action="/va/time/timer/${timer.id}/discard" data-confirm="Discard this timer? The time is not saved." style="margin-top:8px"><button class="danger sm">${icon('trash')} Discard</button></form>
      ${back(String(timer.project_id))}</div>`,
  });
}

// "Log time": time typed in by hand, for today (or a date an admin allowed).
export function logPage({ user, project, types, todayOk, error, values }) {
  const v = values || {};
  const dates = [...(todayOk ? [project.today] : []), ...project.allowed];
  const dateBox = dates.length > 1
    ? `<label for="tl-date">Day</label><select id="tl-date" name="date">${dates.map((d) => `<option value="${d}" ${d === (v.date || dates[0]) ? 'selected' : ''}>${d === project.today ? `Today, ${esc(formatDate(d))}` : esc(formatDate(d, true))}</option>`).join('')}</select>
      <p class="small" style="margin:4px 0 0">An admin allowed you to add time for the earlier days in this list.</p>`
    : `<input type="hidden" name="date" value="${esc(dates[0] || project.today)}"><p class="meta" style="margin:8px 0 0">For <b>${dates[0] === project.today ? `today, ${esc(formatDate(project.today))}` : esc(formatDate(dates[0], true))}</b> (${esc(project.zone)})</p>`;
  return layout({
    title: 'Log time', user, active: '/va/time',
    body: `${bad(error)}<div class="card"><p class="meta" style="margin:0">Project</p><h2 style="margin:0">${esc(projectName(project))}</h2>
      <form method="post" action="/va/time/log" enctype="multipart/form-data"><input type="hidden" name="project" value="${esc(project.id)}">
        ${dateBox}
        ${typeSelect(types, v.task_type)}
        ${describe(v.description)}
        ${hoursBoxes(v.minutes)}
        ${fileBox()}
        <button class="big-btn">${icon('check')} Save</button>
      </form>${back(project.id)}</div>`,
  });
}

const FIELD_WORDS = { task_type: 'Task type', description: 'Description', minutes: 'Time', file: 'File', deleted: 'Deleted' };
const changeValue = (c, v) => (v === null || v === undefined || v === '' ? '(empty)' : c.f === 'minutes' ? duration(v) : c.f === 'deleted' ? 'yes' : String(v));

// One time log: change or delete it while its day is still today (or an allowed date).
export function entryPage({ user, log, project, backTo = '', zone, types, files, editable, error, message, history, zoho = null }) {
  const historyList = history?.length ? section({
    title: 'Changes', count: history.length, open: false, key: 'changes',
    body: history.map((h) => {
      let changes = [];
      try { changes = JSON.parse(h.changes || '[]'); } catch { changes = []; }
      return `<div class="item flat"><div class="item-head"><div class="grow"><div class="title">${esc(h.summary)}</div>
        <div class="sub">${esc(h.user_name || 'Someone')} · ${esc(formatDate(partsIn(ZONES[zone] || ZONES.EST, new Date(h.at)).date))}, ${esc(formatTimeIn(h.at, ZONES[zone] || ZONES.EST))} ${esc(zone)}</div>
        ${changes.length ? `<ul class="changes">${changes.map((c) => `<li><b>${esc(FIELD_WORDS[c.f] || c.f)}</b>: ${esc(changeValue(c, c.from))} → ${esc(changeValue(c, c.to))}</li>`).join('')}</ul>` : ''}</div></div></div>`;
    }).join(''),
  }) : '';
  const fileList = files.map((f) => `<div class="tl-file"><a href="/time-files/${f.id}" target="_blank" rel="noopener">${icon('doc')} ${esc(f.file_name)}</a><span class="small">${esc(fileSize(f.file_size || 0))}</span>
      ${editable ? `<form method="post" action="/va/time/entry/${log.id}/file/${f.id}/delete" data-confirm="${esc(`Remove the file "${f.file_name}"?`)}"><button class="danger sm">Remove</button></form>` : ''}</div>`).join('');
  const head = `<p class="meta" style="margin:0">${esc(project ? projectName(project) : 'Project')} · ${esc(formatDate(log.work_date, true))}</p>
      <h2 style="margin:0">${esc(log.type_name || 'General')} · ${esc(duration(log.minutes))}</h2>
      <p class="stamp">${icon('lock')} ${esc(stamp(log, zone))}</p>`;
  const body = editable
    ? `${head}${zohoBox(zoho)}${fileList ? `<label>Attachments</label>${fileList}` : ''}
      <form method="post" action="/va/time/entry/${log.id}" enctype="multipart/form-data">
        ${typeSelect(types, log.task_type_id)}
        ${describe(log.description)}
        ${hoursBoxes(log.minutes)}
        ${fileBox(5 - files.length)}
        <button class="big-btn">${icon('check')} Save changes</button>
      </form>
      <form method="post" action="/va/time/entry/${log.id}/delete" data-confirm="Delete this time log?" style="margin-top:8px"><button class="danger sm">${icon('trash')} Delete</button></form>`
    : `${head}${log.description ? `<div class="bubble">${esc(log.description)}</div>` : ''}${zohoBox(zoho)}${fileList}
      <p class="small">This log can’t be changed any more: time can be changed only on the day it is for. Ask an admin if something is wrong.</p>`;
  return layout({
    title: 'Time log', user, active: '/va/time', message,
    body: `${bad(error)}<div class="card">${body}${backTo ? `<p style="margin:12px 0 0"><a href="${esc(backTo)}">&larr; Back to My hours</a></p>` : back(String(log.project_id))}</div>${historyList}`,
  });
}
