// Settings > Fields: admins change the fields of clients, contacts, VAs and applicants (like Modules and Fields in
// Zoho CRM). The built-in fields are in fields.js; the changes are one row per module in field_layouts (see
// normalLayout in fields.js), and each change is a line in field_log. Admins only (checked in index.js).

import { redirect, page, esc } from './util.js';
import { MODULES, CUSTOM_TYPES, normalLayout, fieldOf, isProtected, loadFieldLayouts } from './fields.js';
import { refreshSearchText } from './search.js';
import { layout, icon, section, empty, zohoTime, settingsTabs } from './views.js';

const KEYS = ['clients', 'contacts', 'vas', 'applicants'];
const TYPE_NAMES = Object.fromEntries([...CUSTOM_TYPES, ['int', 'Whole number'], ['money', 'Money'], ['tags', 'Tags'], ['owner', 'Admin'],
  ['lookup', 'Link to a record'], ['lookups', 'Links to records'], ['file', 'Files']]);
const MAX_CHOICES = 100;
const path$ = (k) => `$."${k}"`;

async function readLayout(env, key) {
  const row = await env.DB.prepare('SELECT data FROM field_layouts WHERE module = ?').bind(key).first();
  let L = {};
  try { L = JSON.parse(row?.data || '{}'); } catch { L = {}; }
  return normalLayout(key, L);
}

// Saves the layout and a line in the log (with any record updates in the same batch).
async function saveLayout(env, user, key, N, summary, extra = []) {
  const now = new Date().toISOString();
  await env.DB.batch([
    ...extra,
    env.DB.prepare('INSERT OR REPLACE INTO field_layouts (module, data, updated_at, updated_by) VALUES (?, ?, ?, ?)').bind(key, JSON.stringify(N), now, user.id),
    env.DB.prepare('INSERT INTO field_log (module, user_id, summary, at) VALUES (?, ?, ?, ?)').bind(key, user.id, summary, now),
  ]);
}

// A new custom field's key: cf_ and its label, never one that was used before.
function newKey(key, N, label) {
  const slug = label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'field';
  const taken = new Set([...N.used, ...MODULES[key].sections.flatMap((s) => s.fields.map((x) => x.key)), ...N.hidden, ...Object.keys(N.custom)]);
  let k = `cf_${slug}`;
  for (let n = 2; taken.has(k); n++) k = `cf_${slug}_${n}`;
  return k;
}

const cleanText = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
const choicesFrom = (text) => [...new Set(String(text || '').split('\n').map((c) => cleanText(c, 100)).filter(Boolean))].slice(0, MAX_CHOICES);
const swap = (list, i, j) => { if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]]; };

// Applies one change from the Fields page. Returns { summary, extra (record updates) } or { error }.
async function applyChange(env, user, key, N, field) {
  const op = field('op');
  const k = field('k');
  const sectionOf = (fk) => N.sections.find((s) => s.keys.includes(fk));
  const x = k ? fieldOf(key, N, k) : null;
  const locked = x ? isProtected(key, k) : false;
  const offerId = MODULES[key].sections.find((s) => s.offer)?.id;
  const name = x ? `"${x.label}"` : '';

  if (op.startsWith('sec_')) {
    if (op === 'sec_add') {
      const title = cleanText(field('title'), 60);
      if (!title) return { error: 'Please type a name for the section.' };
      N.sections.push({ id: `s${N.next}`, title, keys: [] });
      N.next += 1;
      return { summary: `Added the section "${title}"` };
    }
    const i = N.sections.findIndex((s) => s.id === field('id'));
    if (i < 0) return { error: 'That section is not there any more.' };
    const s = N.sections[i];
    if (op === 'sec_rename') {
      const title = cleanText(field('title'), 60);
      if (!title) return { error: 'Please type a name for the section.' };
      if (title === s.title) return { summary: null };
      const before = s.title;
      s.title = title;
      return { summary: `Renamed the section "${before}" to "${title}"` };
    }
    if (op === 'sec_up' || op === 'sec_down') {
      swap(N.sections, i, op === 'sec_up' ? i - 1 : i + 1);
      return { summary: `Moved the section "${s.title}" ${op === 'sec_up' ? 'up' : 'down'}` };
    }
    if (op === 'sec_delete') {
      if (MODULES[key].sections.find((t) => t.id === s.id && (t.score || t.offer)) || !/^s\d+$/.test(s.id)) return { error: 'Built-in sections can be renamed and moved, but not deleted.' };
      if (s.keys.length) return { error: 'Move or hide the fields in this section first.' };
      N.sections.splice(i, 1);
      return { summary: `Deleted the section "${s.title}"` };
    }
    return { error: 'Unknown change.' };
  }

  if (op === 'add') {
    const label = cleanText(field('label'), 80);
    const type = field('type');
    const hint = cleanText(field('hint'), 300);
    const s = N.sections.find((t) => t.id === field('section'));
    if (!label) return { error: 'Please type a name for the new field.' };
    if (!CUSTOM_TYPES.some(([t]) => t === type)) return { error: 'Please choose a type for the new field.' };
    if (!s || s.id === offerId) return { error: 'Please choose a section for the new field.' };
    const options = type === 'pick' || type === 'multi' ? choicesFrom(field('options')) : null;
    if (options && !options.length) return { error: 'Please type the choices, one per line.' };
    const nk = newKey(key, N, label);
    N.custom[nk] = { label, type, ...(hint ? { hint } : {}), ...(options ? { options } : {}) };
    N.used.push(nk);
    s.keys.push(nk);
    return { summary: `Added the field "${label}" (${TYPE_NAMES[type]}) to "${s.title}"` };
  }

  if (!x) return { error: 'That field is not there any more.' };

  if (op === 'label') {
    const label = cleanText(field('label'), 80);
    const hint = cleanText(field('hint'), 300);
    if (!label) return { error: 'Please type a name for the field.' };
    const changes = [];
    if (label !== x.label) changes.push(`Renamed ${name} to "${label}"`);
    if (hint !== (x.hint || '')) changes.push(`Changed the help text of "${label}"`);
    if (!changes.length) return { summary: null };
    N.over[k] = { ...(N.over[k] || {}), label, hint };
    return { summary: changes.join('; ') };
  }

  const s = sectionOf(k);
  if (op === 'up' || op === 'down') {
    if (!s) return { error: 'Show this field first.' };
    const i = s.keys.indexOf(k);
    swap(s.keys, i, op === 'up' ? i - 1 : i + 1);
    return { summary: `Moved ${name} ${op}` };
  }

  // Everything below changes more than the label: not for fields the app uses.
  if (locked) return { error: `${x.label} is used by the app, so only its name and help text can be changed.` };

  if (op === 'move') {
    const to = N.sections.find((t) => t.id === field('to'));
    if (!to || to.id === offerId || (s?.id === offerId)) return { error: 'Please choose another section.' };
    if (!s) return { error: 'Show this field first.' };
    if (to === s) return { summary: null };
    s.keys.splice(s.keys.indexOf(k), 1);
    to.keys.push(k);
    return { summary: `Moved ${name} to "${to.title}"` };
  }
  if (op === 'hide') {
    if (!s) return { summary: null };
    s.keys.splice(s.keys.indexOf(k), 1);
    N.hidden.push(k);
    return { summary: `Hid ${name}` };
  }
  if (op === 'show') {
    N.hidden = N.hidden.filter((h) => h !== k);
    return { summary: `Showed ${name} again` };
  }
  if (op === 'delete') {
    if (!N.custom[k]) return { error: 'Only fields added here can be deleted. Built-in fields can be hidden.' };
    delete N.custom[k];
    delete N.over[k];
    N.hidden = N.hidden.filter((h) => h !== k);
    N.sections.forEach((t) => { t.keys = t.keys.filter((y) => y !== k); });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM records WHERE module = ? AND json_type(data, ?) IS NOT NULL').bind(key, path$(k)).first();
    return {
      summary: `Deleted the field ${name} (and its values on ${n?.n || 0} record${n?.n === 1 ? '' : 's'})`,
      extra: [env.DB.prepare('UPDATE records SET data = json_remove(data, ?1) WHERE module = ?2 AND json_type(data, ?1) IS NOT NULL').bind(path$(k), key)],
    };
  }

  // Pick-list choices.
  if (!op.startsWith('choice_')) return { error: 'Unknown change.' };
  if (x.type !== 'pick' && x.type !== 'multi') return { error: 'This field has no choices.' };
  const options = [...(x.options || [])];
  const save = (summary, extra) => { N.over[k] = { ...(N.over[k] || {}), options }; return { summary, extra }; };
  const choice = cleanText(field('choice'), 100);
  if (op === 'choice_add') {
    if (!choice) return { error: 'Please type the new choice.' };
    if (options.includes(choice)) return { error: `"${choice}" is already a choice.` };
    if (options.length >= MAX_CHOICES) return { error: `A field can have up to ${MAX_CHOICES} choices.` };
    options.push(choice);
    return save(`Added the choice "${choice}" to ${name}`);
  }
  const i = options.indexOf(choice);
  if (i < 0) return { error: 'That choice is not there any more.' };
  if (op === 'choice_up' || op === 'choice_down') {
    swap(options, i, op === 'choice_up' ? i - 1 : i + 1);
    return save(`Moved the choice "${choice}" of ${name} ${op === 'choice_up' ? 'up' : 'down'}`);
  }
  if (op === 'choice_remove') {
    options.splice(i, 1);
    return save(`Removed the choice "${choice}" from ${name} (records that have it keep it)`);
  }
  if (op === 'choice_rename') {
    const to = cleanText(field('to'), 100);
    if (!to) return { error: 'Please type the new name of the choice.' };
    if (to === choice) return { summary: null };
    if (options.includes(to)) return { error: `"${to}" is already a choice.` };
    options[i] = to;
    // Records that have the old choice get the new one, with a line in their history. One statement each.
    const p = path$(k);
    const now = new Date().toISOString();
    const changes = JSON.stringify([{ f: k, from: choice, to }]);
    const has = x.type === 'pick' ? 'json_extract(records.data, ?1) = ?2' : 'EXISTS (SELECT 1 FROM json_each(records.data, ?1) WHERE value = ?2)';
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM records WHERE module = ?3 AND ${has}`).bind(p, choice, key).first();
    const extra = [
      env.DB.prepare(`INSERT INTO record_history (record_id, user_id, summary, changes, at) SELECT id, ?4, 'Choice renamed', ?5, ?6 FROM records WHERE module = ?3 AND ${has}`)
        .bind(p, choice, key, user.id, changes, now),
      x.type === 'pick'
        ? env.DB.prepare(`UPDATE records SET data = json_set(data, ?1, ?4) WHERE module = ?3 AND ${has}`).bind(p, choice, key, to)
        : env.DB.prepare(`UPDATE records SET data = json_set(data, ?1, json((SELECT json_group_array(CASE WHEN value = ?2 THEN ?4 ELSE value END) FROM json_each(records.data, ?1)))) WHERE module = ?3 AND ${has}`)
          .bind(p, choice, key, to),
    ];
    return save(`Renamed the choice "${choice}" of ${name} to "${to}" (changed on ${n?.n || 0} record${n?.n === 1 ? '' : 's'})`, extra);
  }
  return { error: 'Unknown change.' };
}

// How many records have a value in each field, and each choice.
async function usage(env, key) {
  const { results } = await env.DB.prepare('SELECT data FROM records WHERE module = ?').bind(key).all();
  const filled = {};
  const choices = {};
  for (const r of results) {
    let d;
    try { d = JSON.parse(r.data); } catch { continue; }
    for (const [k, v] of Object.entries(d)) {
      if (v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) continue;
      filled[k] = (filled[k] || 0) + 1;
      for (const c of Array.isArray(v) ? v : [v]) {
        if (typeof c !== 'string') continue;
        choices[k] = choices[k] || {};
        choices[k][c] = (choices[k][c] || 0) + 1;
      }
    }
  }
  return { filled, choices };
}

export async function fieldRoutes(env, user, path, method, field, message, url) {
  if (path !== '/admin/settings/fields') return redirect('/admin/settings/fields');
  const key = KEYS.includes(url.searchParams.get('m') || field('m')) ? (url.searchParams.get('m') || field('m')) : 'clients';
  await loadFieldLayouts(env);
  if (method === 'POST') {
    const N = await readLayout(env, key);
    const { summary, extra = [], error } = await applyChange(env, user, key, N, field);
    if (!error && summary) {
      await saveLayout(env, user, key, N, summary, extra);
      await loadFieldLayouts(env);
      // Values may have changed (a choice renamed, a field deleted or hidden): the global search text follows.
      await refreshSearchText(env, key);
    }
    if (error) return page(await fieldsPage(env, user, key, { error }), 400);
    const k = field('k');
    return redirect(`/admin/settings/fields?m=${key}&msg=saved${k ? `#fld-${encodeURIComponent(k)}` : ''}`);
  }
  return page(await fieldsPage(env, user, key, { message }));
}

// ---- The page ----

const form = (key, op, hidden, inner, confirm = '') => `<form method="post" action="/admin/settings/fields" class="inline-form"${confirm ? ` data-confirm="${esc(confirm)}"` : ''}>
  <input type="hidden" name="m" value="${key}"><input type="hidden" name="op" value="${op}">${Object.entries(hidden).map(([n, v]) => `<input type="hidden" name="${n}" value="${esc(v)}">`).join('')}${inner}</form>`;
const btn = (label, cls = 'sm plain', aria = '') => `<button class="${cls}"${aria ? ` aria-label="${esc(aria)}"` : ''}>${label}</button>`;

function choicesEditor(key, x, counts) {
  const opts = x.options || [];
  const rows = opts.map((c, i) => {
    const n = counts[c] || 0;
    return `<div class="fx-choice"><span class="grow">${esc(c)} <span class="small">${n ? `${n} record${n === 1 ? '' : 's'}` : ''}</span></span>
      ${i ? form(key, 'choice_up', { k: x.key, choice: c }, btn('↑', 'sm plain', `Move ${c} up`)) : ''}
      ${i < opts.length - 1 ? form(key, 'choice_down', { k: x.key, choice: c }, btn('↓', 'sm plain', `Move ${c} down`)) : ''}
      <details class="list-opts fx-ren"><summary>Rename</summary>${form(key, 'choice_rename', { k: x.key, choice: c },
        `<input type="text" name="to" value="${esc(c)}" aria-label="New name of ${esc(c)}" maxlength="100" required> ${btn('Rename', 'sm')}`,
        n ? `Rename "${c}"? The ${n} record${n === 1 ? '' : 's'} that have it will get the new name.` : '')}</details>
      ${form(key, 'choice_remove', { k: x.key, choice: c }, btn(icon('trash'), 'sm plain', `Remove ${c}`),
        n ? `${n} record${n === 1 ? ' has' : 's have'} "${c}". ${n === 1 ? 'It keeps' : 'They keep'} it, shown as "(old choice)". Remove it from the list?` : `Remove the choice "${c}"?`)}</div>`;
  }).join('');
  const old = Object.entries(counts).filter(([c]) => !opts.includes(c));
  return `<div class="fx-choices"><p class="small" style="margin:6px 0">Choices</p>${rows || '<p class="small">No choices yet.</p>'}
    ${old.length ? `<p class="small">Old choices still on records: ${old.map(([c, n]) => `${esc(c)} (${n})`).join(', ')}</p>` : ''}
    ${form(key, 'choice_add', { k: x.key }, `<div class="row"><input type="text" name="choice" placeholder="New choice" aria-label="New choice" maxlength="100" required><div style="flex:0">${btn(`${icon('plus')} Add choice`, 'sm')}</div></div>`)}</div>`;
}

function fieldRow(key, x, s, sections, i, count, use, offerId) {
  const locked = Boolean(x.locked);
  const n = use.filled[x.key] || 0;
  const sub = [TYPE_NAMES[x.type] || x.type, locked ? 'Used by the app' : x.custom ? 'Added here' : 'Built in', `${n} record${n === 1 ? '' : 's'} filled in`].join(' · ');
  const moves = s ? `${i ? form(key, 'up', { k: x.key }, btn('↑', 'sm plain', `Move ${x.label} up`)) : ''}${i < count - 1 ? form(key, 'down', { k: x.key }, btn('↓', 'sm plain', `Move ${x.label} down`)) : ''}` : '';
  const others = sections.filter((t) => t.id !== s?.id && t.id !== offerId);
  const more = [];
  more.push(form(key, 'label', { k: x.key }, `<label for="l-${esc(x.key)}">Name</label><input type="text" id="l-${esc(x.key)}" name="label" value="${esc(x.label)}" maxlength="80" required>
    <label for="h-${esc(x.key)}">Help text (optional)</label><input type="text" id="h-${esc(x.key)}" name="hint" value="${esc(x.hint || '')}" maxlength="300">
    <div class="actions">${btn('Save name', 'sm')}</div>`));
  if (!locked) {
    if (s && s.id !== offerId && others.length) {
      more.push(form(key, 'move', { k: x.key }, `<div class="row"><div><label for="m-${esc(x.key)}">Move to section</label><select id="m-${esc(x.key)}" name="to">${others.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}</select></div><div style="flex:0">${btn('Move', 'sm')}</div></div>`));
    }
    if (x.type === 'pick' || x.type === 'multi') more.push(choicesEditor(key, x, use.choices[x.key] || {}));
    more.push(`<div class="actions">${s ? form(key, 'hide', { k: x.key }, btn('Hide field', 'sm plain'), `Hide "${x.label}"? Its values are kept, and you can show it again.`) : form(key, 'show', { k: x.key }, btn('Show again', 'sm'))}
      ${x.custom ? form(key, 'delete', { k: x.key }, btn(`${icon('trash')} Delete field`, 'sm danger'),
        `Delete "${x.label}"? ${n ? `${n} record${n === 1 ? ' has a value' : 's have values'} in it, and ${n === 1 ? 'it' : 'they'} will be deleted too.` : 'No record has a value in it.'} This cannot be undone.`) : ''}</div>`);
  } else {
    more.push('<p class="small">Used by the app, so only its name and help text can be changed.</p>');
  }
  return `<div class="item flat" id="fld-${esc(x.key)}"><div class="item-head"><div class="grow">
      <div class="title">${locked ? `<span title="Used by the app" aria-label="Used by the app">${icon('lock')}</span> ` : ''}${esc(x.label)}</div>
      <div class="sub">${esc(sub)}</div></div>${moves}</div>
    <details class="list-opts"><summary>Change</summary><div class="fx-more">${more.join('')}</div></details></div>`;
}

async function fieldsPage(env, user, key, { message = null, error = null } = {}) {
  const mod = MODULES[key];
  const use = await usage(env, key);
  const { results: log } = await env.DB.prepare(
    'SELECT l.summary, l.at, u.name AS user_name FROM field_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.module = ? ORDER BY l.id DESC LIMIT 20'
  ).bind(key).all().catch(() => ({ results: [] }));
  const offerId = mod.sections.find((s) => s.offer)?.id;
  const builtIn = (s) => !/^s\d+$/.test(s.id);
  const secs = mod.sections.map((s, i) => {
    const rows = s.fields.map((x, j) => fieldRow(key, x, s, mod.sections, j, s.fields.length, use, offerId)).join('');
    const controls = `<div class="actions fx-sec">
      ${i ? form(key, 'sec_up', { id: s.id }, btn('↑ Move section up', 'sm plain')) : ''}
      ${i < mod.sections.length - 1 ? form(key, 'sec_down', { id: s.id }, btn('↓ Move section down', 'sm plain')) : ''}
      <details class="list-opts"><summary>Rename section</summary>${form(key, 'sec_rename', { id: s.id }, `<div class="row"><input type="text" name="title" value="${esc(s.title)}" maxlength="60" required aria-label="Section name"><div style="flex:0">${btn('Rename', 'sm')}</div></div>`)}</details>
      ${!builtIn(s) && !s.fields.length ? form(key, 'sec_delete', { id: s.id }, btn(`${icon('trash')} Delete section`, 'sm danger'), `Delete the section "${s.title}"?`) : ''}</div>`;
    return section({ title: s.title, count: s.fields.length, open: false, key: `fx-${key}-${s.id}`,
      hint: s.offer ? 'The offer checklist on an applicant. Its items are used by the app.' : '', body: `${rows || empty('No fields in this section.')}${controls}` });
  }).join('');
  const hidden = mod.hiddenFields;
  const add = `<form method="post" action="/admin/settings/fields" class="card">
    <h3 style="margin-top:0">Add a field</h3>
    <input type="hidden" name="m" value="${key}"><input type="hidden" name="op" value="add">
    <div class="form-grid">
      <div><label for="add-label">Name</label><input type="text" id="add-label" name="label" maxlength="80" required></div>
      <div><label for="add-type">Type</label><select id="add-type" name="type">${CUSTOM_TYPES.map(([t, l]) => `<option value="${t}">${esc(l)}</option>`).join('')}</select></div>
      <div><label for="add-section">Section</label><select id="add-section" name="section">${mod.sections.filter((s) => s.id !== offerId).map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}</select></div>
      <div><label for="add-hint">Help text (optional)</label><input type="text" id="add-hint" name="hint" maxlength="300"></div>
      <div class="wide"><label for="add-options">Choices, one per line (for a pick list or checkbox group)</label><textarea id="add-options" name="options" rows="4"></textarea></div>
    </div>
    <div class="actions">${btn(`${icon('plus')} Add field`, '')}</div></form>`;
  const addSec = `<form method="post" action="/admin/settings/fields" class="card">
    <input type="hidden" name="m" value="${key}"><input type="hidden" name="op" value="sec_add">
    <div class="row"><div><label for="sec-title" style="margin-top:0">Add a section</label><input type="text" id="sec-title" name="title" maxlength="60" required placeholder="Section name"></div>
    <div style="flex:0">${btn(`${icon('plus')} Add section`, 'sm')}</div></div></form>`;
  return layout({
    title: 'Fields', user, active: '/admin/settings', message,
    body: `${settingsTabs('/admin/settings/fields')}
    <style>.inline-form{display:inline-block;margin:0}.fx-more{padding:4px 0 10px}.fx-more form{margin:0 0 8px}.fx-choice{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 0;border-top:1px solid var(--line)}
    .fx-choice .grow{min-width:120px}.fx-ren{margin:0}.fx-sec{margin:8px}.fx-sec form{display:inline-block}.item-head .inline-form button{margin:0}</style>
    <p class="lead">The fields on client, contact, VA and applicant records. Changes show right away on every record and Edit page. Fields with a ${icon('lock')} are used by the app: only their name and help text can be changed.</p>
    <div class="chips proj-tabs">${KEYS.map((k) => `<a class="chip ${k === key ? 'on' : 'muted'}" href="/admin/settings/fields?m=${k}">${esc(MODULES[k].label)}</a>`).join('')}</div>
    ${error ? `<div class="toast bad" role="alert">${esc(error)}</div>` : ''}
    ${secs}
    ${add}${addSec}
    ${section({ title: 'Hidden fields', count: hidden.length, open: hidden.length > 0, key: `fx-${key}-hidden`,
      hint: 'Hidden fields are not shown on records or the Edit page. Their values are kept.',
      body: hidden.length ? hidden.map((x) => fieldRow(key, x, null, mod.sections, 0, 0, use, offerId)).join('') : empty('No hidden fields.') })}
    ${section({ title: 'Recent changes', count: log.length, open: false, key: `fx-${key}-log`, hint: `The last 20 changes to the ${esc(mod.label.toLowerCase())} fields.`,
      body: log.length ? log.map((l) => `<div class="item flat"><div class="item-head"><div class="grow"><div class="title">${esc(l.summary)}</div>
        <div class="sub">${esc(l.user_name || 'Someone')} · ${esc(zohoTime(l.at))}</div></div></div></div>`).join('') : empty('No changes yet.') })}`,
  });
}
