// The pages for clients, client contacts, VAs and applicants kept in the app (see records.js).

import { esc } from './util.js';
import { formatDate } from './time.js';
import { MODULES, allFields, plainValue, STEPS, CLOSED, OFFER_ITEMS, RESUME_INVITE, resumeScore, callScore } from './fields.js';
import { layout, icon, avatar, chip, section, empty, zohoTime, mailLink, phoneLink, loginResult, loginText, lastLoginText, loginButtons, checkedInfo } from './views.js';
import { applicantTrainingRows } from './training-views.js';
import { emailsSection } from './email-views.js';
import { tagChips, recordTagsRow, tagPicker, PICKER_SCRIPT } from './tags-views.js';
import { listHead, listTools, bulkBar, listFields, LIST_SCRIPT } from './lists-views.js';
import { cellValue } from './lists.js';
import { vaTimeBox } from './timeadmin-views.js';

const TONE = { Current: 'good', Active: 'good', Paused: 'warn', 'On Deck': 'info', Offboarded: 'muted', 'n/a': 'muted', Hired: 'good', Declined: 'muted', Ghosted: 'muted' };
const tone = (status) => TONE[status] || (STEPS.includes(status) ? 'info' : 'muted');
const activeFor = (key) => (key === 'vas' ? '/admin/vas' : key === 'applicants' ? '/admin/applicants' : key === 'contacts' ? '/admin/contacts' : '/admin/clients');
const isEmpty = (v) => v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length);
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const when = (iso) => (iso ? zohoTime(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`) : '');
// Note text with its web addresses made clickable.
const withLinks = (text) => esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:)'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
const linkTo = (key, id, name) => `<a href="/admin/${key}/${esc(id)}">${esc(name)}</a>`;

// A row on a list page that opens the record.
const recordRow = (key, r, sub, side = '') => `<a class="item flat pick" href="/admin/${key}/${esc(r.id)}"><div class="item-head">${avatar(r.name)}
  <div class="grow"><div class="title">${esc(r.name)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${side}${icon('chevron', 'chev')}</div></a>`;

// A column's value in a list row (see lists.js): status as a chip, tags as chips, a contact's client as a link.
function cellHtml(key, c, r) {
  if (c.key === '_tags') return r.tagList?.length ? `<span class="chips">${tagChips(r.tagList)}</span>` : '';
  if (c.key === '_scores') return `<span class="chips">${scoreChips(r.data, r.status)}</span>`;
  if (c.key === '_client') return r.parent_name ? `<a href="/admin/clients/${esc(r.parent_id)}">${esc(r.parent_name)}</a>` : '';
  if (c.key === '_created' || c.key === '_updated') { const v = cellValue(c, r); return v ? esc(formatDate(v, true).replace(/^\w+, /, '')) : ''; }
  if (c.key === MODULES[key].statusKey) return chip(r.status === 'n/a' ? 'No status' : r.status, tone(r.status));
  const v = cellValue(c, r);
  if (isEmpty(v)) return '';
  if (c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return esc(formatDate(v, true).replace(/^\w+, /, ''));
  const text = plainValue(c.x, v, c.names);
  return esc(text.length > 90 ? `${text.slice(0, 90)}…` : text);
}

// A row on a list page: a tick box (for the bar at the bottom), the record's name (a link over the whole row) and the
// chosen columns. data-tags is read by the tag filter (LIST_SCRIPT in lists-views.js).
const listRow = (key, r, cols) => `<div class="item flat sel-item lrow" data-tags="${esc((r.tagIds || []).join(','))}"><label class="sel"><input type="checkbox" class="sel-box" value="${esc(r.id)}" aria-label="Select ${esc(r.name)}"></label>
  <a class="lr-name" href="/admin/${key}/${esc(r.id)}">${avatar(r.name)}<span class="title">${esc(r.name)}</span></a>${cols.map((c, i) => `<div class="lr-cell${i < 2 ? ' lr-top' : ''}">${cellHtml(key, c, r)}</div>`).join('')}</div>`;

// A list page (Clients, Contacts, VAs, Hiring): records in groups (by status), with this admin's columns (click a
// heading to sort), a search box, the Filter box, Columns, Export CSV, the tag filter (when the records have tags),
// tick boxes and the bar for ticked records. groups: [label, rows, open]. Group counts are the records that match
// the filters (the page's script lowers them while the tag filter or the search box is used).
function listPage({ user, key, title, active, lead, records, groups, summary, searchHint, tags, tools, names, message, after = '' }) {
  const cols = tools.cols.map((c) => ({ ...c, names }));
  const sections = groups.filter(([, rows]) => rows.length).map(([label, rows, open]) =>
    section({ title: label, count: rows.length, open, key: `${key}-${label}`, body: rows.map((r) => listRow(key, r, cols)).join('') })).join('');
  const searchIcon = { clients: 'building', vas: 'va', contacts: 'people', applicants: 'applicant' }[key];
  return layout({
    title, user, active, message,
    body: `<p class="lead">${lead}</p>
    <div class="actions" style="margin:0 0 14px"><a class="btn sm" href="/admin/${key}/new">${icon('plus')} New ${MODULES[key].one}</a></div>
    ${tools.total ? `<div class="summary-chips">${summary}</div>
    <label class="search" for="find-${key}">${icon(searchIcon)}<input id="find-${key}" type="search" placeholder="${esc(searchHint)}" autocomplete="off" data-filter="#${key}-list .item" data-empty="#${key}-none"></label>
    ${listTools(key, tags, tools)}
    <div class="lwrap" style="--n:${cols.length}">${listHead(key, tools)}
    <div id="${key}-list" data-list data-search="find-${key}">${sections}</div></div>
    <div class="empty no-results" id="${key}-none"${records.length ? '' : ' style="display:block"'}>Nothing matches.</div>${bulkBar(key, tags)}${listFields(tools.fields)}<script>${LIST_SCRIPT}</script>` : ''}
    ${after}`,
  });
}

// Groups by status, in the module's order; records with another status last, under Other.
function statusGroups(records, statuses, closed = ['Offboarded', 'n/a']) {
  const by = (s) => records.filter((r) => r.status === s);
  return [...statuses.map((s) => [s === 'n/a' ? 'No status' : s, by(s), !closed.includes(s)]), ['Other', records.filter((r) => !statuses.includes(r.status)), false]];
}
const statusChips = (records, statuses) => statuses.map((s) => [s, records.filter((r) => r.status === s).length]).filter(([, n]) => n)
  .map(([s, n]) => chip(`${n} ${s === 'n/a' ? 'no status' : s.toLowerCase()}`, tone(s))).join('');

export function clientsPage({ user, records, names, tags, tools, message }) {
  const statuses = MODULES.clients.statuses;
  return listPage({
    user, key: 'clients', title: 'Clients', active: '/admin/clients', message, records, tags, tools, names,
    lead: 'Every client, with contacts, notes and files. Click a client to see or change it.',
    groups: statusGroups(records, statuses), summary: statusChips(records, statuses), searchHint: 'Search clients, emails or places',
  });
}

export function vasPage({ user, records, names, tags, tools, message }) {
  const statuses = MODULES.vas.statuses;
  return listPage({
    user, key: 'vas', title: 'VAs', active: '/admin/vas', message, records, tags, tools, names,
    lead: 'Every VA, with contact details, pay notes, scores, notes and files. Active VAs can log in and check in. Click a VA to see or change them; changes count right away.',
    groups: statusGroups(records, statuses), summary: statusChips(records, statuses), searchHint: 'Search VAs, emails or places',
  });
}

// Every contact, with their client. Contacts with no client come first.
export function contactsPage({ user, records, names, tools, message }) {
  const statuses = ['Current', 'Offboarded'];
  const noClient = records.filter((r) => !r.parent_name);
  const rest = records.filter((r) => r.parent_name);
  return listPage({
    user, key: 'contacts', title: 'Contacts', active: '/admin/contacts', message, records, tags: null, tools, names,
    lead: "Every client contact. Click a contact to see or change them, or their client's name to open the client.",
    groups: [['No client', noClient, true], ...statusGroups(rest, statuses)], summary: statusChips(records, statuses), searchHint: 'Search contacts or clients',
  });
}

// ---- One record ----

// A field value as HTML for the record page ('' when empty).
// A choice that is no longer on the field's list (removed on Settings > Fields, or an old value from Zoho).
const old = (x, v) => ((x.options || []).includes(v) ? '' : ' <span class="small">(old choice)</span>');

function valueHtml(x, v, names) {
  if (isEmpty(v) && x.type !== 'bool') return '';
  switch (x.type) {
    case 'bool': return v ? 'Yes' : '';
    case 'email': return mailLink(v);
    case 'phone': return phoneLink(v);
    case 'url': return `<a href="${esc(/^https?:\/\//i.test(v) ? v : `https://${v}`)}" target="_blank" rel="noopener">${esc(v)}</a>`;
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? esc(formatDate(v, true)) : esc(v);
    case 'money': return esc(plainValue(x, v));
    case 'pick': return esc(v) + old(x, v);
    case 'multi': return `<span class="chips" style="margin:0">${v.map((t) => chip(`${t}${(x.options || []).includes(t) ? '' : ' (old choice)'}`, 'muted')).join('')}</span>`;
    case 'tags': return `<span class="chips" style="margin:0">${v.map((t) => chip(t, 'muted')).join('')}</span>`;
    case 'lookup': return names.has(Number(v)) ? linkTo(x.to, v, names.get(Number(v))) : '';
    case 'lookups': return v.filter((id) => names.has(Number(id))).map((id) => linkTo(x.to, id, names.get(Number(id)))).join(', ');
    default: return esc(v);
  }
}

// For the record page's "change one field" answer (see saveOneField in records.js).
export const fieldValueHtml = (x, v, names) => valueHtml(x, v, names);
export const clientValueHtml = (id, names) => (id && names.has(Number(id)) ? linkTo('clients', id, names.get(Number(id))) : '');

// A field on the record page that an admin can change right there: click the value (or its pencil) to get the same
// input as on the Edit page, inside a <template> until then. Empty fields are hidden until "Show empty fields".
const editRow = (x, html, editor, wide = x.type === 'textarea') => `<div class="fe${wide ? ' wide' : ''}${html ? '' : ' fe-empty'}" data-fe="${esc(x.key)}"><dt>${esc(x.label)}</dt><dd><span class="fe-val">${html || '<span class="fe-none">—</span>'}</span><button type="button" class="fe-pen" aria-label="Change ${esc(x.label)}">${icon('edit')}</button></dd><template>${editor}</template></div>`;

// The script for changing one field on the record page: open the editor, save it (POST .../field, answered with the
// new value), then fetch the page again to bring the rest of it (name, Login box, hiring step, scores, history, values
// someone else changed) up to date.
const FIELD_SCRIPT = `(function () {
  var here = location.pathname.replace(/\\/+$/, '');
  try { if (localStorage.getItem('showEmptyFields') === '1') document.body.classList.add('show-empty'); } catch (e) {}
  function rowOf(f) { return document.querySelector('[data-fe="' + CSS.escape(f) + '"]'); }
  function firstInput(form) { return form.querySelector('input:not([type=hidden]),select,textarea'); }
  document.addEventListener('click', function (e) {
    if (e.target.closest('.fe-toggle')) {
      var on = !document.body.classList.contains('show-empty');
      document.body.classList.toggle('show-empty', on);
      try { localStorage.setItem('showEmptyFields', on ? '1' : ''); } catch (x) {}
      return;
    }
    var row = e.target.closest('[data-fe]');
    if (!row || row.classList.contains('fe-editing')) return;
    if (!e.target.closest('.fe-pen')) {
      // Links in a value (an email, a phone number, another record) still open; selecting text doesn't start editing.
      if (!e.target.closest('dd') || e.target.closest('a') || String(window.getSelection ? window.getSelection() : '')) return;
    }
    open(row);
  });
  function open(row) {
    document.querySelectorAll('.fe-editing').forEach(function (r) { if (!r.dataset.saving) close(r, false); });
    var form = document.createElement('form');
    form.className = 'fe-form'; form.noValidate = true;
    form.innerHTML = row.querySelector('template').innerHTML
      + '<div class="toast bad fe-error" role="alert" hidden></div>'
      + '<div class="actions"><button class="sm fe-save">Save</button><button type="button" class="sm plain fe-cancel">Cancel</button></div>';
    // One pick list or one tick box saves as soon as it is changed.
    var fields = form.querySelectorAll('input:not([type=hidden]),select,textarea');
    var auto = fields.length === 1 && (fields[0].tagName === 'SELECT' || fields[0].type === 'checkbox');
    if (auto) form.classList.add('fe-auto');
    row.querySelector('dd').hidden = true; row.classList.add('fe-editing'); row.appendChild(form);
    var input = firstInput(form);
    if (input) {
      input.focus();
      if (/^(text|email|number|search|tel|url)$/.test(input.type) && input.select) input.select();
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); e.stopPropagation(); save(row, form); });
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(row, true); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.tagName === 'TEXTAREA') { e.preventDefault(); save(row, form); }
    });
    form.querySelector('.fe-cancel').addEventListener('click', function () { close(row, true); });
    if (auto) {
      form.addEventListener('change', function () { save(row, form); });
      form.addEventListener('focusout', function () {
        setTimeout(function () {
          if (row.classList.contains('fe-editing') && !row.dataset.saving && !form.dataset.error && !form.contains(document.activeElement)) close(row, false);
        }, 200);
      });
    }
  }
  function close(row, focus) {
    var form = row.querySelector('.fe-form');
    if (form) form.remove();
    row.querySelector('dd').hidden = false; row.classList.remove('fe-editing');
    if (focus) row.querySelector('.fe-pen').focus();
  }
  function save(row, form) {
    if (row.dataset.saving) return;
    var body = new URLSearchParams(new FormData(form));
    body.append('_f', row.dataset.fe);
    var button = form.querySelector('.fe-save');
    row.dataset.saving = '1'; button.classList.add('busy');
    fetch(here + '/field', { method: 'POST', body: body, credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        return /json/.test(r.headers.get('Content-Type') || '') ? r.json() : { error: 'Not saved. Please reload the page (you may need to log in again).' };
      })
      .catch(function () { return { error: 'Not saved: the app could not be reached. Please try again.' }; })
      .then(function (res) {
        delete row.dataset.saving; button.classList.remove('busy');
        if (res.error) {
          var box = form.querySelector('.fe-error');
          box.textContent = res.error; box.hidden = false; form.dataset.error = '1';
          var input = firstInput(form);
          if (input) input.focus();
          return;
        }
        row.querySelector('.fe-val').innerHTML = res.html || '<span class="fe-none">—</span>';
        row.classList.toggle('fe-empty', !res.html);
        close(row, true);
        flash(row.dataset.fe);
        if (res.note) note(res.note);
        refresh(row.dataset.fe);
      });
  }
  function flash(f) {
    var row = rowOf(f);
    if (!row) return;
    row.querySelectorAll('.fe-saved').forEach(function (s) { s.remove(); });
    var s = document.createElement('span');
    s.className = 'chip good fe-saved'; s.setAttribute('role', 'status'); s.textContent = 'Saved';
    row.querySelector('dt').appendChild(s);
    setTimeout(function () { s.remove(); }, 2500);
  }
  function note(n) {
    var t = document.createElement('div');
    t.className = 'toast ' + n[0]; t.setAttribute('role', 'status'); t.textContent = n[1];
    var head = document.getElementById('rec-head');
    head.parentNode.insertBefore(t, head);
    setTimeout(function () { t.classList.add('hide'); }, 8000);
  }
  // The parts of the page that can change after a save. Parts with an open editor, or where someone is typing,
  // stay as they are.
  function refresh(f) {
    fetch(here, { credentials: 'same-origin' }).then(function (r) { return r.ok && !r.redirected ? r.text() : null; }).then(function (html) {
      if (!html) return;
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var ids = ['rec-head', 'login', 'step', 'training', 'history', 'rec-hidden', 'rec-nothing'];
      if (ids.some(function (id) { return !document.getElementById(id) !== !doc.getElementById(id); })) {
        location.replace(here + '?msg=saved');
        return;
      }
      doc.querySelectorAll('#rec-fields > [id]').forEach(function (el) { if (el.id !== 'offer') ids.push(el.id); });
      var active = document.activeElement;
      var typing = active && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
      var pen = active && active.classList.contains('fe-pen') ? active.closest('[data-fe]').dataset.fe : null;
      ids.forEach(function (id) {
        var now = document.getElementById(id), fresh = doc.getElementById(id);
        if (!now || !fresh || now.querySelector('.fe-editing') || (typing && now.contains(active))) return;
        if (now.tagName === 'DETAILS') fresh.open = now.open;
        now.replaceWith(fresh);
      });
      if (pen && rowOf(pen)) rowOf(pen).querySelector('.fe-pen').focus();
      flash(f);
    }).catch(function () {});
  }
})();`;

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
    return `<div class="item flat"><div class="item-head" style="align-items:flex-start">${avatar(h.user_name || 'Automatic')}<div class="grow">
      <div class="title">${esc(h.summary)}</div><div class="sub">${esc(h.user_name || 'Automatic')} · ${esc(when(h.at))}</div>
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
      <div class="bubble">${withLinks(n.body)}</div>${edit}</div></div>`;
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
      <div class="sub">${esc(label(f))} · ${esc(size(f.file_size))} · ${esc(f.user_name || f.uploader || 'Automatic')} · ${esc(when(f.uploaded_at))}</div></div>
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
  'Training pending': 'Send the message that introduces the training program. When they start, press <b>Start training</b> below: it starts their Onboarding Training and moves them to In training.',
  'In training': 'When their training (below) is marked complete on its page, they move to Training done. If they are training outside the app, move them on when they finish.',
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

// Hiring steps where "Start training" shows (when no training is in progress for the applicant).
const TRAINING_STEPS = ['Offer sent', 'Training pending', 'In training'];

// The applicant's trainings (started from this page) and the "Start training" form.
function trainingCard(record, training) {
  if (!training) return '';
  const { trainings, dayCount, trainers, today } = training;
  const running = trainings.some((t) => ['active', 'paused'].includes(t.status));
  const canStart = !running && TRAINING_STEPS.includes(record.status);
  if (!trainings.length && !canStart) return '';
  const email = (record.email || '').trim();
  let start = '';
  if (canStart && !email) {
    start = `<p class="meta" style="padding:0 8px">To start their training, first add ${esc(record.name)}'s email with <a href="/admin/applicants/${record.id}/edit">Edit</a>. They log in to the training with it.</p>`;
  } else if (canStart) {
    const option = (u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`;
    const pickable = trainers.filter((u) => u.email !== email.toLowerCase());
    const moves = ['Offer sent', 'Training pending'].includes(record.status) ? ' and moves them to In training' : '';
    start = `<form method="post" action="/admin/training/start" style="padding:0 8px 8px"><input type="hidden" name="applicant_id" value="${record.id}">
      <p class="meta">Starts an <b>Onboarding Training</b> for ${esc(record.name)} (${esc(email)})${moves}. When it is marked complete, they move to Training done.</p>
      <div class="row">
        <div><label for="tr">Trainer</label><select id="tr" name="trainer_id" required><option value="">Choose the trainer</option>
          <optgroup label="VAs">${pickable.filter((u) => u.is_va).map(option).join('')}</optgroup>
          <optgroup label="Admins">${pickable.filter((u) => !u.is_va).map(option).join('')}</optgroup></select></div>
        <div><label for="ts">First day</label><input id="ts" name="start_date" type="date" value="${esc(today)}" required></div>
      </div>
      <button>${icon('training')} Start training</button>
      <p class="small">Next, send them a login invite from the training's page.</p></form>`;
  }
  return section({
    title: 'Training', count: trainings.length || undefined, key: 'training',
    hint: trainings.length ? 'Started from this page. Open one to see the checklist and sign-offs.' : '',
    body: `${trainings.length ? applicantTrainingRows(trainings, dayCount) : ''}${start}`,
  });
}

// The offer checklist, ticked on the applicant's page.
function offerChecklist(record, s) {
  const d = record.data;
  const done = OFFER_ITEMS.filter(([k]) => d[k]).length;
  const labels = new Map(s.fields.map((x) => [x.key, x.label]));
  return section({
    title: s.title, count: `${done} of ${OFFER_ITEMS.length}`, key: 'offer', open: record.status === 'Offer sent',
    hint: `From <a href="${OFFER_GUIDE}" target="_blank" rel="noopener">Sending Offer Letter and Running Background Check</a>.`,
    body: `<form method="post" action="/admin/applicants/${record.id}/checklist">
      ${OFFER_ITEMS.map(([k, label]) => `<label class="check"><input type="checkbox" name="${k}" value="1" ${d[k] ? 'checked' : ''}> ${esc(labels.get(k) || label)}</label>`).join('')}
      <div class="actions" style="margin-top:12px"><button class="sm">${icon('check')} Save checklist</button></div></form>`,
  });
}

// The Login box on a VA's page: their login (users row linked to this record), whether they can log in and are
// checked, and the same login buttons as on the People page.
function loginBox(record, login) {
  const u = login?.user;
  const active = record.status === 'Active';
  const email = record.data.Email;
  const warn = (text) => `<div class="toast bad" style="display:block">${text}</div>`;
  let body;
  if (!u) {
    body = active && !email ? warn(`Active, but has no email, so ${esc(record.name)} can't log in. Add their email with <a href="/admin/vas/${record.id}/edit">Edit</a>.`)
      : active && login?.conflict ? warn(`${esc(email)} is already the login of ${esc(login.conflict.name)}${login.conflict.is_admin ? ' (an admin)' : ''}, so this VA has no login. Give this VA their own email with <a href="/admin/vas/${record.id}/edit">Edit</a>.`)
      : active ? '<p class="meta">Their login is being made. Reload the page in a moment.</p>'
      : `<p class="meta">No login. Only Active VAs can log in; set VA Status to Active with <a href="/admin/vas/${record.id}/edit">Edit</a> to give ${esc(record.name)} one.</p>`;
  } else {
    const base = `/admin/vas/${record.id}/login`;
    const c = checkedInfo(u, base);
    const can = u.is_va || u.is_admin;
    const access = u.is_va ? `Logs in with <b>${esc(u.email)}</b> and checks in.${u.is_admin ? ' Also an admin.' : ''}`
      : u.is_admin ? `Logs in with <b>${esc(u.email)}</b> as an admin. Not Active, so no check-ins.`
      : active && !email ? `Active, but has no email, so ${esc(record.name)} can't log in. Add their email with <a href="/admin/vas/${record.id}/edit">Edit</a>.`
      : `Not Active, so ${esc(record.name)} can't log in. Their login (${esc(u.email)}) and history are kept.`;
    body = `${active && !email ? warn(access) : `<p class="meta">${access}</p>`}
      <div class="chips">${chip(loginText(u), u.has_password ? 'good' : 'muted')}${u.is_va ? c.chip : ''}</div>
      <p class="meta">${esc(lastLoginText(u))} · ${u.invited_at ? `Invite sent ${esc(formatDate(u.invited_at.slice(0, 10), true))}` : 'No invite sent yet'}${u.is_va ? ` · ${esc(c.why)}` : ''}</p>
      ${can ? `<div class="actions">${u.is_va ? c.button : ''}${loginButtons(u, base)}</div>` : ''}`;
  }
  return section({
    title: 'Login', key: 'login', tone: active && (!u || !u.is_va) ? 'attention' : '',
    hint: 'Their email on this record is the email they log in with. Changing it keeps the same login and history.',
    body: `<div style="padding:0 8px 8px">${body}</div>`,
  });
}

export function recordPage({ user, key, record, names, notes, files, history, contacts, projects, parent, referredHere, login, va, training, mail, edit, tags, time = null, message, tempPassword = null }) {
  const d = record.data;
  const mod = MODULES[key];
  const here = `/admin/${key}/${record.id}`;
  const back = key === 'contacts'
    ? (parent ? [`/admin/clients/${parent.id}`, parent.name] : ['/admin/contacts', 'All contacts'])
    : [`/admin/${key}`, `All ${mod.label.toLowerCase()}`];
  const status = record.status === 'n/a' ? 'No status' : record.status;
  const contactLine = [d.Title && esc(d.Title), d.Email && mailLink(d.Email), d.Phone && phoneLink(d.Phone), d.Location && esc(d.Location)].filter(Boolean);
  const head = `<div class="card" id="rec-head">
    <div class="rec-head">${avatar(record.name, 'lg')}<div class="grow"><h2>${esc(record.name)}</h2>
      <div class="chips">${key === 'contacts' ? (parent ? chip(`Contact at ${parent.name}`, 'info') : chip('No client', 'warn')) : ''}${chip(status, tone(record.status))}</div></div></div>
    ${contactLine.length ? `<p class="meta">${contactLine.join(' · ')}</p>` : ''}
    ${tags ? recordTagsRow(key, record.id, tags.on) : ''}
    <div class="actions rec-actions">
      <a class="btn sm" href="${here}/edit">${icon('edit')} Edit</a>
      ${key === 'clients' ? `<a class="btn sm plain" href="/admin/contacts/new?client=${record.id}">${icon('plus')} Add contact</a>` : ''}
      <a class="btn sm plain" href="#notes">${icon('note')} Notes · ${notes.length}</a>
      <a class="btn sm plain" href="#files">${icon('doc')} Files · ${files.length}</a>
      ${mail ? `<a class="btn sm plain" href="#emails">${icon('mail')} Emails · ${mail.emails.length}${mail.more ? '+' : ''}</a>` : ''}
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
      title: 'VAs and projects', count: projects.length, key: 'projects', hint: 'Active projects in Zoho Projects linked to this client (choose the client of a project on the Projects page).',
      body: projects.length ? projects.map((p) => `<div class="item flat"><div class="item-head">${avatar(p.vas || '?')}
        <div class="grow"><div class="title">${esc(p.vas || 'No VA')}</div><div class="sub">${esc(p.name)}</div></div>
        ${p.is_coverage ? chip('Coverage', 'info') : `<a class="btn sm plain" href="/sops/${esc(encodeURIComponent(p.id))}">${icon('doc')} SOP</a>`}</div></div>`).join('')
        : empty('No active project is linked to this client. Link one on the <a href="/admin/projects">Projects page</a>.'),
    });
  }
  if (key === 'vas') {
    related += loginBox(record, login);
    related += vaTimeBox(time);
    related += section({
      title: 'Clients and projects', count: login?.projects.length || 0, key: 'projects',
      hint: login?.user && !login.user.is_va && login.projects.length ? "Not Active: these projects are kept for their history, but they don't check in for them and the Projects page doesn't list them." : '',
      body: login?.projects.length ? login.projects.map((p) => `<div class="item flat"><div class="item-head">${avatar(p.client)}
        <div class="grow"><div class="title">${esc(p.client)}</div><div class="sub">${esc(p.name)}</div></div>
        ${p.is_coverage ? chip('Coverage', 'info') : `<a class="btn sm plain" href="/sops/${esc(encodeURIComponent(p.id))}">${icon('doc')} SOP</a>`}</div></div>`).join('')
        : empty('No active projects.'),
    });
  }

  if (key === 'applicants') related += hiringPanel(record, va) + trainingCard(record, training);

  let hidden = 0;
  const filesBy = (fieldKey) => files.filter((f) => f.field === fieldKey);
  const { choices = {}, owners = [], clients = [] } = edit || {};
  const sections = mod.sections.map((s, n) => {
    if (key === 'applicants' && s.offer) return offerChecklist(record, s);
    // An empty section (all its fields moved or hidden on Settings > Fields) is left out.
    if (!s.fields.length && !s.score && !(key === 'contacts' && n === 0)) return '';
    let filled = 0;
    const rows = s.fields.map((x) => {
      // Files are added in the Files section, so they are not changed here.
      if (x.type === 'file') {
        const html = filesBy(x.key).map((f) => `<a href="${fileLink(key, record.id, f)}" target="_blank" rel="noopener">${icon('doc')} ${esc(f.file_name)}</a>`).join('<br>');
        if (html) filled++;
        return html ? `<div><dt>${esc(x.label)}</dt><dd>${html}</dd></div>` : '';
      }
      const html = valueHtml(x, d[x.key], names);
      if (html) filled++; else hidden++;
      return editRow(x, html, input(x, d[x.key], choices, owners));
    });
    // A contact's client, changed like a field.
    if (key === 'contacts' && n === 0) {
      const html = clientValueHtml(record.parent_id, names);
      if (html) filled++; else hidden++;
      rows.unshift(editRow({ key: '_client', label: 'Client' }, html, `<div><label for="f-parent">Client</label><select id="f-parent" name="parent_id"><option value="">No client</option>${clients.map((c) => `<option value="${c.id}" ${c.id === Number(record.parent_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>`, false));
    }
    const reverse = s.fields.find((x) => x.reverse);
    if (reverse && referredHere.length) { filled++; rows.push(`<div><dt>${esc(reverse.reverse)}</dt><dd>${referredHere.map((r) => linkTo(key, r.id, r.name)).join(', ')}</dd></div>`); }
    const list = `<dl class="fields">${rows.join('')}</dl>`;
    if (s.score) {
      // Score sections always show, with a link to fill them in.
      const editLink = `<a class="btn sm plain" href="${here}/edit#edit-${esc(encodeURIComponent(s.title))}">${icon('edit')} ${filled ? 'Change the scores' : 'Fill in the scores'}</a>`;
      return section({ title: s.title, count: filled || undefined, key: `sec-${s.title}`,
        body: `${scoreSummary(s.score, d) || '<p class="meta">Not scored yet.</p>'}${list}<div class="actions">${editLink}</div>` });
    }
    return section({ title: s.title, count: filled, key: `sec-${s.title}`, tone: filled ? '' : 'sec-empty', body: list });
  }).join('');
  const nothing = !/class="section (?!sec-empty)/.test(sections);
  const extra = d._extra ? section({
    title: d._wufoo ? 'Other fields from Wufoo' : 'Other fields from Zoho', count: Object.keys(d._extra).length, open: false, key: 'extra',
    hint: d._wufoo ? 'Answers on the Wufoo form that have no place in the app. Kept here so nothing is lost.'
      : 'Fields that were filled in Zoho CRM (before this record moved to the app) and have no place in the app. Kept here so nothing is lost.',
    body: `<dl class="fields">${Object.entries(d._extra).map(([k, v]) => `<div><dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`,
  }) : '';

  return layout({
    title: record.name, user, active: activeFor(key), message,
    body: `<div class="chips proj-tabs"><a class="chip muted" href="${esc(back[0])}">‹ ${esc(back[1])}</a></div>
    ${loginResult(tempPassword)}${head}${related}
    <div id="rec-fields">${sections}</div>
    ${nothing ? `<div class="card" id="rec-nothing">${empty('No details yet. Click <b>Show empty fields</b> to fill them in here, or click Edit.')}</div>` : ''}
    <p class="meta" id="rec-hidden">Click a value to change it.${hidden ? ` ${hidden} empty field${hidden === 1 ? ' is' : 's are'} hidden.
      <button type="button" class="sm plain fe-toggle"><span class="when-hidden">Show empty fields</span><span class="when-shown">Hide empty fields</span></button>` : ''}</p>
    ${extra}
    ${mail ? emailsSection({ user, record, ...mail }) : ''}
    ${section({ title: 'Notes', count: notes.length, key: 'notes', body: notesHtml(key, record, notes, user) })}
    ${section({ title: 'Files', count: files.length, key: 'files', body: filesHtml(key, record, files) })}
    ${section({ title: 'History', count: history.length, open: false, key: 'history', hint: 'Who changed what, newest first.', body: historyHtml(key, history, names) })}
    ${tags ? tagPicker(key, tags.all, tags.ids) : ''}
    <script>${FIELD_SCRIPT}</script>${tags ? `<script>${PICKER_SCRIPT}</script>` : ''}`,
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
    return `<option value="">—</option>${all.map((o) => `<option value="${esc(o)}" ${o === current ? 'selected' : ''}>${esc(o)}${list.includes(o) ? '' : ' (old choice)'}</option>`).join('')}`;
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
        `<label class="check"><input type="checkbox" name="${name}" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''}> ${esc(o)}${x.options.includes(o) ? '' : ' (old choice)'}</label>`).join('')}${hint}</fieldset>`;
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
  const back = isNew ? (key === 'contacts' && record.parent_id ? `/admin/clients/${record.parent_id}` : key === 'contacts' ? '/admin/contacts' : `/admin/${key}`) : `/admin/${key}/${record.id}`;
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

// ---- Hiring: the list of applicants ----

// The Wufoo box on the Applicants page: where Wufoo sends new applications, and what arrived last.
function wufooBox(w) {
  if (!w) return '';
  const lines = [];
  lines.push(`<p class="meta">Wufoo sends each new application to this address (paste it into the WebHook settings of the application form in Wufoo):</p>
    <p><code style="word-break:break-all">${esc(w.url)}</code></p>`);
  lines.push(`<p class="meta">Handshake Key saved in Cloudflare (<code>WUFOO_HANDSHAKE_KEY</code>): <b>${w.keySet ? 'Yes' : 'No'}</b>${w.keySet ? '' : ' (until it is set, every application from Wufoo is turned away; see README, "Hiring")'}</p>`);
  lines.push(w.last_at
    ? `<p class="meta">Last application received: <b>${esc(zohoTime(w.last_at))}</b>${w.last_id ? ` (${linkTo('applicants', w.last_id, w.last_name || 'open')}${w.last_entry ? `, Wufoo entry #${esc(w.last_entry)}` : ''})` : ''}.</p>`
    : '<p class="meta">No application has come from Wufoo yet.</p>');
  if (w.last_at && w.structured === false) {
    lines.push('<div class="toast bad" style="display:block">The last application came without question names. In Wufoo, tick <b>Include Field and Form Structures with Entry Data</b> in the WebHook settings.</div>');
  }
  if (w.unmatched?.length) {
    lines.push(`<p class="meta">Questions in the last application whose answers did not go into a field in the app (they are under <b>Other fields from Wufoo</b> on the applicant, so nothing is lost):</p>
      <ul class="changes">${w.unmatched.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="small">To put one of them into a field, add its title to <code>WUFOO_FIELDS</code> in <code>src/wufoo.js</code>.</p>`);
  }
  if (w.file_problems?.length) {
    lines.push(`<p class="meta">Files that could not be saved from the last application (the link is in a note on the applicant):</p>
      <ul class="changes">${w.file_problems.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
  }
  if (w.rejected_at && (!w.last_at || w.rejected_at > w.last_at)) {
    lines.push(`<p class="meta">Turned away ${esc(zohoTime(w.rejected_at))}: ${esc(w.rejected_why || 'wrong Handshake Key')}.</p>`);
  }
  const problem = !w.keySet || w.structured === false || (w.rejected_at && (!w.last_at || w.rejected_at > w.last_at));
  return section({ title: 'New applications from Wufoo', key: 'wufoo', open: !w.last_at || problem, tone: problem ? 'attention' : '',
    count: w.keySet ? undefined : 'not set up', body: `<div style="padding:0 8px 8px">${lines.join('')}</div>` });
}

export function applicantsPage({ user, records, names, wufoo, tags, tools, message }) {
  const by = (s) => records.filter((r) => r.status === s);
  const open = records.filter((r) => STEPS.includes(r.status) && r.status !== 'Hired').length;
  return listPage({
    user, key: 'applicants', title: 'Hiring', active: '/admin/applicants', message, records, tags, tools, names,
    lead: 'Everyone who applied, by hiring step. Click an applicant to see their details, scores and notes, and to move them to the next step.',
    groups: [...STEPS.map((s) => [s, by(s), s !== 'Hired']), ...CLOSED.map((s) => [s, by(s), false]),
      ['Other', records.filter((r) => !STEPS.includes(r.status) && !CLOSED.includes(r.status)), false]],
    summary: `${chip(`${open} in progress`, 'info')}${chip(`${by('Hired').length} hired`, 'good')}${CLOSED.map((s) => chip(`${by(s).length} ${s.toLowerCase()}`, 'muted')).join('')}`,
    searchHint: 'Search applicants, emails or places', after: wufooBox(wufoo),
  });
}
