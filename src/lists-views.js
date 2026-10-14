// The tools above and below a list page (Clients, Contacts, VAs, Hiring; see lists.js): Columns, Filter, Export CSV,
// the column headings to sort by, the bar for ticked records ("Change a field" and the tag buttons), and the script
// that runs them together with the tag filter and the search box.

import { esc } from './util.js';
import { icon } from './views.js';
import { tagFilter, tagBulk } from './tags-views.js';

const selfUrl = (key, search) => `/admin/${key}${search || ''}`;

// The column headings: click one to sort by it (again to sort the other way). The script keeps the other choices in
// the address; the links work without it too.
export function listHead(key, tools) {
  const { cols, sort } = tools;
  const link = (k, label) => {
    const on = sort && sort.c.key === k;
    const dir = on && !sort.desc ? 'desc' : 'asc';
    const u = new URLSearchParams(tools.search);
    u.set('sort', k); u.set('dir', dir);
    const arrow = on ? (sort.desc ? ' ▼' : ' ▲') : '';
    return `<a class="lh${on ? ' on' : ''}" href="${esc(selfUrl(key, `?${u}`))}" data-sort="${esc(k)}"${on ? ` aria-sort="${sort.desc ? 'descending' : 'ascending'}"` : ''}>${esc(label)}${arrow}</a>`;
  };
  return `<div class="lrow lhead" aria-label="Sort by"><span class="lh-sort small">Sort:</span>${link('name', 'Name')}${cols.map((c) => link(c.key, c.label)).join('')}</div>`;
}

// Columns, Filter and Export CSV, with the tag filter and "Select all shown".
export function listTools(key, tags, tools) {
  const chosen = new Set(tools.cols.map((c) => c.key));
  const columns = `<details class="lt-pop lt-cols"><summary class="btn sm plain">${icon('edit')} Columns</summary>
    <form method="post" action="/admin/${key}/columns" class="tf-box"><input type="hidden" name="back" value="">
      <p class="small">Choose the columns of this list (up to 12). They are saved for you only, in the order of Settings &gt; Fields. On a phone the first two show under the name.</p>
      <fieldset class="picks lt-picks" aria-label="Columns">${tools.choices.map((c) =>
        `<label class="check"><input type="checkbox" name="cols" value="${esc(c.key)}" ${chosen.has(c.key) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</fieldset>
      <div class="actions"><button class="sm">${icon('check')} Save columns</button>${tools.custom ? '<button class="sm plain" name="op" value="reset">Back to the standard columns</button>' : ''}</div></form></details>`;
  const n = tools.filters.length;
  const filter = `<details class="lt-pop ff${n ? ' on' : ''}"${n ? ' open' : ''}><summary class="btn sm plain">${icon('search')} <span>${n ? `Filter: ${n} condition${n === 1 ? '' : 's'}` : 'Filter'}</span></summary>
    <form class="tf-box ff-box"><p class="small">Show only the records that match every condition.</p>
      <div class="ff-rows"></div>
      <label for="ff-add-${key}">Add a condition</label><select id="ff-add-${key}" class="ff-add"><option value="">Choose a field…</option></select>
      <div class="actions"><button class="sm">${icon('check')} Apply</button>${n ? `<a class="btn sm plain ff-clear" href="${esc(selfUrl(key, `?${(() => { const u = new URLSearchParams(tools.search); u.delete('f'); return u; })()}`))}">Clear filters</a>` : ''}</div></form></details>`;
  const exp = `<details class="lt-pop lt-export"><summary class="btn sm plain">${icon('download')} Export CSV</summary>
    <form method="post" action="/admin/${key}/export" class="tf-box ex-form"><input type="hidden" name="back" value="">
      <p class="small ex-what">Downloads the rows shown (or only the ticked ones) as a CSV file for Excel or Google Sheets.</p>
      <label class="check"><input type="checkbox" name="all" value="1"> All fields, not only the columns</label>
      <div class="actions"><button class="sm">${icon('download')} Download CSV</button></div></form></details>`;
  return `<div class="list-tools">${columns}${filter}${tags ? tagFilter(key, tags) : ''}${exp}
    <button type="button" class="sm plain sel-all">${icon('check')} Select all shown</button></div>`;
}

// The bar that appears when records are ticked: "Change a field", and adding or removing a tag.
export function bulkBar(key, tags) {
  return `<form method="post" action="/admin/tags/bulk" class="bulk-bar" id="bulk-bar" hidden>
    <input type="hidden" name="module" value="${key}"><input type="hidden" name="back" value="/admin/${key}">
    <span class="bulk-count" role="status">0 selected</span>
    <details class="bf"><summary class="btn sm plain">${icon('edit')} Change a field</summary><div class="bf-box">
      <select name="_f" class="bf-field" aria-label="Field to change"><option value="">Choose a field…</option></select>
      <span class="bf-val"></span>
      <button class="sm bf-go" name="op" value="field" formaction="/admin/${key}/bulk-field" disabled>${icon('check')} Change</button>
      <p class="small bf-note">Names, emails, phone numbers, web links, Slack IDs, links to other records and long text are changed on each record's page. Each record's History shows the change.</p></div></details>
    ${tags ? tagBulk(key, tags) : ''}
    <button type="button" class="sm plain bulk-clear">Clear</button></form>`;
}

// The fields for the script (see fieldsForScript in lists.js), kept out of the way of the page's HTML.
export const listFields = (fields) => `<script type="application/json" id="list-fields">${JSON.stringify(fields).replace(/</g, '\\u003c')}</script>`;

// Tag filter (together with the search box), group counts, sorting, the Filter box, tick boxes, the bulk bar and
// the export on a list page with [data-list].
export const LIST_SCRIPT = `document.addEventListener('DOMContentLoaded', function () {
  var list = document.querySelector('[data-list]');
  if (!list) return;
  var search = document.getElementById(list.dataset.search), bar = document.getElementById('bulk-bar');
  var fields = []; try { fields = JSON.parse(document.getElementById('list-fields').textContent); } catch (e) {}
  function fieldOf(k) { for (var i = 0; i < fields.length; i++) if (fields[i].k === k) return fields[i]; return null; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function tidy(u) { return u.pathname + u.search.replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%7C/g, '|') + u.hash; }
  var params = new URLSearchParams(location.search);
  // The answer to a change on many records is shown once; its details leave the address.
  (function () { var u = new URL(location.href), any = false;
    ['bn', 'bs', 'bg', 'be', 'bf', 'bad'].forEach(function (n) { if (u.searchParams.has(n)) { u.searchParams.delete(n); any = true; } });
    if (any) history.replaceState(history.state, '', tidy(u)); })();
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
    history.replaceState(history.state, '', tidy(u));
  }
  // Group counts follow the tag filter and the search box; a group with nothing left is hidden while they are used.
  function recount() {
    var active = (search && search.value.trim()) || chosen.length;
    list.querySelectorAll('details.section').forEach(function (s) {
      var n = 0;
      s.querySelectorAll('.sel-item').forEach(function (r) { if (!r.hidden) n++; });
      var c = s.querySelector('summary .count'); if (c) c.textContent = n;
      s.hidden = Boolean(active) && !n;
    });
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
  function ticked() { var out = []; rows().forEach(function (r) { var b = r.querySelector('.sel-box'); if (b && b.checked && shown(r)) out.push(b.value); }); return out; }
  function count() {
    var n = ticked().length;
    if (bar) { bar.hidden = !n; bar.querySelector('.bulk-count').textContent = n + ' selected'; document.body.classList.toggle('bulk-on', n > 0); }
    var what = document.querySelector('.ex-what');
    if (what) {
      var all = 0; rows().forEach(function (r) { if (!r.hidden) all++; });
      what.textContent = n ? 'Downloads the ' + n + ' ticked record' + (n === 1 ? '' : 's') + ' as a CSV file (for Excel or Google Sheets).'
        : 'Downloads the ' + all + ' record' + (all === 1 ? '' : 's') + ' shown (also in closed groups) as a CSV file (for Excel or Google Sheets). Tick records to download only those.';
    }
  }
  boxes.forEach(function (b) { b.addEventListener('change', function () {
    chosen = Array.prototype.filter.call(boxes, function (x) { return x.checked; }).map(function (x) { return x.value; }); apply();
  }); });
  document.querySelectorAll('.tf-mode input').forEach(function (r) { r.addEventListener('change', function () { mode = r.value; apply(); }); });
  var clear = document.querySelector('.tf-clear');
  if (clear) clear.addEventListener('click', function () { boxes.forEach(function (b) { b.checked = false; }); chosen = []; apply(); });
  if (search) search.addEventListener('input', function (e) { recount(); if (e.isTrusted) { remember(); count(); } });
  list.addEventListener('change', function (e) { if (e.target.classList.contains('sel-box')) count(); });
  list.addEventListener('toggle', count, true);
  var selAll = document.querySelector('.sel-all');
  if (selAll) selAll.addEventListener('click', function () { rows().forEach(function (r) { var b = r.querySelector('.sel-box'); if (b && shown(r)) b.checked = true; }); count(); });

  // Sorting: a heading keeps the filters, tags and search in the address.
  document.querySelectorAll('[data-sort]').forEach(function (a) { a.addEventListener('click', function (e) {
    e.preventDefault();
    var u = new URL(location.href), k = a.dataset.sort;
    var dir = u.searchParams.get('sort') === k && u.searchParams.get('dir') !== 'desc' ? 'desc' : 'asc';
    u.searchParams.set('sort', k); u.searchParams.set('dir', dir);
    location.href = tidy(u);
  }); });

  // Forms that come back to this list keep its address (sort, filters, tags, search).
  document.querySelectorAll('.list-tools form, #bulk-bar').forEach(function (f) {
    f.addEventListener('submit', function () { var b = f.querySelector('[name=back]'); if (b) b.value = location.pathname + location.search; });
  });

  // The Filter box: one row per condition, read from and written to the address (f=field:how:value).
  var fbox = document.querySelector('.ff-box');
  if (fbox) {
    var holder = fbox.querySelector('.ff-rows'), add = fbox.querySelector('.ff-add');
    var names = { any: 'is any of', has: 'contains', btw: 'is between', yes: 'is ticked (yes)', no: 'is not ticked (no)', empty: 'is empty', set: 'is not empty' };
    var opsOf = { any: ['any'], text: ['has'], num: ['btw'], date: ['btw'], bool: ['yes', 'no'] };
    fields.forEach(function (f) { if (f.f) { var o = el('option', '', f.l); o.value = f.k; add.appendChild(o); } });
    function addRow(f, op, value) {
      var row = el('div', 'ff-row'); row.dataset.k = f.k; row.dataset.kind = f.f;
      var head = el('div', 'ff-head'); head.appendChild(el('b', '', f.l));
      var sel = el('select', 'ff-op'); sel.setAttribute('aria-label', f.l + ': how to match');
      opsOf[f.f].concat(f.f === 'bool' ? [] : ['empty', 'set']).forEach(function (o) { var x = el('option', '', names[o]); x.value = o; sel.appendChild(x); });
      if (op) sel.value = op;
      var del = el('button', 'sm plain ff-del', 'Remove'); del.type = 'button'; del.setAttribute('aria-label', 'Remove the condition on ' + f.l);
      del.addEventListener('click', function () { row.remove(); });
      head.appendChild(sel); head.appendChild(del); row.appendChild(head);
      var vals = el('div', 'ff-vals'); row.appendChild(vals);
      function draw(v) {
        vals.innerHTML = '';
        var o = sel.value;
        if (o === 'any') {
          var on = (v || '').split('|');
          (f.o || []).forEach(function (c) { var l = el('label', 'check'), i = el('input'); i.type = 'checkbox'; i.value = c; i.checked = on.indexOf(c) !== -1; l.appendChild(i); l.appendChild(document.createTextNode(' ' + c)); vals.appendChild(l); });
        } else if (o === 'has') {
          var t = el('input'); t.type = 'text'; t.value = v || ''; t.setAttribute('aria-label', f.l + ' contains'); vals.appendChild(t);
        } else if (o === 'btw') {
          var p = (v || '').split('..');
          ['From', 'To'].forEach(function (w, n) {
            var i = el('input'); i.type = f.f === 'date' ? 'date' : 'number'; if (f.f === 'num') i.step = 'any';
            i.value = p[n] || ''; i.setAttribute('aria-label', f.l + ': ' + w.toLowerCase()); i.placeholder = w;
            if (n) vals.appendChild(el('span', 'small', ' and '));
            vals.appendChild(i);
          });
        }
      }
      sel.addEventListener('change', function () { draw(''); });
      draw(value);
      holder.appendChild(row);
      var first = vals.querySelector('input') || sel; if (!op) first.focus();
    }
    params.getAll('f').forEach(function (raw) {
      var p = raw.split(':'), f = fieldOf(p[0]);
      if (f && f.f) addRow(f, p[1], p.slice(2).join(':'));
    });
    add.addEventListener('change', function () { var f = fieldOf(add.value); if (f) addRow(f); add.value = ''; });
    fbox.addEventListener('submit', function (e) {
      e.preventDefault();
      var u = new URL(location.href); u.searchParams.delete('f');
      holder.querySelectorAll('.ff-row').forEach(function (row) {
        var op = row.querySelector('.ff-op').value, v = '';
        if (op === 'any') v = Array.prototype.filter.call(row.querySelectorAll('.ff-vals input'), function (i) { return i.checked; }).map(function (i) { return i.value; }).join('|');
        else if (op === 'has') v = row.querySelector('.ff-vals input').value.trim();
        else if (op === 'btw') { var i = row.querySelectorAll('.ff-vals input'); v = i[0].value + '..' + i[1].value; if (v === '..') v = ''; }
        if (['any', 'has', 'btw'].indexOf(op) !== -1 && !v) return;
        u.searchParams.append('f', row.dataset.k + ':' + op + (v ? ':' + v : ''));
      });
      location.href = tidy(u);
    });
  }

  if (bar) {
    // "Change a field": the value to set, as on the Edit page.
    var pickF = bar.querySelector('.bf-field'), valBox = bar.querySelector('.bf-val'), go = bar.querySelector('.bf-go');
    fields.forEach(function (f) { if (f.b) { var o = el('option', '', f.l); o.value = f.k; pickF.appendChild(o); } });
    pickF.addEventListener('change', function () {
      valBox.innerHTML = '';
      var f = fieldOf(pickF.value); go.disabled = !f;
      if (!f) return;
      var input;
      if (f.t === 'pick' || f.t === 'owner' || f.t === 'bool') {
        input = el('select');
        var opts = f.t === 'bool' ? [['1', 'Yes (ticked)'], ['', 'No (not ticked)']] : (f.req ? [] : [['', '— empty —']]).concat((f.o || []).map(function (c) { return [c, c]; }));
        opts.forEach(function (o) { var x = el('option', '', o[1]); x.value = o[0]; input.appendChild(x); });
      } else if (f.t === 'multi') {
        input = el('span', 'bf-multi');
        input.appendChild(el('span', 'small', 'Set to exactly: '));
        (f.o || []).forEach(function (c) { var l = el('label', 'check'), i = el('input'); i.type = 'checkbox'; i.name = f.k; i.value = c; l.appendChild(i); l.appendChild(document.createTextNode(' ' + c)); input.appendChild(l); });
      } else {
        input = el('input');
        input.type = f.t === 'date' ? 'date' : ['int', 'num', 'money'].indexOf(f.t) !== -1 ? 'number' : 'text';
        if (input.type === 'number') { input.step = f.step || (f.t === 'int' ? 1 : 'any'); if (f.min !== undefined) input.min = f.min; if (f.max !== undefined) input.max = f.max; }
        input.placeholder = 'Leave empty to clear it';
      }
      if (f.t !== 'multi') { input.name = f.k; input.setAttribute('aria-label', 'New value for ' + f.l); }
      valBox.appendChild(input);
    });
    bar.querySelector('.bulk-clear').addEventListener('click', function () { rows().forEach(function (r) { var b = r.querySelector('.sel-box'); if (b) b.checked = false; }); count(); });
    bar.addEventListener('submit', function (e) {
      var by = e.submitter;
      if (by && by.classList.contains('bf-go')) {
        var f = fieldOf(pickF.value);
        if (!f || !confirm('Change ' + f.l + ' on ' + ticked().length + ' record' + (ticked().length === 1 ? '' : 's') + '? Each record\\'s History will show the change.')) { e.preventDefault(); return; }
      }
      bar.querySelectorAll('input[name=ids]').forEach(function (i) { i.remove(); });
      ticked().forEach(function (id) { var i = el('input'); i.type = 'hidden'; i.name = 'ids'; i.value = id; bar.appendChild(i); });
    });
  }

  // Export CSV: the ticked rows, or else every row the filters, tags and search leave (also in closed groups).
  var ex = document.querySelector('.ex-form');
  if (ex) ex.addEventListener('submit', function () {
    ex.querySelectorAll('input[name=ids]').forEach(function (i) { i.remove(); });
    var ids = ticked();
    if (!ids.length) rows().forEach(function (r) { var b = r.querySelector('.sel-box'); if (b && !r.hidden) ids.push(b.value); });
    ids.forEach(function (id) { var i = el('input'); i.type = 'hidden'; i.name = 'ids'; i.value = id; ex.appendChild(i); });
  });
  apply();
});`;
