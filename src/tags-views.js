// The parts of pages for tags (see tags.js): coloured tag chips, Settings > Tags, the tag picker on a record page,
// and the tag filter and tick boxes ("bulk" actions) on the VAs, Hiring and Clients list pages.

import { esc } from './util.js';
import { layout, icon, section, empty, zohoTime, settingsTabs } from './views.js';

// The colours a tag can have (the chip styles are in views.js, .chip.tg-<colour>).
export const COLOURS = [['grey', 'Grey'], ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow'], ['orange', 'Orange'],
  ['red', 'Red'], ['purple', 'Purple'], ['pink', 'Pink']];
// The kinds of records that can have tags, and their names.
export const TAG_KEYS = [['vas', 'VAs'], ['applicants', 'Applicants'], ['clients', 'Clients']];

export const tagChip = (t) => `<span class="chip tg-${esc(t.colour)}" data-tag="${t.id}">${esc(t.name)}</span>`;
export const tagChips = (tags) => tags.map(tagChip).join('');

// Folders in order, each with its tags; "No folder" last. only: limit to tags this kind of record can have (plus
// `keep`, tag ids a record already has).
export function grouped({ folders, tags }, only = null, keep = new Set()) {
  const ok = (t) => !only || t[`on_${only}`] || keep.has(t.id);
  const groups = folders.map((f) => ({ folder: f, tags: tags.filter((t) => t.folder_id === f.id && ok(t)) }));
  groups.push({ folder: { id: 0, name: 'No folder' }, tags: tags.filter((t) => !t.folder_id && ok(t)) });
  return groups;
}

// Every tag by id, with its place in folder order (i), for sorting a record's chips.
export const tagIndex = (all) => new Map(grouped(all).flatMap((g) => g.tags).map((t, i) => [t.id, { ...t, i }]));

const usedOn = (t) => TAG_KEYS.filter(([k]) => t[`on_${k}`]).map(([, l]) => l).join(', ') || 'Nothing';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- Settings > Tags ----

const form = (op, hidden, inner, confirm = '') => `<form method="post" action="/admin/settings/tags" class="inline-form"${confirm ? ` data-confirm="${esc(confirm)}"` : ''}>
  <input type="hidden" name="op" value="${op}">${Object.entries(hidden).map(([n, v]) => `<input type="hidden" name="${n}" value="${esc(v)}">`).join('')}${inner}</form>`;
const btn = (label, cls = 'sm plain', aria = '') => `<button class="${cls}"${aria ? ` aria-label="${esc(aria)}"` : ''}>${label}</button>`;
const folderOptions = (folders, on) => `<option value="0">No folder</option>${folders.map((f) => `<option value="${f.id}" ${f.id === on ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}`;
const colourOptions = (on) => COLOURS.map(([c, l]) => `<option value="${c}" ${c === on ? 'selected' : ''}>${l}</option>`).join('');
const typeBoxes = (t, id) => `<fieldset class="picks"><legend>Can be used on</legend>${TAG_KEYS.map(([k, l]) =>
  `<label class="check"><input type="checkbox" name="types" value="${k}" ${!t || t[`on_${k}`] ? 'checked' : ''}${id ? ` id="${id}-${k}"` : ''}> ${l}</label>`).join('')}</fieldset>`;

function tagRow(t, folders, counts) {
  const n = counts.get(t.id) || 0;
  const id = `tg-${t.id}`;
  return `<div class="item flat" id="${id}"><div class="item-head"><div class="grow">
      <div class="title">${tagChip(t)}</div><div class="sub">${esc(usedOn(t))} · ${plural(n, 'record')}</div></div></div>
    <details class="list-opts"><summary>Change</summary><div class="fx-more">
      ${form('tag_save', { id: t.id }, `<div class="form-grid">
        <div><label for="${id}-n">Name</label><input type="text" id="${id}-n" name="name" value="${esc(t.name)}" maxlength="60" required></div>
        <div><label for="${id}-f">Folder</label><select id="${id}-f" name="folder">${folderOptions(folders, t.folder_id)}</select></div>
        <div><label for="${id}-c">Colour</label><select id="${id}-c" name="colour">${colourOptions(t.colour)}</select></div>
        <div class="wide">${typeBoxes(t)}</div></div>
        <div class="actions">${btn('Save tag', 'sm')}</div>`)}
      ${form('tag_delete', { id: t.id }, btn(`${icon('trash')} Delete tag`, 'sm danger'),
        `Delete the tag "${t.name}"? ${n ? `It is on ${plural(n, 'record')}, and will be removed from ${n === 1 ? 'it' : 'them'}.` : 'No record has it.'} This cannot be undone.`)}
    </div></details></div>`;
}

export function tagsPage({ user, folders, tags, counts, log, message, error }) {
  const groups = grouped({ folders, tags });
  const secs = groups.map((g, i) => {
    const f = g.folder;
    const real = Boolean(f.id);
    const controls = real ? `<div class="actions fx-sec">
      ${i ? form('folder_up', { id: f.id }, btn('↑ Move folder up')) : ''}
      ${i < folders.length - 1 ? form('folder_down', { id: f.id }, btn('↓ Move folder down')) : ''}
      <details class="list-opts"><summary>Rename folder</summary>${form('folder_rename', { id: f.id }, `<div class="row"><input type="text" name="name" value="${esc(f.name)}" maxlength="40" required aria-label="Folder name"><div style="flex:0">${btn('Rename', 'sm')}</div></div>`)}</details>
      ${form('folder_delete', { id: f.id }, btn(`${icon('trash')} Delete folder`, 'sm danger'),
        g.tags.length ? `Delete the folder "${f.name}"? Its ${plural(g.tags.length, 'tag')} move${g.tags.length === 1 ? 's' : ''} to "No folder" (records keep them).` : `Delete the folder "${f.name}"?`)}</div>` : '';
    if (!real && !g.tags.length) return '';
    return section({ title: f.name, count: g.tags.length, open: true, key: `tf-${f.id}`,
      body: `${g.tags.map((t) => tagRow(t, folders, counts)).join('') || empty('No tags in this folder.')}${controls}` });
  }).join('');
  const add = `<form method="post" action="/admin/settings/tags" class="card">
    <h3 style="margin-top:0">Add a tag</h3><input type="hidden" name="op" value="tag_add">
    <div class="form-grid">
      <div><label for="add-name">Name</label><input type="text" id="add-name" name="name" maxlength="60" required></div>
      <div><label for="add-folder">Folder</label><select id="add-folder" name="folder">${folderOptions(folders, folders[0]?.id)}</select></div>
      <div><label for="add-colour">Colour</label><select id="add-colour" name="colour">${colourOptions('blue')}</select></div>
      <div class="wide">${typeBoxes(null)}</div>
    </div>
    <div class="actions">${btn(`${icon('plus')} Add tag`, '')}</div></form>`;
  const addFolder = `<form method="post" action="/admin/settings/tags" class="card"><input type="hidden" name="op" value="folder_add">
    <div class="row"><div><label for="folder-name" style="margin-top:0">Add a folder</label><input type="text" id="folder-name" name="name" maxlength="40" required placeholder="For example: Skills, Languages, Source"></div>
    <div style="flex:0">${btn(`${icon('plus')} Add folder`, 'sm')}</div></div></form>`;
  return layout({
    title: 'Tags', user, active: '/admin/settings', message,
    body: `${settingsTabs('/admin/settings/tags')}
    <style>.inline-form{display:inline-block;margin:0}.fx-more{padding:4px 0 10px}.fx-more form{margin:0 0 8px}.fx-sec{margin:8px}.fx-sec form{display:inline-block}</style>
    <p class="lead">Tags you can put on VAs, applicants and clients, grouped in folders (for example Skills, Languages or Source). Pick them on a record page (<b>Edit tags</b>), or tick several records on the VAs, Hiring or Clients page. The lists can be filtered by tag.</p>
    ${error ? `<div class="toast bad" role="alert">${esc(error)}</div>` : ''}
    ${secs || empty('No tags yet. Add a folder and a tag below.')}
    ${add}${addFolder}
    ${section({ title: 'Recent changes', count: log.length, open: false, key: 'tags-log', hint: 'The last 20 changes to tags and folders.',
      body: log.length ? log.map((l) => `<div class="item flat"><div class="item-head"><div class="grow"><div class="title">${esc(l.summary)}</div>
        <div class="sub">${esc(l.user_name || 'Automatic')} · ${esc(zohoTime(l.at))}</div></div></div></div>`).join('') : empty('No changes yet.') })}`,
  });
}

// ---- The tag picker on a record page ----

// The tags row in the top card of a record page.
export const recordTagsRow = (key, recordId, on) => `<div class="tag-row" id="rec-tags" data-url="/admin/${key}/${recordId}/tags">
  <span class="chips tag-chips">${tagChips(on)}</span><button type="button" class="sm plain tag-open">${icon('edit')} ${on.length ? 'Edit tags' : 'Add tags'}</button></div>`;

// The list of tags in the picker, grouped by folder, with this record's ticked.
export function pickerList(key, all, onIds) {
  const groups = grouped(all, key, onIds).filter((g) => g.tags.length);
  if (!groups.length) return '<p class="meta tp-none">No tags yet. Create one below.</p>';
  return groups.map((g) => `<fieldset class="tp-group"><legend>${esc(g.folder.name)}</legend>${g.tags.map((t) =>
    `<label class="tp-tag"><input type="checkbox" value="${t.id}" ${onIds.has(t.id) ? 'checked' : ''}> ${tagChip(t)}</label>`).join('')}</fieldset>`).join('');
}

export function tagPicker(key, all, onIds) {
  return `<div class="tag-picker" id="tag-picker" hidden><div class="tp-box" role="dialog" aria-modal="true" aria-labelledby="tp-title">
    <div class="tp-head"><h3 id="tp-title">Tags</h3><button type="button" class="sm tp-done">Done</button></div>
    <label class="search" for="tp-find">${icon('tag')}<input id="tp-find" type="search" placeholder="Search tags" autocomplete="off"></label>
    <div class="toast bad tp-error" role="alert" hidden></div>
    <div class="tp-list">${pickerList(key, all, onIds)}</div>
    <p class="meta tp-nomatch" hidden>No tag matches.</p>
    <details class="tp-new"><summary>${icon('plus')} Create tag</summary><form class="tp-create">
      <div class="form-grid">
        <div><label for="tp-name">Name</label><input type="text" id="tp-name" name="new_name" maxlength="60" required></div>
        <div><label for="tp-folder">Folder</label><select id="tp-folder" name="new_folder">${folderOptions(all.folders, all.folders[0]?.id)}</select></div>
        <div><label for="tp-colour">Colour</label><select id="tp-colour" name="new_colour">${colourOptions('blue')}</select></div>
      </div>
      <p class="small">${key === 'clients' ? 'The new tag can be used on clients.' : 'The new tag can be used on VAs and applicants.'} Change that on Settings &gt; Tags.</p>
      <div class="actions"><button class="sm">${icon('plus')} Create and add</button></div></form></details>
  </div></div>`;
}

// Opens the picker; each tick adds or removes the tag right away (POST .../tags, answered with the new chips).
// When the picker closes after a change, the History section is fetched again.
export const PICKER_SCRIPT = `(function () {
  var row = document.getElementById('rec-tags'), box = document.getElementById('tag-picker');
  if (!row || !box) return;
  var url = row.dataset.url, changed = false, find = box.querySelector('#tp-find'), err = box.querySelector('.tp-error');
  function openIt() { box.hidden = false; document.body.classList.add('tp-open'); err.hidden = true; find.value = ''; filter(); find.focus(); }
  function closeIt() {
    box.hidden = true; document.body.classList.remove('tp-open');
    var b = document.querySelector('#rec-tags .tag-open'); if (b) b.focus();
    if (!changed) return;
    changed = false;
    fetch(location.pathname, { credentials: 'same-origin' }).then(function (r) { return r.ok && !r.redirected ? r.text() : null; }).then(function (html) {
      if (!html) return;
      var fresh = new DOMParser().parseFromString(html, 'text/html').getElementById('history'), now = document.getElementById('history');
      if (fresh && now) { fresh.open = now.open; now.replaceWith(fresh); }
    }).catch(function () {});
  }
  function send(body, done) {
    err.hidden = true;
    fetch(url, { method: 'POST', body: body, credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return /json/.test(r.headers.get('Content-Type') || '') ? r.json() : { error: 'Not saved. Please reload the page (you may need to log in again).' }; })
      .catch(function () { return { error: 'Not saved: the app could not be reached. Please try again.' }; })
      .then(function (res) {
        if (res.error) { err.textContent = res.error; err.hidden = false; done(false); return; }
        changed = true;
        var chips = document.querySelector('#rec-tags .tag-chips'); if (chips) chips.innerHTML = res.chips;
        var b = document.querySelector('#rec-tags .tag-open'); if (b) b.lastChild.textContent = res.chips ? ' Edit tags' : ' Add tags';
        if (res.picker) box.querySelector('.tp-list').innerHTML = res.picker;
        done(true);
      });
  }
  function filter() {
    var q = find.value.trim().toLowerCase(), any = false;
    box.querySelectorAll('.tp-group').forEach(function (g) {
      var shown = 0;
      g.querySelectorAll('.tp-tag').forEach(function (l) { var m = !q || l.textContent.toLowerCase().indexOf(q) !== -1; l.hidden = !m; if (m) shown++; });
      g.hidden = !shown; if (shown) any = true;
    });
    box.querySelector('.tp-nomatch').hidden = any || !box.querySelector('.tp-group');
  }
  document.addEventListener('click', function (e) { if (e.target.closest('#rec-tags .tag-open')) openIt(); });
  box.querySelector('.tp-done').addEventListener('click', closeIt);
  box.addEventListener('click', function (e) { if (e.target === box) closeIt(); });
  box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); closeIt(); } });
  find.addEventListener('input', filter);
  box.addEventListener('change', function (e) {
    var c = e.target;
    if (!c.matches('.tp-tag input')) return;
    var body = new URLSearchParams(); body.append('tag', c.value); body.append('on', c.checked ? '1' : '0');
    c.disabled = true;
    send(body, function (ok) { c.disabled = false; if (!ok) c.checked = !c.checked; filter(); });
  });
  box.querySelector('.tp-create').addEventListener('submit', function (e) {
    e.preventDefault(); e.stopPropagation();
    var f = e.target, b = f.querySelector('button');
    if (!f.new_name.value.trim()) { f.new_name.focus(); return; }
    b.classList.add('busy');
    send(new URLSearchParams(new FormData(f)), function (ok) {
      b.classList.remove('busy');
      if (ok) { f.new_name.value = ''; find.value = ''; filter(); }
    });
  });
})();`;

// ---- List pages: tag filter and tick boxes ----

// The tag filter and "Select all shown" above a list. The filter is kept in the address (?tags=1,2&match=all&q=...).
export function listTools(key, all) {
  const groups = grouped(all, key).filter((g) => g.tags.length);
  const filter = groups.length ? `<details class="tag-filter"><summary class="btn sm plain">${icon('tag')} <span class="tf-label">Filter by tag</span></summary>
    <div class="tf-box">
      <div class="tf-mode" role="radiogroup" aria-label="How to match tags"><label class="check"><input type="radio" name="tf-match-${key}" value="any" checked> Has any of them</label>
        <label class="check"><input type="radio" name="tf-match-${key}" value="all"> Has all of them</label></div>
      ${groups.map((g) => `<fieldset class="tp-group"><legend>${esc(g.folder.name)}</legend>${g.tags.map((t) =>
        `<label class="tp-tag"><input type="checkbox" class="tf-tag" value="${t.id}"> ${tagChip(t)}</label>`).join('')}</fieldset>`).join('')}
      <div class="actions"><button type="button" class="sm plain tf-clear">Clear the tag filter</button></div></div></details>` : '';
  return `<div class="list-tools">${filter}<button type="button" class="sm plain sel-all">${icon('check')} Select all shown</button></div>`;
}

// The bar at the bottom that appears when records are ticked: what can be done with them. Step 5 adds more actions
// here (each is a button with name="op" in this form, sent to its own address with formaction).
export function bulkBar(key, all) {
  const tags = grouped(all, key).filter((g) => g.tags.length);
  const options = tags.map((g) => `<optgroup label="${esc(g.folder.name)}">${g.tags.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('');
  return `<form method="post" action="/admin/tags/bulk" class="bulk-bar" id="bulk-bar" hidden>
    <input type="hidden" name="module" value="${key}"><input type="hidden" name="back" value="/admin/${key}">
    <span class="bulk-count" role="status">0 selected</span>
    ${options ? `<select name="tag" aria-label="Tag" required>${options}</select>
    <button class="sm" name="op" value="add">${icon('plus')} Add tag</button><button class="sm plain" name="op" value="remove">Remove tag</button>`
    : '<span class="small">Add tags on Settings &gt; Tags first.</span>'}
    <button type="button" class="sm plain bulk-clear">Clear</button></form>`;
}

// Tag filter (together with the search box), tick boxes and the bulk bar on a list page with [data-list].
export const LIST_SCRIPT = `document.addEventListener('DOMContentLoaded', function () {
  var list = document.querySelector('[data-list]');
  if (!list) return;
  var search = document.getElementById(list.dataset.search), bar = document.getElementById('bulk-bar');
  var params = new URLSearchParams(location.search);
  var chosen = (params.get('tags') || '').split(',').filter(Boolean), mode = params.get('match') === 'all' ? 'all' : 'any';
  var boxes = document.querySelectorAll('.tf-tag'), label = document.querySelector('.tf-label');
  boxes.forEach(function (b) { b.checked = chosen.indexOf(b.value) !== -1; });
  chosen = chosen.filter(function (id) { return document.querySelector('.tf-tag[value="' + id + '"]'); });
  document.querySelectorAll('.tf-mode input').forEach(function (r) { r.checked = r.value === mode; });
  if (search && params.get('q')) search.value = params.get('q');
  function rows() { return list.querySelectorAll('.sel-item'); }
  function shown(r) { return r.offsetParent !== null; }
  function remember() {
    var u = new URL(location.href);
    if (chosen.length) u.searchParams.set('tags', chosen.join(',')); else u.searchParams.delete('tags');
    if (chosen.length > 1 && mode === 'all') u.searchParams.set('match', 'all'); else u.searchParams.delete('match');
    if (search && search.value.trim()) u.searchParams.set('q', search.value.trim()); else u.searchParams.delete('q');
    history.replaceState(history.state, '', u.pathname + u.search.replace(/%2C/g, ',') + u.hash);
  }
  function apply() {
    rows().forEach(function (r) {
      var has = (r.dataset.tags || '').split(',');
      var ok = !chosen.length || (mode === 'all' ? chosen.every(function (t) { return has.indexOf(t) !== -1; }) : chosen.some(function (t) { return has.indexOf(t) !== -1; }));
      if (ok) r.removeAttribute('data-out'); else r.setAttribute('data-out', '');
    });
    if (label) label.textContent = chosen.length ? 'Tags: ' + chosen.length + ' chosen' : 'Filter by tag';
    var d = document.querySelector('.tag-filter'); if (d) d.classList.toggle('on', chosen.length > 0);
    if (search) search.dispatchEvent(new Event('input'));
    remember(); count();
  }
  function count() {
    if (!bar) return;
    var n = 0;
    rows().forEach(function (r) { if (r.querySelector('.sel-box').checked && shown(r)) n++; });
    bar.hidden = !n; bar.querySelector('.bulk-count').textContent = n + ' selected';
    document.body.classList.toggle('bulk-on', n > 0);
  }
  boxes.forEach(function (b) { b.addEventListener('change', function () {
    chosen = Array.prototype.filter.call(boxes, function (x) { return x.checked; }).map(function (x) { return x.value; }); apply();
  }); });
  document.querySelectorAll('.tf-mode input').forEach(function (r) { r.addEventListener('change', function () { mode = r.value; apply(); }); });
  var clear = document.querySelector('.tf-clear');
  if (clear) clear.addEventListener('click', function () { boxes.forEach(function (b) { b.checked = false; }); chosen = []; apply(); });
  if (search) search.addEventListener('input', function (e) { if (e.isTrusted) { remember(); count(); } });
  list.addEventListener('change', function (e) { if (e.target.classList.contains('sel-box')) count(); });
  list.addEventListener('toggle', count, true);
  var all = document.querySelector('.sel-all');
  if (all) all.addEventListener('click', function () { rows().forEach(function (r) { if (shown(r)) r.querySelector('.sel-box').checked = true; }); count(); });
  if (bar) {
    bar.querySelector('.bulk-clear').addEventListener('click', function () { rows().forEach(function (r) { r.querySelector('.sel-box').checked = false; }); count(); });
    bar.addEventListener('submit', function () {
      bar.querySelectorAll('input[name=ids]').forEach(function (i) { i.remove(); });
      rows().forEach(function (r) {
        var b = r.querySelector('.sel-box');
        if (b.checked && shown(r)) { var i = document.createElement('input'); i.type = 'hidden'; i.name = 'ids'; i.value = b.value; bar.appendChild(i); }
      });
      bar.querySelector('[name=back]').value = location.pathname + location.search;
    });
  }
  apply();
});`;
