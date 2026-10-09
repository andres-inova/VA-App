// The pages of the VA training program (see training.js).

import { esc } from './util.js';
import { formatDate } from './time.js';
import { layout, icon, avatar, chip, section, empty } from './views.js';

const KINDS = ['Onboarding Training', 'Back-Up', 'After-Hours'];
const STATUS_CHIP = { active: ['In progress', 'good'], paused: ['Paused', 'warn'], completed: ['Completed', 'info'], cancelled: ['Cancelled', 'muted'] };
const ITEM_CHIP = { not_started: ['Not yet', 'muted'], covered: ['Covered', 'good'], carried_over: ['Carried over', 'warn'] };
const signedOn = (iso) => (iso ? formatDate(iso.slice(0, 10)) : '');

const CSS = `<style>
.bar{height:10px;border-radius:99px;background:var(--muted-bg);overflow:hidden;margin:8px 0 4px}.bar>span{display:block;height:100%;background:var(--accent);border-radius:99px}
.day-tabs .chip.signed{background:var(--good-bg);color:var(--good)}.day-tabs .chip.on{background:var(--accent);color:#fff}
.how{margin:0;padding-left:20px}.how li{margin:4px 0}
.step{font-weight:800;color:var(--muted);min-width:1.6em}
.who-text{white-space:pre-line;margin:2px 0 8px}.who-label{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-top:10px}
.sign{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}.sign .meta{margin:0}
.item-form textarea{min-height:70px}.item-form .actions{margin-top:8px}
.edit-item .actions form{margin:0}
</style>`;

// Opens the section or item named in the address (after a save), so the person lands where they were.
const OPEN_HASH = `<script>(function(){var h=location.hash&&document.getElementById(location.hash.slice(1));
for(var e=h;e;e=e.parentElement){if(e.tagName==='DETAILS')e.open=true;}if(h)h.scrollIntoView({block:'center'});})();</script>`;

const statusChip = (t) => (t.late ? chip(`Late · workday ${t.workdays}`, 'bad') : chip(...STATUS_CHIP[t.status]));
const progressText = (sum) => `${sum.covered} of ${sum.total} items covered · ${sum.daysSigned} of DAYS days signed off`;

// A row that opens a training.
function trainingRow(t, days, line) {
  const sum = t.sum;
  return `<a class="item flat pick" href="/training/${t.id}"><div class="item-head">${avatar(t.trainee_name)}
    <div class="grow"><div class="title">${esc(t.trainee_name)}</div><div class="sub">${line}</div>
    ${sum ? `<div class="bar" title="${sum.covered} of ${sum.total} items covered"><span style="width:${sum.total ? Math.round(100 * sum.covered / sum.total) : 0}%"></span></div>` : ''}</div>
    <div class="chips">${sum ? chip(`Day ${sum.currentDay} of ${days}`, 'muted') : ''}${statusChip(t)}</div>${icon('chevron', 'chev')}</div></a>`;
}

const kindLine = (t) => `${esc(t.kind)} · trainer ${esc(t.trainer_name)} · started ${esc(formatDate(t.start_date))}`;
const finishedLine = (t) => `${esc(t.kind)} · trainer ${esc(t.trainer_name)} · ${t.status === 'completed' ? 'completed' : 'cancelled'} ${esc(signedOn(t.finished_at))}`;

// ---- "Training" for trainers and trainees ----

export function myTrainingsPage({ user, trainings, finished, dayCount, message }) {
  const asTrainer = trainings.filter((t) => t.trainer_id === user.id);
  const asTrainee = trainings.filter((t) => t.trainee_id === user.id);
  const rows = (list) => list.map((t) => trainingRow(t, dayCount, kindLine(t))).join('');
  return layout({
    title: user.in_training ? 'My training' : 'Training', user, active: '/training', message,
    body: `${CSS}
    ${asTrainee.length ? section({ title: 'My training', count: asTrainee.length, body: rows(asTrainee) }) : ''}
    ${asTrainer.length ? section({ title: 'People I am training', count: asTrainer.length, hint: 'Open a training to tick off each item as you cover it and to sign off each day.', body: rows(asTrainer) }) : ''}
    ${!trainings.length ? `<div class="card">${empty('You are not in a training right now.')}</div>` : ''}
    ${finished.length ? section({
      title: 'Finished', count: finished.length, open: false,
      body: finished.map((t) => trainingRow(t, 0, finishedLine(t))).join(''),
    }) : ''}`,
  });
}

// How sessions work, for the trainer or the trainee (admins see both).
function howItWorks(role) {
  const common = `<p class="meta">Each session, the trainer and the trainee work through the day's checklist items on purpose, in order. That is the main activity of the session.</p>
    <ul class="how">
      <li><b>Cover each item directly.</b> Don't wait for a topic to come up on its own.</li>
      <li><b>Real work comes first.</b> If a live call or task comes in, pause the training, handle it, then continue where you left off.</li>
      <li><b>Anything not covered is carried over</b> to the next day, and shows there until it is covered.</li>
    </ul>`;
  const trainer = `<p class="who-label">As the trainer</p><ul class="how">
      <li>Do not give the trainee login access or passwords to any client system during training.</li>
      <li>Share your screen so they can watch without controlling anything.</li>
      <li>Mark each item Covered (or Carry over) as you go, and add notes for anything special about the client.</li>
      <li>Sign off each day when you have worked through it, and log your training time under the “InoVA Local – Internal” project.</li></ul>`;
  const trainee = `<p class="who-label">As the trainee</p><ul class="how">
      <li>You won't get client logins or passwords during training. This is watching and asking questions only.</li>
      <li>Take notes on each item. You will need them for the final test.</li>
      <li>Say so if something wasn't clearly covered before you sign off a day.</li>
      <li>Sign off each day when you have worked through it, and log your training time under the “InoVA Local – Internal” project.</li></ul>`;
  return common + (role === 'trainer' ? trainer : role === 'trainee' ? trainee : trainer + trainee);
}

// The result of sending a login invite (same wording as on People).
function inviteBox(invite) {
  if (!invite) return '';
  const where = [invite.emailed && `email (${esc(invite.email)})`, invite.slacked && 'Slack'].filter(Boolean).join(' and ');
  return `<div class="toast ${where ? 'good' : 'bad'}" style="display:block">
    ${where ? `${icon('send')} Login invite sent to <strong>${esc(invite.name)}</strong> by ${where}.` : `The invite for <strong>${esc(invite.name)}</strong> could not be sent (see Settings, "Last email problem").`}<br>
    <span class="small">If they can't find it, their temporary password is <code style="font-size:15px">${esc(invite.password)}</code>. It is not shown again.</span></div>`;
}

const loginText = (p) => (!p.password_hash ? 'Not invited yet' : !p.must_change_password ? 'Has logged in'
  : p.invited_at ? `Invited ${formatDate(p.invited_at.slice(0, 10))}` : 'Temporary password');

// Admin controls on a training: pause or resume, complete, cancel, change the trainer, login invite.
function adminControls(t, sum, trainee, trainers, dayNumber) {
  const statusForm = (status, label, cls, confirm) => `<form method="post" action="/admin/training/${t.id}/status" ${confirm ? `data-confirm="${esc(confirm)}"` : ''}>
    <input type="hidden" name="status" value="${status}"><input type="hidden" name="day" value="${dayNumber}"><button class="sm ${cls}">${label}</button></form>`;
  const open = ['active', 'paused'].includes(t.status);
  const completeNote = t.kind === 'Onboarding Training' && !trainee.is_va
    ? ` ${t.trainee_name} will not be able to log in after this until they are an Active VA.` : '';
  return `<div class="actions">
    ${t.status === 'active' ? statusForm('paused', 'Pause', 'plain', `Pause this training? Nobody can tick items or sign off days until it is resumed.`) : ''}
    ${t.status === 'paused' ? statusForm('active', 'Resume', '', '') : ''}
    ${open ? statusForm('completed', `${icon('check')} Mark complete`, '', `Mark ${t.trainee_name}'s training complete?${sum.allSigned ? '' : ' Not every day is signed off yet.'}${completeNote}`) : ''}
    ${open ? statusForm('cancelled', 'Cancel training', 'danger', `Cancel ${t.trainee_name}'s training? Their ticks and notes are kept, but it can't be continued.${completeNote}`) : ''}
    ${!open ? statusForm('active', 'Reopen', 'plain', 'Reopen this training?') : ''}
  </div>
  ${open ? `<details class="list-opts"><summary>Change the trainer</summary>
    <form method="post" action="/admin/training/${t.id}/trainer" class="inline-add"><input type="hidden" name="day" value="${dayNumber}">
      <select name="trainer_id" aria-label="Trainer">${trainers.filter((p) => p.id !== t.trainee_id).map((p) => `<option value="${p.id}" ${p.id === t.trainer_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <button class="sm">Save</button></form></details>` : ''}
  <p class="meta" style="margin-top:12px">${esc(trainee.name)}'s login: <b>${esc(loginText(trainee))}</b> · ${esc(trainee.email)}</p>
  ${open ? `<form method="post" action="/admin/training/${t.id}/invite" data-confirm="${esc(`Send ${trainee.name} a login invite? It includes a new temporary password, so any current password stops working.`)}">
    <input type="hidden" name="day" value="${dayNumber}"><button class="sm plain" style="margin-top:4px">${icon('send')} ${trainee.password_hash && !trainee.must_change_password ? 'Send new login invite' : 'Send login invite'}</button></form>` : ''}`;
}

// One item of the checklist, as the trainer, trainee or an admin sees it.
function itemBlock(t, role, item, p, dayNumber, fromDay, number) {
  const status = p?.status || 'not_started';
  const editable = t.status === 'active';
  const head = `<span class="step">${fromDay ? `D${fromDay}` : `${number}.`}</span>
    <div class="grow"><div class="title">${esc(item.name)}</div><div class="sub">${esc(item.location)}${fromDay ? ` · carried over from Day ${fromDay}` : ''}</div></div>
    ${chip(...ITEM_CHIP[status])}`;
  const text = (label, value) => (value ? `<p class="who-label">${label}</p><p class="who-text">${esc(value)}</p>` : '');
  const note = (label, value) => (value ? `<p class="who-label">${label}</p><div class="bubble">${esc(value)}</div>` : '');
  let body = '';
  if (role === 'trainer') {
    body = `${text('What you do', item.trainer_text)}
      ${editable ? `<form method="post" action="/training/${t.id}/item/${item.id}" class="item-form"><input type="hidden" name="day" value="${dayNumber}">
        <label for="n${item.id}">Your notes (the trainee sees them)</label>
        <textarea id="n${item.id}" name="notes" maxlength="5000" placeholder="Anything special about this client, or what to remember">${esc(p?.trainer_notes || '')}</textarea>
        <div class="actions">
          <button name="status" value="covered" class="sm">${icon('check')} Covered</button>
          <button name="status" value="carried_over" class="sm plain">Carry over</button>
          ${status !== 'not_started' ? '<button name="status" value="not_started" class="sm plain">Not yet</button>' : ''}
          <button name="status" value="keep" class="sm plain">Save notes only</button>
        </div></form>` : note('Your notes', p?.trainer_notes)}`;
  } else if (role === 'trainee') {
    body = `${text('What you do', item.trainee_text)}${note(`${esc(t.trainer_name)}'s notes`, p?.trainer_notes)}
      ${editable ? `<form method="post" action="/training/${t.id}/item/${item.id}" class="item-form"><input type="hidden" name="day" value="${dayNumber}">
        <label for="n${item.id}">My notes (only you and admins see them)</label>
        <textarea id="n${item.id}" name="notes" maxlength="5000" placeholder="What you learned, and questions to ask">${esc(p?.trainee_notes || '')}</textarea>
        <div class="actions"><button class="sm">Save my notes</button></div></form>` : note('My notes', p?.trainee_notes)}`;
  } else {
    body = `${text('Trainer', item.trainer_text)}${text('Trainee', item.trainee_text)}
      ${note(`${esc(t.trainer_name)}'s notes`, p?.trainer_notes)}${note(`${esc(t.trainee_name)}'s notes`, p?.trainee_notes)}`;
  }
  return `<details class="item" id="item-${item.id}" ${status === 'covered' ? '' : 'open'}><summary class="item-head">${head}${icon('chevron', 'chev')}</summary>
    <div class="item-body" style="padding-left:12px">${body}</div></details>`;
}

// Who has signed off the day, and the button for this person.
function signoffCard(t, role, day, s, sum, days) {
  const parts = [
    `Trainer: <b>${s?.trainer_at ? `signed ${esc(signedOn(s.trainer_at))}` : 'not yet'}</b>`,
    `Trainee: <b>${s?.trainee_at ? `signed ${esc(signedOn(s.trainee_at))}` : 'not yet'}</b>`,
    s?.admin_at ? `<b>Signed off by an admin ${esc(signedOn(s.admin_at))}</b>` : '',
  ].filter(Boolean).map((x) => `<p class="meta">${x}</p>`).join('');
  const mine = role === 'trainer' ? s?.trainer_at : role === 'trainee' ? s?.trainee_at : null;
  const done = sum.signed(day);
  let button = '';
  if (t.status === 'active' && role !== 'admin' && !mine) {
    button = `<form method="post" action="/training/${t.id}/signoff" data-confirm="${esc(`Sign off Day ${day.day_number}? ${role === 'trainee' ? 'Please say so first if anything was not clearly covered.' : 'Items not covered stay on the next days.'}`)}">
      <input type="hidden" name="day_id" value="${day.id}"><input type="hidden" name="day" value="${day.day_number}"><button>${icon('check')} Sign off Day ${day.day_number}</button></form>`;
  } else if (t.status === 'active' && role === 'admin' && !done) {
    button = `<form method="post" action="/admin/training/${t.id}/signoff" data-confirm="${esc(`Sign off Day ${day.day_number} for both the trainer and the trainee?`)}">
      <input type="hidden" name="day_id" value="${day.id}"><input type="hidden" name="day" value="${day.day_number}"><button class="plain">Sign off this day for both</button></form>`;
  }
  const next = days.find((d) => d.day_number > day.day_number);
  const after = done && sum.allSigned
    ? `<p class="meta" style="color:var(--good)">${icon('check')} Every day is signed off.${role === 'admin' ? ' Use “Mark complete” at the top when the training is finished.' : ' An admin will mark the training complete.'}</p>`
    : done && next ? `<p class="meta"><a href="/training/${t.id}?day=${next.day_number}">Go to Day ${next.day_number} →</a></p>` : '';
  return `<div class="card"><h2>Day ${day.day_number} sign-off</h2><div class="sign">${parts}</div>${button}${after}</div>`;
}

export function trainingPage({ user, t, role, days, day, carried, progress, signoff, sum, trainee, message, invite = null, trainers = [] }) {
  const pct = sum.total ? Math.round(100 * sum.covered / sum.total) : 0;
  const tabs = days.map((d) => `<a class="chip ${d.id === day?.id ? 'on' : sum.signed(d) ? 'signed' : 'muted'}" href="/training/${t.id}?day=${d.day_number}">${sum.signed(d) ? '✓ ' : ''}Day ${d.day_number}</a>`).join('');
  const who = role === 'trainer' ? `You are training <b>${esc(t.trainee_name)}</b>.`
    : role === 'trainee' ? `Your trainer is <b>${esc(t.trainer_name)}</b>.`
    : `Trainer: <b>${esc(t.trainer_name)}</b>.`;
  const notActive = t.status === 'paused' ? 'This training is paused, so nothing can be changed until an admin resumes it.'
    : t.status !== 'active' ? `This training was ${t.status === 'completed' ? 'completed' : 'cancelled'}${t.finished_at ? ` on ${esc(signedOn(t.finished_at))}` : ''}. You can still read it.` : '';
  const items = day ? [...carried.map((i) => itemBlock(t, role, i, progress.get(i.id), day.day_number, i.fromDay)), ...day.items.map((i, n) => itemBlock(t, role, i, progress.get(i.id), day.day_number, 0, n + 1))] : [];
  return layout({
    title: role === 'trainee' ? 'My training' : `Training · ${t.trainee_name}`, user, active: role === 'admin' ? '/admin/training' : '/training', message,
    body: `${CSS}${inviteBox(invite)}
    ${role === 'admin' ? '<p class="lead"><a href="/admin/training">‹ All trainings</a></p>'
      : role === 'trainer' && !user.in_training ? '<p class="lead"><a href="/training">‹ My trainings</a></p>' : ''}
    <div class="card">
      <div class="rec-head">${avatar(t.trainee_name, 'lg')}<div class="grow"><h2>${esc(t.trainee_name)}</h2>
        <div class="chips">${chip(t.kind, 'info')}${statusChip(t)}</div></div></div>
      <p class="meta" style="margin-top:10px">${who} Started ${esc(formatDate(t.start_date, true))}${t.status === 'active' ? ` · workday ${t.workdays} (due within 7)` : ''}</p>
      <div class="bar" title="${pct}%"><span style="width:${pct}%"></span></div>
      <p class="small" style="margin:0">${esc(progressText(sum).replace('DAYS', days.length))}${sum.carried ? ` · ${sum.carried} carried over` : ''}</p>
      ${notActive ? `<p class="meta" style="color:var(--warn)">${notActive}</p>` : ''}
      ${role === 'admin' ? adminControls(t, sum, trainee, trainers, day?.day_number || '') : ''}
    </div>
    ${section({ title: 'How training works', open: false, body: `<div style="padding:0 8px 8px">${howItWorks(role)}</div>` })}
    ${days.length ? `<div class="chips proj-tabs day-tabs">${tabs}</div>
    ${section({
      title: `Day ${day.day_number}: ${day.title}`, count: day.items.length + carried.length,
      hint: carried.length ? `Items carried over from earlier days come first.` : '',
      body: items.join('') || empty('No items on this day.'),
    })}
    ${signoffCard(t, role, day, signoff, sum, days)}` : `<div class="card">${empty('The checklist is empty. An admin adds items on Training, “Edit the checklist”.')}</div>`}
    ${OPEN_HASH}`,
  });
}

// ---- Admin: the list of trainings and the "Start a training" form ----

export function adminTrainingPage({ user, open, finished, days, choices, today, message }) {
  const itemCount = days.reduce((n, d) => n + d.items.length, 0);
  const late = open.filter((t) => t.late).length;
  const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
  const startForm = `<form method="post" action="/admin/training/start" style="padding:0 8px 8px">
    <div class="row">
      <div><label for="tk">Type</label><select id="tk" name="kind">${KINDS.map((k) => option(k, k)).join('')}</select></div>
      <div><label for="ts">First day</label><input id="ts" name="start_date" type="date" value="${esc(today)}" required></div>
    </div>
    <p class="small">Onboarding Training is for new hires: until it is marked complete, they see only their training in the app. Back-Up and After-Hours are for current VAs.</p>
    <div class="row">
      <div><label for="tt">Trainee</label><select id="tt" name="trainee" required
        onchange="this.form.querySelector('[data-new]').hidden = this.value !== 'new'">
        <option value="">Choose who is being trained</option>
        ${choices.others.length ? `<optgroup label="On the VA list, no login yet">${choices.others.map((c) => option(`c:${c.zoho_id}`, `${c.name} (${c.status})`)).join('')}</optgroup>` : ''}
        <optgroup label="Current VAs">${choices.vas.map((u) => option(`u:${u.id}`, u.name)).join('')}</optgroup>
        <option value="new">Someone not listed…</option>
      </select></div>
      <div><label for="tr">Trainer</label><select id="tr" name="trainer_id" required>
        <option value="">Choose the trainer</option>
        <optgroup label="VAs">${choices.trainers.filter((u) => u.is_va).map((u) => option(u.id, u.name)).join('')}</optgroup>
        <optgroup label="Admins">${choices.trainers.filter((u) => !u.is_va).map((u) => option(u.id, u.name)).join('')}</optgroup>
      </select></div>
    </div>
    <div class="row" data-new hidden>
      <div><label for="nn">Their name</label><input id="nn" name="new_name" type="text" maxlength="200"></div>
      <div><label for="ne">Their email</label><input id="ne" name="new_email" type="email"></div>
    </div>
    <button>${icon('plus')} Start training</button>
    <p class="small">Next, send the trainee a login invite from the training's page.</p>
  </form>`;
  return layout({
    title: 'Training', user, active: '/admin/training', message,
    body: `${CSS}
    <div class="card" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
      <p class="lead" style="margin:0;flex:1;min-width:240px">A trainee shadows a current VA and works through the checklist: <b>${days.length} days, ${itemCount} items</b>.${late ? ` <b style="color:var(--bad)">${late} past 7 workdays.</b>` : ''}</p>
      <a class="btn plain" style="margin:0" href="/admin/training/checklist">${icon('edit')} Edit the checklist</a>
    </div>
    ${section({ title: 'Start a training', open: !open.length, key: 'start', body: startForm })}
    ${section({
      title: 'In progress', count: open.length, open: true, tone: late ? 'attention' : '',
      body: open.length ? open.map((t) => trainingRow(t, days.length, kindLine(t))).join('') : empty('No trainings right now.'),
    })}
    ${section({
      title: 'Finished', count: finished.length, open: false,
      body: finished.length ? finished.map((t) => trainingRow(t, days.length, finishedLine(t))).join('') : empty('None yet.'),
    })}`,
  });
}

// ---- Admin: the checklist editor ----

export function checklistPage({ user, days, used, message }) {
  const fields = (it = {}, idPrefix = 'x') => `<div class="row">
      <div><label for="${idPrefix}n">Item</label><input id="${idPrefix}n" name="name" type="text" maxlength="300" required value="${esc(it.name || '')}"></div>
      <div><label for="${idPrefix}l">Where (system or channel)</label><input id="${idPrefix}l" name="location" type="text" maxlength="200" value="${esc(it.location || '')}" placeholder="For example CRM"></div>
    </div>
    <label for="${idPrefix}a">What the trainer does</label><textarea id="${idPrefix}a" name="trainer_text" maxlength="5000">${esc(it.trainer_text || '')}</textarea>
    <label for="${idPrefix}b">What the trainee does</label><textarea id="${idPrefix}b" name="trainee_text" maxlength="5000">${esc(it.trainee_text || '')}</textarea>`;
  const itemEditor = (d, it, i) => `<details class="item edit-item" id="item-${it.id}" data-key="item-${it.id}"><summary class="item-head"><span class="step">${i + 1}.</span>
      <div class="grow"><div class="title">${esc(it.name)}</div><div class="sub">${esc(it.location)}</div></div>${icon('chevron', 'chev')}</summary>
    <div class="item-body" style="padding-left:12px">
      <form method="post" action="/admin/training/checklist/item/${it.id}">${fields(it, `i${it.id}`)}<button class="sm">Save</button></form>
      <div class="actions">
        <form method="post" action="/admin/training/checklist/item/${it.id}/up"><button class="sm plain" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑ Move up</button></form>
        <form method="post" action="/admin/training/checklist/item/${it.id}/down"><button class="sm plain" ${i === d.items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓ Move down</button></form>
        <form method="post" action="/admin/training/checklist/item/${it.id}/delete" data-confirm="${esc(`Delete “${it.name}”? Its ticks and notes in every training are deleted too.`)}"><button class="sm danger">${icon('trash')} Delete</button></form>
      </div></div></details>`;
  const daySection = (d) => section({
    title: `Day ${d.day_number}: ${d.title}`, count: d.items.length, open: false, key: `day-${d.id}`,
    body: `<form method="post" action="/admin/training/checklist/day/${d.id}" class="inline-add">
        <input name="title" type="text" maxlength="200" required value="${esc(d.title)}" aria-label="Name of Day ${d.day_number}"><button class="sm">Rename</button></form>
      ${d.items.map((it, i) => itemEditor(d, it, i)).join('') || empty('No items yet.')}
      <details class="item" data-key="add-${d.id}"><summary class="item-head">${icon('plus')}<div class="grow"><div class="title">Add an item to Day ${d.day_number}</div></div>${icon('chevron', 'chev')}</summary>
        <div class="item-body" style="padding-left:12px"><form method="post" action="/admin/training/checklist/item/add"><input type="hidden" name="day_id" value="${d.id}">
          ${fields({}, `a${d.id}`)}<button class="sm">${icon('plus')} Add item</button></form></div></details>
      ${d.items.length ? '' : `<form method="post" action="/admin/training/checklist/day/${d.id}/delete" data-confirm="${esc(`Remove Day ${d.day_number}? The days after it move up one number.`)}" style="padding:0 8px"><button class="sm danger">Remove this day</button></form>`}`,
  });
  return layout({
    title: 'Training checklist', user, active: '/admin/training', message,
    body: `${CSS}<p class="lead"><a href="/admin/training">‹ Training</a> · Every training uses this checklist. Changes show right away${used ? ', including in trainings already in progress' : ''}. Only admins can change it.</p>
    <div data-remember="training-checklist">
    ${days.map(daySection).join('')}
    ${section({
      title: 'Add a day', open: false, key: 'add-day',
      body: `<form method="post" action="/admin/training/checklist/day/add" class="inline-add"><input name="title" type="text" maxlength="200" required placeholder="For example: Client software deep dive" aria-label="Name of the new day"><button class="sm">${icon('plus')} Add day</button></form>`,
    })}
    </div>${OPEN_HASH}`,
  });
}
