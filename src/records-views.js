// The pages for clients, client contacts, VAs and applicants kept in the app (see records.js).

import { esc } from './util.js';
import { formatDate, REPORT_ZONE } from './time.js';
import { MODULES, allFields, plainValue, STEPS, CLOSED, OFFER_ITEMS, RESUME_INVITE, resumeScore, callScore } from './fields.js';
import { layout, icon, avatar, chip, section, empty, zohoTime, mailLink, phoneLink } from './views.js';

const TONE = { Current: 'good', Active: 'good', Paused: 'warn', 'On Deck': 'info', Offboarded: 'muted', 'n/a': 'muted', Hired: 'good', Declined: 'muted', Ghosted: 'muted' };
const tone = (status) => TONE[status] || (STEPS.includes(status) ? 'info' : 'muted');
const activeFor = (key) => (key === 'vas' ? '/admin/vas' : key === 'applicants' ? '/admin/applicants' : '/admin/clients');
const isEmpty = (v) => v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length);
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const when = (iso) => (iso ? zohoTime(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`) : '');
const linkTo = (key, id, name) => `<a href="/admin/${key}/${esc(id)}">${esc(name)}</a>`;

// A row on a list page that opens the record.
const recordRow = (key, r, sub, side = '') => `<a class="item flat pick" href="/admin/${key}/${esc(r.id)}"><div class="item-head">${avatar(r.name)}
  <div class="grow"><div class="title">${esc(r.name)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${side}${icon('chevron', 'chev')}</div></a>`;

// A line pointing to the copy from Zoho (on the list pages).
function importLine(state, count) {
  if (state?.status === 'running') return `<p class="meta">${icon('sync')} Copying from Zoho now… <a href="/admin/records/import">See progress</a></p>`;
  if (!count) return `<div class="card"><h2>Bring your records over from Zoho</h2>
    <p class="meta">Copy every client, contact and VA from Zoho CRM, with their notes and files. You can copy again later, until you stop using Zoho.</p>
    <a class="btn" href="/admin/records/import">${icon('sync')} Copy from Zoho</a></div>`;
  return '';
}

function listPage({ user, key, title, active, lead, records, statuses, rowOf, extraHead = '', imported, searchHint, message }) {
  const by = (s) => records.filter((r) => r.status === s);
  const others = records.filter((r) => !statuses.includes(r.status));
  const list = (label, rows, open) => (rows.length ? section({ title: label, count: rows.length, open, key: `${key}-${label}`, body: rows.map(rowOf).join('') }) : '');
  const closed = ['Offboarded', 'n/a'];
  return layout({
    title, user, active, message,
    body: `<p class="lead">${lead}</p>
    ${extraHead}${importLine(imported, records.length)}
    <div class="actions" style="margin:0 0 14px"><a class="btn sm" href="/admin/${key}/new">${icon('plus')} New ${MODULES[key].one}</a>
      <a class="btn sm plain" href="/admin/records/import">${icon('sync')} Copy from Zoho</a></div>
    ${records.length ? `<div class="summary-chips">${statuses.filter((s) => by(s).length).map((s) => chip(`${by(s).length} ${s === 'n/a' ? 'no status' : s.toLowerCase()}`, tone(s))).join('')}</div>
    <label class="search" for="find-${key}">${icon('building')}<input id="find-${key}" type="search" placeholder="${esc(searchHint)}" autocomplete="off" data-filter="#${key}-list .item" data-empty="#${key}-none"></label>
    <div id="${key}-list">${statuses.map((s) => list(s === 'n/a' ? 'No status' : s, by(s), !closed.includes(s))).join('')}${list('Other', others, false)}</div>
    <div class="empty no-results" id="${key}-none">Nothing matches.</div>` : ''}`,
  });
}

export function clientsPage({ user, records, names, projects, imported, message }) {
  return listPage({
    user, key: 'clients', title: 'Clients', active: '/admin/clients', imported, message, records,
    lead: 'Every client, with contacts, notes and files. Click a client to see or change it.',
    statuses: MODULES.clients.statuses, searchHint: 'Search clients, emails or places',
    rowOf: (r) => {
      const d = r.data;
      const vas = (projects.get(r.name.trim().toLowerCase()) || []).filter((p) => !p.is_coverage).map((p) => p.vas).filter(Boolean);
      const sub = [names.get(d.Contact), d.Package_Hours && `${d.Package_Hours} hours`, [d.Shift, d.Timezone].filter(Boolean).join(' '), vas.length && `VA: ${vas.join(', ')}`]
        .filter(Boolean).map(esc).join(' · ');
      return recordRow('clients', r, sub, chip(r.status, tone(r.status)));
    },
  });
}

export function vasPage({ user, records, source, imported, message }) {
  const note = source === 'app' ? '' : records.length
    ? `<div class="toast info" style="display:block">Check-ins and VA logins still use the VA details in Zoho CRM. When these records look right, <a href="/admin/records/import#switch">switch to the app</a>.</div>` : '';
  return listPage({
    user, key: 'vas', title: 'VAs', active: '/admin/vas', imported, message, records, extraHead: note,
    lead: 'Every VA, with contact details, pay notes, scores, notes and files. Click a VA to see or change them.',
    statuses: MODULES.vas.statuses, searchHint: 'Search VAs, emails or places',
    rowOf: (r) => {
      const d = r.data;
      const clients = [...new Set(r.projects.filter((p) => !p.is_coverage).map((p) => p.client))];
      const sub = [clients.length && clients.join(', '), d.Time_Zone, d.Availability].filter(Boolean).map(esc).join(' · ');
      return recordRow('vas', r, sub, chip(r.status === 'n/a' ? 'No status' : r.status, tone(r.status)));
    },
  });
}

// ---- One record ----

// A field value as HTML for the record page ('' when empty).
function valueHtml(x, v, names) {
  if (isEmpty(v) && x.type !== 'bool') return '';
  switch (x.type) {
    case 'bool': return v ? 'Yes' : '';
    case 'email': return mailLink(v);
    case 'phone': return phoneLink(v);
    case 'url': return `<a href="${esc(/^https?:\/\//i.test(v) ? v : `https://${v}`)}" target="_blank" rel="noopener">${esc(v)}</a>`;
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? esc(formatDate(v, true)) : esc(v);
    case 'money': return esc(plainValue(x, v));
    case 'multi': case 'tags': return `<span class="chips" style="margin:0">${v.map((t) => chip(t, 'muted')).join('')}</span>`;
    case 'lookup': return names.has(Number(v)) ? linkTo(x.to, v, names.get(Number(v))) : '';
    case 'lookups': return v.filter((id) => names.has(Number(id))).map((id) => linkTo(x.to, id, names.get(Number(id)))).join(', ');
    default: return esc(v);
  }
}

const fileLink = (key, recordId, f) => `/admin/${key}/${esc(recordId)}/files/${esc(f.id)}`;

function historyHtml(key, history, names) {
  const fields = new Map(allFields(key).map((x) => [x.key, x]));
  if (!history.length) return empty('No changes yet.');
  return history.map((h) => {
    const changes = h.changes ? JSON.parse(h.changes) : [];
    const lines = changes.map((c) => {
      const x = fields.get(c.f) || { label: c.f === '_client' ? 'Client' : c.f, type: c.f === '_client' ? 'lookup' : 'text' };
      const from = plainValue(x, c.from, names) || 'empty';
      const to = plainValue(x, c.to, names) || 'empty';
      const short = (t) => (t.length > 120 ? `${t.slice(0, 120)}…` : t);
      return `<li><b>${esc(x.label)}</b>: ${esc(short(from))} → ${esc(short(to))}</li>`;
    }).join('');
    return `<div class="item flat"><div class="item-head" style="align-items:flex-start">${avatar(h.user_name || 'Zoho')}<div class="grow">
      <div class="title">${esc(h.summary)}</div><div class="sub">${esc(h.user_name || 'Zoho copy')} · ${esc(when(h.at))}</div>
      ${lines ? `<ul class="changes">${lines}</ul>` : ''}</div></div></div>`;
  }).join('');
}

function notesHtml(key, record, notes, user) {
  const here = `/admin/${key}/${record.id}`;
  const add = `<form method="post" action="${here}/notes" class="note-add">
    <textarea name="body" placeholder="Write a note for the team…" required aria-label="New note"></textarea>
    <button class="sm">${icon('plus')} Add note</button></form>`;
  const list = notes.map((n) => {
    const mine = !n.user_id || n.user_id === user.id;
    const who = n.user_name || n.author || 'Someone';
    const edit = mine ? `<details class="list-opts"><summary>Edit or delete</summary>
      <form method="post" action="${here}/notes/${n.id}/save"><textarea name="body" required aria-label="Note">${esc(n.body)}</textarea>
        <div class="actions"><button class="sm">Save note</button></div></form>
      <form method="post" action="${here}/notes/${n.id}/delete" data-confirm="Delete this note?"><button class="sm danger">${icon('trash')} Delete note</button></form></details>` : '';
    return `<div class="note">${avatar(who)}<div class="grow"><div class="sub"><b>${esc(who)}</b> · ${esc(when(n.created_at))}${n.updated_at && n.updated_at !== n.created_at ? ' · edited' : ''}${n.zoho_id ? ' · from Zoho' : ''}</div>
      <div class="bubble">${esc(n.body)}</div>${edit}</div></div>`;
  }).join('');
  return add + (list || empty('No notes yet.'));
}

function filesHtml(key, record, files) {
  const here = `/admin/${key}/${record.id}`;
  const kinds = allFields(key).filter((x) => x.type === 'file');
  const label = (f) => kinds.find((k) => k.key === f.field)?.label || 'File';
  const upload = `<form method="post" action="${here}/files" enctype="multipart/form-data" class="file-add">
    <input type="file" name="file" required aria-label="File to add" accept="${Object.keys({ pdf: 1, doc: 1, docx: 1, odt: 1, rtf: 1, txt: 1, xls: 1, xlsx: 1, ods: 1, png: 1, jpg: 1, jpeg: 1 }).map((e) => `.${e}`).join(',')}">
    ${kinds.length ? `<select name="kind" aria-label="Kind of file"><option value="">Other file</option>${kinds.map((k) => `<option value="${esc(k.key)}">${esc(k.label)}</option>`).join('')}</select>` : ''}
    <button class="sm">${icon('upload')} Add file</button></form>
    <p class="small" style="margin:4px 8px 10px">PDF, Word, Excel, text or a picture, up to 15 MB.</p>`;
  const list = files.map((f) => `<div class="item flat"><div class="item-head"><span class="file-ic">${icon('doc')}</span>
    <div class="grow"><div class="title"><a href="${fileLink(key, record.id, f)}" target="_blank" rel="noopener">${esc(f.file_name)}</a></div>
      <div class="sub">${esc(label(f))} · ${esc(size(f.file_size))} · ${esc(f.user_name || f.uploader || 'Zoho')} · ${esc(when(f.uploaded_at))}</div></div>
    <form method="post" action="${here}/files/${f.id}/delete" data-confirm="Delete ${esc(f.file_name)}?"><button class="sm plain" aria-label="Delete ${esc(f.file_name)}">${icon('trash')}</button></form></div></div>`).join('');
  return upload + (list || empty('No files yet.'));
}

// ---- Hiring ----

const OFFER_GUIDE = 'https://docs.google.com/document/d/1DAm6UrIaYzIW_gSTnDst_Xc8CJq-Lzf1YJX-Gw9tHPY/edit';

// What to do at each hiring step (from the "Application Process" document).
const STEP_HELP = {
  'New application': `Screen the resume (for example with Claude) and fill in the resume score. ${RESUME_INVITE} or more: send a calendar invite for a screening call and move them on. Under ${RESUME_INVITE}: decline.`,
  'Screening call scheduled': 'After the call, fill in the screening call score. If it is a match, walk them through the next steps and the training program, then move them on. If not, decline them and send the "Post Interview Rejection" email.',
  'Screening call done': `Send the offer email with the W-9, the Subcontractor Agreement in SignNow, and the background check in Checkr (<a href="${OFFER_GUIDE}" target="_blank" rel="noopener">Sending Offer Letter and Running Background Check</a>). Then move them on.`,
  'Offer sent': 'Tick each item on the offer checklist below as it comes in. When everything is in, move them on.',
  'Training pending': 'Send the message that introduces the training program. Move them on when they start.',
  'In training': 'Move them on when they finish the training program.',
  'Training done': 'Follow up on any questions about the training. Move them on when you hire them.',
  Hired: 'Make their VA record. It starts as On Deck on the VAs page.',
  Ghosted: 'They stopped answering. Move them back to a step if they get in touch again.',
  Declined: 'Not hired. Move them back to a step if that changes.',
};

const scoreText = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)} / 10`;

// The resume and screening call scores as chips (for the list and the applicant page).
function scoreChips(d, status) {
  const out = [];
  const r = resumeScore(d);
  if (r) out.push(chip(`Resume ${scoreText(r.total)}`, r.total >= RESUME_INVITE ? 'good' : 'warn'));
  else if (status === 'New application') out.push(chip('Not screened yet', 'warn'));
  const c = callScore(d);
  if (c) out.push(chip(`Call ${scoreText(c.overall)}`, c.low.length ? 'bad' : 'good'));
  return out.join('');
}

// Lines under a score section: the total and what it means.
function scoreSummary(kind, d) {
  if (kind === 'resume') {
    const r = resumeScore(d);
    if (!r) return '';
    const verdict = r.missing ? `${r.missing} part${r.missing === 1 ? '' : 's'} not scored yet.`
      : r.total >= RESUME_INVITE ? 'Invite them to a screening call.' : `Under ${RESUME_INVITE}: decline.`;
    return `<p class="meta score-line"><b>Total: ${esc(scoreText(r.total))}</b> · ${esc(verdict)}</p>`;
  }
  const c = callScore(d);
  if (!c) return '';
  const notes = [];
  if (c.low.length) notes.push(`<span class="chip bad">Under 4 in ${esc(c.low.join(', '))}: should not be hired</span>`);
  if (c.missing.length) notes.push(`Still to score: ${esc(c.missing.join(', '))}.`);
  return `<p class="meta score-line"><b>Overall: ${esc(scoreText(c.overall))}</b> (the average times 2)${notes.length ? ` · ${notes.join(' ')}` : ''}</p>`;
}

// The hiring step card on an applicant's page: where they are, what to do, and the buttons to move them.
function hiringPanel(record, va) {
  const d = record.data;
  const here = `/admin/applicants/${record.id}`;
  const step = record.status;
  const i = STEPS.indexOf(step);
  const closed = CLOSED.includes(step);
  const next = i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null;
  const progress = STEPS.map((s, n) => chip(`${n < i || step === 'Hired' ? '✓ ' : ''}${s}`, s === step ? 'info' : n < i ? 'good' : 'muted')).join('');
  const move = (to, label, cls = '', confirm = '') => `<form method="post" action="${here}/step" ${confirm ? `data-confirm="${esc(confirm)}"` : ''}>
    <input type="hidden" name="to" value="${esc(to)}"><button class="sm ${cls}">${label}</button></form>`;
  const offerDone = OFFER_ITEMS.every(([k]) => d[k]);
  const warn = [];
  const c = callScore(d);
  if (c?.low.length && !closed && step !== 'Hired') warn.push(`<div class="toast bad" style="display:block">Under 4 in ${esc(c.low.join(', '))} on the screening call: the scoring rubric says not to hire.</div>`);
  if (step === 'Offer sent' && offerDone) warn.push('<div class="toast good" style="display:block">Everything on the offer checklist is in.</div>');
  const declined = step === 'Declined' && d.Declined_Reason ? `<p class="meta"><b>Why declined:</b> ${esc(d.Declined_Reason)}</p>` : '';
  const vaLine = va ? `<p class="meta">${icon('va')} VA record: <a href="/admin/vas/${esc(va.id)}">${esc(va.name)}</a> (${esc(va.status === 'n/a' ? 'no status' : va.status)})</p>` : '';

  const buttons = [];
  if (next) buttons.push(move(next, `${icon('check')} Move to ${esc(next)}`));
  if (step === 'Hired' && !va) {
    buttons.push(`<form method="post" action="${here}/hire" data-confirm="Make a VA record for ${esc(record.name)}? It starts as On Deck, with their contact details and resume.">
      <button class="sm">${icon('va')} Make VA record</button></form>`);
  }
  if (!closed && step !== 'Hired') {
    buttons.push(`<details class="list-opts inline-opts"><summary class="btn sm plain">Decline</summary>
      <form method="post" action="${here}/step"><input type="hidden" name="to" value="Declined">
        <label for="reason">Why? (optional)</label><input id="reason" type="text" name="reason" maxlength="500" placeholder="For example: resume score under 8">
        <div class="actions"><button class="sm danger">Decline ${esc(record.name)}</button></div></form></details>`);
    buttons.push(move('Ghosted', 'Ghosted', 'plain', `Mark ${record.name} as Ghosted (stopped answering)?`));
  }
  const others = [...STEPS, ...CLOSED].filter((s) => s !== step && s !== next);
  const other = `<details class="list-opts"><summary>${closed ? 'Move back to a step' : 'Move to a different step'}</summary>
    <form method="post" action="${here}/step" class="inline-form"><select name="to" aria-label="Hiring step">${others.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
      <button class="sm plain">Move</button></form></details>`;

  return `<div class="card" id="step"><h2>Hiring step: ${esc(step)}</h2>
    ${closed ? '' : `<div class="chips steps">${progress}</div><p class="meta step-count">Step ${i + 1} of ${STEPS.length}${next ? ` · next: ${esc(next)}` : ''}</p>`}
    ${declined}${warn.join('')}
    ${step === 'Hired' && va ? '' : `<p class="meta">${STEP_HELP[step] || ''}</p>`}${vaLine}
    ${scoreChips(d, step) ? `<div class="chips">${scoreChips(d, step)}</div>` : ''}
    <div class="actions">${buttons.join('')}</div>${other}</div>`;
}

// The offer checklist, ticked on the applicant's page.
function offerChecklist(record) {
  const d = record.data;
  const done = OFFER_ITEMS.filter(([k]) => d[k]).length;
  return section({
    title: 'Offer checklist', count: `${done} of ${OFFER_ITEMS.length}`, key: 'offer', open: record.status === 'Offer sent',
    hint: `From <a href="${OFFER_GUIDE}" target="_blank" rel="noopener">Sending Offer Letter and Running Background Check</a>.`,
    body: `<form method="post" action="/admin/applicants/${record.id}/checklist">
      ${OFFER_ITEMS.map(([k, label]) => `<label class="check"><input type="checkbox" name="${k}" value="1" ${d[k] ? 'checked' : ''}> ${esc(label)}</label>`).join('')}
      <div class="actions" style="margin-top:12px"><button class="sm">${icon('check')} Save checklist</button></div></form>`,
  });
}

export function recordPage({ user, key, record, names, notes, files, history, contacts, projects, parent, referredHere, login, va, source, zohoOrg, message }) {
  const d = record.data;
  const mod = MODULES[key];
  const here = `/admin/${key}/${record.id}`;
  const back = key === 'contacts'
    ? (parent ? [`/admin/clients/${parent.id}`, parent.name] : ['/admin/clients', 'All clients'])
    : [`/admin/${key}`, `All ${mod.label.toLowerCase()}`];
  const status = record.status === 'n/a' ? 'No status' : record.status;
  const contactLine = [d.Title && esc(d.Title), d.Email && mailLink(d.Email), d.Phone && phoneLink(d.Phone), d.Location && esc(d.Location)].filter(Boolean);
  const zohoUrl = record.zoho_id && zohoOrg ? `https://crm.zoho.com/crm/${esc(zohoOrg)}/tab/${mod.zohoTab}/${esc(record.zoho_id)}` : '';
  const head = `<div class="card">
    <div class="rec-head">${avatar(record.name, 'lg')}<div class="grow"><h2>${esc(record.name)}</h2>
      <div class="chips">${key === 'contacts' ? (parent ? chip(`Contact at ${parent.name}`, 'info') : chip('No client', 'warn')) : ''}${chip(status, tone(record.status))}</div></div></div>
    ${contactLine.length ? `<p class="meta">${contactLine.join(' · ')}</p>` : ''}
    <div class="actions rec-actions">
      <a class="btn sm" href="${here}/edit">${icon('edit')} Edit</a>
      ${key === 'clients' ? `<a class="btn sm plain" href="/admin/contacts/new?client=${record.id}">${icon('plus')} Add contact</a>` : ''}
      <a class="btn sm plain" href="#notes">${icon('note')} Notes · ${notes.length}</a>
      <a class="btn sm plain" href="#files">${icon('doc')} Files · ${files.length}</a>
      ${zohoUrl ? `<a class="btn sm plain" href="${zohoUrl}" target="_blank" rel="noopener">${icon('external')} Open in Zoho</a>` : ''}
    </div></div>`;

  let related = '';
  if (key === 'clients') {
    related += section({
      title: 'Contacts', count: contacts.length, key: 'contacts',
      body: (contacts.length ? contacts.map((c) => recordRow('contacts', c, [c.data.Title, c.data.Email, c.data.Phone].filter(Boolean).map(esc).join(' · '),
        `${c.id === Number(d.Contact) ? chip('Main contact', 'info') : ''}${c.status === 'Offboarded' ? chip('Offboarded', 'muted') : ''}`)).join('') : empty('No contacts yet.'))
        + `<div class="actions" style="margin:6px 8px"><a class="btn sm plain" href="/admin/contacts/new?client=${record.id}">${icon('plus')} Add contact</a></div>`,
    });
    related += section({
      title: 'VAs and projects', count: projects.length, key: 'projects', hint: 'Active projects in Zoho Projects named after this client.',
      body: projects.length ? projects.map((p) => `<div class="item flat"><div class="item-head">${avatar(p.vas || '?')}
        <div class="grow"><div class="title">${esc(p.vas || 'No VA')}</div><div class="sub">${esc(p.name)}</div></div>
        ${p.is_coverage ? chip('Coverage', 'info') : `<a class="btn sm plain" href="/sops/${esc(encodeURIComponent(p.id))}">${icon('doc')} SOP</a>`}</div></div>`).join('')
        : empty("No active project has this client's name."),
    });
  }
  if (key === 'vas') {
    const u = login?.user;
    const access = source !== 'app'
      ? 'Check-ins and logins still use Zoho CRM. Changes here take effect after you switch to the app (Copy from Zoho page).'
      : u?.is_va ? `Can log in to this app as ${esc(u.email)}.${u.has_password ? '' : ' Has not set a password yet.'}`
        : record.status === 'Active' ? 'Active, but has no email, so cannot log in.' : 'Not Active, so cannot log in to this app.';
    related += section({
      title: 'Clients and projects', count: login?.projects.length || 0, key: 'projects',
      hint: `${access}${u ? ' <a href="/admin/people">People page</a>' : ''}`,
      body: login?.projects.length ? login.projects.map((p) => `<div class="item flat"><div class="item-head">${avatar(p.client)}
        <div class="grow"><div class="title">${esc(p.client)}</div><div class="sub">${esc(p.name)}</div></div>
        ${p.is_coverage ? chip('Coverage', 'info') : `<a class="btn sm plain" href="/sops/${esc(encodeURIComponent(p.id))}">${icon('doc')} SOP</a>`}</div></div>`).join('')
        : empty('No active projects.'),
    });
  }

  if (key === 'applicants') related += hiringPanel(record, va);

  let hidden = 0;
  const filesBy = (fieldKey) => files.filter((f) => f.field === fieldKey);
  const sections = mod.sections.map((s) => {
    if (key === 'applicants' && s.title === 'Offer checklist') return offerChecklist(record);
    const rows = s.fields.map((x) => {
      let html;
      if (x.type === 'file') html = filesBy(x.key).map((f) => `<a href="${fileLink(key, record.id, f)}" target="_blank" rel="noopener">${icon('doc')} ${esc(f.file_name)}</a>`).join('<br>');
      else html = valueHtml(x, d[x.key], names);
      if (!html) { hidden++; return ''; }
      return `<div class="${x.type === 'textarea' ? 'wide' : ''}"><dt>${esc(x.label)}</dt><dd>${html}</dd></div>`;
    });
    const reverse = s.fields.find((x) => x.reverse);
    if (reverse && referredHere.length) rows.push(`<div><dt>${esc(reverse.reverse)}</dt><dd>${referredHere.map((r) => linkTo(key, r.id, r.name)).join(', ')}</dd></div>`);
    const shown = rows.filter(Boolean);
    if (s.score) {
      // Score sections always show, with a link to fill them in.
      const editLink = `<a class="btn sm plain" href="${here}/edit#edit-${esc(encodeURIComponent(s.title))}">${icon('edit')} ${shown.length ? 'Change the scores' : 'Fill in the scores'}</a>`;
      return section({ title: s.title, count: shown.length || undefined, key: `sec-${s.title}`,
        body: `${scoreSummary(s.score, d) || '<p class="meta">Not scored yet.</p>'}${shown.length ? `<dl class="fields">${shown.join('')}</dl>` : ''}<div class="actions">${editLink}</div>` });
    }
    return shown.length ? section({ title: s.title, count: shown.length, key: `sec-${s.title}`, body: `<dl class="fields">${shown.join('')}</dl>` }) : '';
  }).join('');
  const extra = d._extra ? section({
    title: 'Other fields from Zoho', count: Object.keys(d._extra).length, open: false, key: 'extra',
    hint: 'Fields that were filled in Zoho but have no place in the app. Kept here so nothing is lost.',
    body: `<dl class="fields">${Object.entries(d._extra).map(([k, v]) => `<div><dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`,
  }) : '';

  return layout({
    title: record.name, user, active: activeFor(key), message,
    body: `<div class="chips proj-tabs"><a class="chip muted" href="${esc(back[0])}">‹ ${esc(back[1])}</a></div>
    ${head}${related}
    ${sections || `<div class="card">${empty('No details yet. Click Edit to add them.')}</div>`}
    ${hidden ? `<p class="meta">${hidden} empty field${hidden === 1 ? ' is' : 's are'} not shown. Click Edit to fill ${hidden === 1 ? 'it' : 'them'} in.</p>` : ''}
    ${extra}
    ${section({ title: 'Notes', count: notes.length, key: 'notes', body: notesHtml(key, record, notes, user) })}
    ${section({ title: 'Files', count: files.length, key: 'files', body: filesHtml(key, record, files) })}
    ${section({ title: 'History', count: history.length, open: false, key: 'history', hint: 'Who changed what, newest first.', body: historyHtml(key, history, names) })}`,
  });
}

// ---- The edit form ----

function input(x, v, choices, owners) {
  const id = `f-${x.key}`;
  const name = esc(x.key);
  const hint = x.hint ? `<div class="small">${esc(x.hint)}</div>` : '';
  const lbl = `<label for="${id}">${esc(x.label)}${x.required ? ' *' : ''}</label>`;
  const opts = (list, current) => {
    const all = current && !list.includes(current) ? [...list, current] : list;
    return `<option value="">—</option>${all.map((o) => `<option value="${esc(o)}" ${o === current ? 'selected' : ''}>${esc(o)}</option>`).join('')}`;
  };
  switch (x.type) {
    case 'textarea': return `<div class="wide">${lbl}<textarea id="${id}" name="${name}">${esc(v || '')}</textarea>${hint}</div>`;
    case 'bool': return `<div><label class="check" style="margin-top:34px"><input type="checkbox" name="${name}" value="1" ${v ? 'checked' : ''}> ${esc(x.label)}</label>${hint}</div>`;
    case 'int': case 'num': {
      const range = `${x.min !== undefined ? ` min="${x.min}"` : ''}${x.max !== undefined ? ` max="${x.max}"` : ''}`;
      return `<div>${lbl}<input id="${id}" type="number" step="${x.step || (x.type === 'int' ? 1 : 'any')}"${range} name="${name}" value="${esc(v ?? '')}">${hint}</div>`;
    }
    case 'money': return `<div>${lbl}<input id="${id}" type="number" step="0.01" min="0" name="${name}" value="${esc(v ?? '')}">${hint}</div>`;
    case 'date': return `<div>${lbl}<input id="${id}" type="date" name="${name}" value="${esc(v || '')}">${hint}</div>`;
    case 'email': return `<div>${lbl}<input id="${id}" type="email" name="${name}" value="${esc(v || '')}" autocomplete="off">${hint}</div>`;
    case 'phone': return `<div>${lbl}<input id="${id}" type="text" inputmode="tel" name="${name}" value="${esc(v || '')}">${hint}</div>`;
    case 'pick': return `<div>${lbl}<select id="${id}" name="${name}">${opts(x.options, v)}</select>${hint}</div>`;
    case 'owner': return `<div>${lbl}<select id="${id}" name="${name}">${opts(owners, v)}</select>${hint}</div>`;
    case 'tags': return `<div>${lbl}<input id="${id}" type="text" name="${name}" value="${esc((v || []).join(', '))}" placeholder="Separate tags with commas">${hint}</div>`;
    case 'multi': {
      const all = [...x.options, ...(v || []).filter((o) => !x.options.includes(o))];
      return `<fieldset class="wide picks"><legend>${esc(x.label)}</legend>${all.map((o) =>
        `<label class="check"><input type="checkbox" name="${name}" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}${hint}</fieldset>`;
    }
    case 'lookup': {
      const rows = choices[x.key] || [];
      if (!rows.length) return `<div>${lbl}<p class="small" style="margin:8px 0">${x.key === 'Contact' ? 'Add contacts first (on the client page).' : 'Nothing to choose yet.'}</p></div>`;
      return `<div>${lbl}<select id="${id}" name="${name}"><option value="">—</option>${rows.map((r) => `<option value="${r.id}" ${r.id === Number(v) ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>${hint}</div>`;
    }
    case 'lookups': {
      const rows = choices[x.key] || [];
      const set = new Set((v || []).map(Number));
      return `<fieldset class="wide picks scroll"><legend>${esc(x.label)}</legend>${rows.map((r) =>
        `<label class="check"><input type="checkbox" name="${name}" value="${r.id}" ${set.has(r.id) ? 'checked' : ''}> ${esc(r.name)}</label>`).join('') || '<p class="small">Nothing to choose yet.</p>'}${hint}</fieldset>`;
    }
    default: return `<div>${lbl}<input id="${id}" type="text" name="${name}" value="${esc(v || '')}" ${x.required ? 'required' : ''}>${hint}</div>`;
  }
}

export function editPage({ user, key, record, choices, owners, clients, error, message }) {
  const mod = MODULES[key];
  const d = record.data || {};
  const isNew = !record.id;
  const action = isNew ? `/admin/${key}/new` : `/admin/${key}/${record.id}/edit`;
  const back = isNew ? (key === 'contacts' && record.parent_id ? `/admin/clients/${record.parent_id}` : key === 'contacts' ? '/admin/clients' : `/admin/${key}`) : `/admin/${key}/${record.id}`;
  const title = isNew ? `New ${mod.one}` : `Edit ${record.name}`;
  const clientPick = key === 'contacts' ? `<div class="card"><label for="f-parent" style="margin-top:0">Client</label>
    <select id="f-parent" name="parent_id"><option value="">No client</option>${clients.map((c) => `<option value="${c.id}" ${c.id === Number(record.parent_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : '';
  const sections = mod.sections.map((s, i) => {
    const fields = s.fields.filter((x) => x.type !== 'file');
    if (!fields.length) return '';
    const filled = fields.some((x) => !isEmpty(d[x.key]));
    return section({ title: s.title, key: `edit-${s.title}`, open: i === 0 || filled || Boolean(s.score), body: `<div class="form-grid">${fields.map((x) => input(x, d[x.key], choices, owners)).join('')}</div>` });
  }).join('');
  const deleteText = key === 'clients' ? 'Delete this client, with its contacts, notes and files? This cannot be undone.'
    : `Delete this ${mod.one}, with their notes and files? This cannot be undone.`;
  return layout({
    title, user, active: activeFor(key), message,
    body: `<div class="chips proj-tabs"><a class="chip muted" href="${esc(back)}">‹ Back without saving</a></div>
    ${error ? `<div class="toast bad" role="alert">${esc(error)}</div>` : ''}
    <form method="post" action="${action}" class="record-form">
      ${clientPick}${sections}
      <div class="save-bar"><button>${icon('check')} ${isNew ? `Add ${mod.one}` : 'Save changes'}</button><a class="btn plain" href="${esc(back)}">Cancel</a></div>
    </form>
    ${isNew ? '' : `<form method="post" action="/admin/${key}/${record.id}/delete" data-confirm="${esc(deleteText)}" style="margin-top:24px">
      <button class="danger sm">${icon('trash')} Delete ${mod.one}</button></form>`}`,
  });
}

// ---- Copy from Zoho, and the switch ----

export function importPage({ user, state, counts, source, message }) {
  const c = counts || {};
  const inApp = (c.clients || 0) + (c.contacts || 0) + (c.vas || 0);
  const s = state || {};
  const done = s.counts ? `${s.counts.clients} clients, ${s.counts.contacts} contacts and ${s.counts.vas} VAs, with ${s.counts.notes} new notes and ${s.counts.files} new files` : '';
  let status = '<p class="meta">Not copied yet.</p>';
  if (s.status === 'running') {
    const left = (s.queue || []).length;
    status = `<div class="toast info" style="display:block">${icon('sync')} Copying… ${esc(done)} so far, ${left} step${left === 1 ? '' : 's'} left.
      It continues on its own every minute, even if you close this page. This page updates every minute.</div>`;
  } else if (s.status === 'done') {
    status = `<p class="meta">Last copy finished ${esc(zohoTime(s.finished_at))} (started by ${esc(s.by || 'an admin')}): ${esc(done)}.</p>`;
  } else if (s.status === 'failed') {
    status = `<div class="toast bad" style="display:block">The copy stopped ${esc(zohoTime(s.finished_at))}: ${esc(done)} were copied before that.
      If the reason mentions a scope or permission, the Zoho key needs the permissions listed below.<br>
      <code style="white-space:pre-wrap;word-break:break-word">${esc(s.error || '')}</code></div>`;
  }
  const problems = s.problems?.length ? `<details class="list-opts"><summary>${s.problems.length} file${s.problems.length === 1 ? '' : 's'} could not be copied</summary>
    <ul class="changes">${s.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : '';
  const again = inApp ? 'Copying again replaces the details of every client, contact and VA that came from Zoho with what Zoho has now. Changes made in the app to those details are lost (notes, files and history added in the app stay). Continue?' : '';

  const switchCard = source === 'app'
    ? `<p class="meta"><b>The app's VA records are in use.</b> VA logins, check-ins and the backup lists follow the VA pages in this app. Changes in Zoho CRM are ignored.</p>
      <form method="post" action="/admin/records/switch" data-confirm="Go back to using the VA details in Zoho CRM? The next hourly sync copies them from Zoho again."><input type="hidden" name="to" value="zoho">
      <button class="sm plain">Go back to Zoho CRM</button></form>`
    : `<p class="meta"><b>Zoho CRM is still in use.</b> VA logins, check-ins and the backup lists are copied from Zoho CRM every hour. Changes to VAs in this app don't affect them yet.</p>
      <p class="meta">When the VA records here look right, switch. From then on, a VA's status, email, time zone, availability, Slack IDs and company affiliation come from this app, and changes take effect right away.</p>
      <form method="post" action="/admin/records/switch" data-confirm="Use the VA records in this app for logins, check-ins and backups from now on?"><input type="hidden" name="to" value="app">
      <button ${c.vas ? '' : 'disabled'}>${icon('check')} Use the app's VA records</button></form>`;

  return layout({
    title: 'Copy from Zoho', user, active: '/admin/clients', message,
    body: `<div class="chips proj-tabs"><a class="chip muted" href="/admin/clients">‹ Clients</a><a class="chip muted" href="/admin/vas">‹ VAs</a></div>
    <div data-autorefresh>
    <div class="card"><h2>1. Copy clients, contacts and VAs from Zoho CRM</h2>
      <p class="meta">Copies every client (Zoho Accounts), contact and VA, with their notes, attachments, resumes and contracts. Zoho is only read, never changed.</p>
      <p class="meta">In the app now: <b>${c.clients || 0}</b> clients, <b>${c.contacts || 0}</b> contacts, <b>${c.vas || 0}</b> VAs.</p>
      ${status}${problems}
      <form method="post" action="/admin/records/import" ${again ? `data-confirm="${esc(again)}"` : ''}>
        <button ${s.status === 'running' ? 'disabled' : ''}>${icon('sync')} ${inApp ? 'Copy again from Zoho' : 'Copy from Zoho'}</button></form>
    </div>
    <div class="card" id="switch"><h2>2. Use the app's VA records for check-ins</h2>${switchCard}</div>
    </div>
    <div class="card"><h2>Zoho key permissions</h2>
      <p class="meta">The copy needs the Zoho key to include: <code>ZohoCRM.modules.accounts.READ</code>, <code>ZohoCRM.modules.contacts.READ</code>,
      <code>ZohoCRM.modules.custom.READ</code>, <code>ZohoCRM.modules.notes.READ</code>, <code>ZohoCRM.modules.attachments.READ</code> and <code>ZohoCRM.files.READ</code>
      (see README, "3. Zoho key").</p></div>`,
  });
}

// ---- Hiring: the list of applicants, and the copy from Zoho ----

const appliedOn = (iso) => (iso ? new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`)
  .toLocaleDateString('en-US', { timeZone: REPORT_ZONE, month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function applicantsPage({ user, records, imported, message }) {
  const by = (s) => records.filter((r) => r.status === s);
  const others = records.filter((r) => !STEPS.includes(r.status) && !CLOSED.includes(r.status));
  const row = (r) => {
    const d = r.data;
    const sub = [d.Email, [d.Location, d.Time_zone].filter(Boolean).join(', '), `Applied ${appliedOn(r.created_at)}`].filter(Boolean).map(esc).join(' · ');
    return recordRow('applicants', r, sub, `<span class="chips side-chips">${scoreChips(d, r.status)}</span>`);
  };
  const list = (label, rows, open) => (rows.length ? section({ title: label, count: rows.length, open, key: `applicants-${label}`, body: rows.map(row).join('') }) : '');
  const open = records.filter((r) => STEPS.includes(r.status) && r.status !== 'Hired').length;
  let copy = '';
  if (imported?.status === 'running') copy = `<p class="meta">${icon('sync')} Copying applicants from Zoho now… <a href="/admin/applicants/import">See progress</a></p>`;
  else if (!records.length) {
    copy = `<div class="card"><h2>Bring your applicants over from Zoho</h2>
      <p class="meta">Copy every applicant from Zoho CRM except the Rejected ones, with their notes and resumes.</p>
      <a class="btn" href="/admin/applicants/import">${icon('sync')} Copy from Zoho</a></div>`;
  }
  return layout({
    title: 'Hiring', user, active: '/admin/applicants', message,
    body: `<p class="lead">Everyone who applied, by hiring step. Click an applicant to see their details, scores and notes, and to move them to the next step.</p>
    ${copy}
    <div class="actions" style="margin:0 0 14px"><a class="btn sm" href="/admin/applicants/new">${icon('plus')} New applicant</a>
      <a class="btn sm plain" href="/admin/applicants/import">${icon('sync')} Copy from Zoho</a></div>
    ${records.length ? `<div class="summary-chips">${chip(`${open} in progress`, 'info')}${chip(`${by('Hired').length} hired`, 'good')}${CLOSED.map((s) => chip(`${by(s).length} ${s.toLowerCase()}`, 'muted')).join('')}</div>
    <label class="search" for="find-applicants">${icon('applicant')}<input id="find-applicants" type="search" placeholder="Search applicants, emails or places" autocomplete="off" data-filter="#applicants-list .item" data-empty="#applicants-none"></label>
    <div id="applicants-list">${STEPS.map((s) => list(s, by(s), s !== 'Hired')).join('')}${CLOSED.map((s) => list(s, by(s), false)).join('')}${list('Other', others, false)}</div>
    <div class="empty no-results" id="applicants-none">Nothing matches.</div>` : ''}`,
  });
}

export function applicantImportPage({ user, state, count, message }) {
  const s = state || {};
  const done = s.counts ? `${s.counts.applicants} applicants, with ${s.counts.notes} new notes and ${s.counts.files} new files` : '';
  let status = '<p class="meta">Not copied yet.</p>';
  if (s.status === 'running') {
    const left = (s.queue || []).length;
    status = `<div class="toast info" style="display:block">${icon('sync')} Copying… ${esc(done)} so far, ${left} step${left === 1 ? '' : 's'} left.
      It continues on its own every minute, even if you close this page. This page updates every minute.</div>`;
  } else if (s.status === 'done') {
    status = `<p class="meta">Last copy finished ${esc(zohoTime(s.finished_at))} (started by ${esc(s.by || 'an admin')}): ${esc(done)}.</p>`;
  } else if (s.status === 'failed') {
    status = `<div class="toast bad" style="display:block">The copy stopped ${esc(zohoTime(s.finished_at))}: ${esc(done)} were copied before that.
      If the reason mentions a scope or permission, the Zoho key needs the permissions listed below.<br>
      <code style="white-space:pre-wrap;word-break:break-word">${esc(s.error || '')}</code></div>`;
  }
  const problems = s.problems?.length ? `<details class="list-opts"><summary>${s.problems.length} file${s.problems.length === 1 ? '' : 's'} could not be copied</summary>
    <ul class="changes">${s.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : '';
  const again = count ? 'Copying again replaces the details of every applicant that came from Zoho with what Zoho has now, including their hiring step. Scores, the offer checklist, notes, files and history added in the app stay. Continue?' : '';
  return layout({
    title: 'Copy applicants from Zoho', user, active: '/admin/applicants', message,
    body: `<div class="chips proj-tabs"><a class="chip muted" href="/admin/applicants">‹ Hiring</a></div>
    <div class="card" data-autorefresh><h2>Copy applicants from Zoho CRM</h2>
      <p class="meta">Copies every applicant in Zoho CRM except the Rejected ones, with their notes, attachments and resumes. Zoho is only read, never changed.</p>
      <p class="meta">Zoho's Applicant Status becomes a hiring step: "Video Interview Invite Sent" and "Ghosted by applicant" become Ghosted, the training modules become In training, and Hired/Archived becomes Hired.</p>
      <p class="meta">In the app now: <b>${count}</b> applicants.</p>
      ${status}${problems}
      <form method="post" action="/admin/applicants/import" ${again ? `data-confirm="${esc(again)}"` : ''}>
        <button ${s.status === 'running' ? 'disabled' : ''}>${icon('sync')} ${count ? 'Copy again from Zoho' : 'Copy from Zoho'}</button></form>
    </div>
    <div class="card"><h2>Zoho key permissions</h2>
      <p class="meta">The copy needs the Zoho key to include: <code>ZohoCRM.modules.custom.READ</code>, <code>ZohoCRM.modules.notes.READ</code>,
      <code>ZohoCRM.modules.attachments.READ</code> and <code>ZohoCRM.files.READ</code> (see README, "3. Zoho key").</p></div>`,
  });
}
