// Tags with folders on VAs, applicants and clients (like tags in GoHighLevel). Admins make folders and tags on
// Settings > Tags (changes are lines in field_log, module 'tags'), pick tags on a record page (each one a line in the
// record's history), and add or remove a tag on many records at once from the list pages. Admins only (index.js and
// records.js check it). Tables: tag_folders, tags, record_tags (see schema.sql).

import { redirect, page } from './util.js';
import * as tv from './tags-views.js';

const KEYS = tv.TAG_KEYS.map(([k]) => k);
const COLOURS = tv.COLOURS.map(([c]) => c);
const ONE = { vas: 'VA', applicants: 'applicant', clients: 'client' };
const cleanText = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// Every folder and tag (empty lists if the tables aren't there yet).
export async function loadTags(env) {
  try {
    const [{ results: folders }, { results: tags }] = await Promise.all([
      env.DB.prepare('SELECT * FROM tag_folders ORDER BY position, id').all(),
      env.DB.prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE').all(),
    ]);
    return { folders, tags };
  } catch {
    return { folders: [], tags: [] };
  }
}

// The tag ids of every record of one kind: Map record id -> [tag ids].
export async function tagsByRecord(env, key) {
  const map = new Map();
  try {
    const { results } = await env.DB.prepare('SELECT rt.record_id, rt.tag_id FROM record_tags rt JOIN records r ON r.id = rt.record_id WHERE r.module = ?').bind(key).all();
    for (const r of results) {
      if (!map.has(r.record_id)) map.set(r.record_id, []);
      map.get(r.record_id).push(r.tag_id);
    }
  } catch { /* no tag tables yet */ }
  return map;
}

// One record's tags, in folder order.
export function tagsOn(all, ids) {
  const set = new Set(ids);
  return tv.grouped(all).flatMap((g) => g.tags.filter((t) => set.has(t.id)));
}

// The statements that remove deleted records' tags (run with the rest of deleteRecords in records.js).
export const forgetRecordTags = (env, list) => env.DB.prepare('DELETE FROM record_tags WHERE record_id IN (SELECT value FROM json_each(?))').bind(list);

const log = (env, user, summary, now) => env.DB.prepare("INSERT INTO field_log (module, user_id, summary, at) VALUES ('tags', ?, ?, ?)").bind(user.id, summary, now);

// Is there another tag with this name in this folder (without capitals)?
async function nameTaken(env, name, folderId, exceptId = 0) {
  return env.DB.prepare('SELECT id, on_vas, on_applicants, on_clients FROM tags WHERE IFNULL(folder_id, 0) = ? AND lower(name) = lower(?) AND id != ?')
    .bind(folderId || 0, name, exceptId).first();
}

async function folderOf(env, id) {
  const n = Number(id) || 0;
  return n ? env.DB.prepare('SELECT * FROM tag_folders WHERE id = ?').bind(n).first() : null;
}

// ---- Settings > Tags ----

// One change from the Settings > Tags page. Returns { statements, summary } or { error }.
async function applyChange(env, user, field, fieldAll, now) {
  const op = field('op');
  if (op.startsWith('folder_')) {
    if (op === 'folder_add') {
      const name = cleanText(field('name'), 40);
      if (!name) return { error: 'Please type a name for the folder.' };
      if (await env.DB.prepare('SELECT id FROM tag_folders WHERE lower(name) = lower(?)').bind(name).first()) return { error: `There is already a folder called "${name}".` };
      const pos = await env.DB.prepare('SELECT IFNULL(MAX(position), 0) + 1 AS p FROM tag_folders').first();
      return { statements: [env.DB.prepare('INSERT INTO tag_folders (name, position, created_at) VALUES (?, ?, ?)').bind(name, pos.p, now)], summary: `Added the folder "${name}"` };
    }
    const f = await folderOf(env, field('id'));
    if (!f) return { error: 'That folder is not there any more.' };
    if (op === 'folder_rename') {
      const name = cleanText(field('name'), 40);
      if (!name) return { error: 'Please type a name for the folder.' };
      if (name === f.name) return { statements: [] };
      if (await env.DB.prepare('SELECT id FROM tag_folders WHERE lower(name) = lower(?) AND id != ?').bind(name, f.id).first()) return { error: `There is already a folder called "${name}".` };
      return { statements: [env.DB.prepare('UPDATE tag_folders SET name = ? WHERE id = ?').bind(name, f.id)], summary: `Renamed the folder "${f.name}" to "${name}"` };
    }
    if (op === 'folder_up' || op === 'folder_down') {
      const { results } = await env.DB.prepare('SELECT id FROM tag_folders ORDER BY position, id').all();
      const ids = results.map((r) => r.id);
      const i = ids.indexOf(f.id);
      const j = op === 'folder_up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return { statements: [] };
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { statements: ids.map((id, n) => env.DB.prepare('UPDATE tag_folders SET position = ? WHERE id = ?').bind(n + 1, id)),
        summary: `Moved the folder "${f.name}" ${op === 'folder_up' ? 'up' : 'down'}` };
    }
    if (op === 'folder_delete') {
      // Its tags move to "No folder", unless "No folder" already has a tag with the same name.
      const clash = await env.DB.prepare('SELECT a.name FROM tags a JOIN tags b ON b.folder_id IS NULL AND lower(b.name) = lower(a.name) WHERE a.folder_id = ?').bind(f.id).first();
      if (clash) return { error: `"No folder" already has a tag called "${clash.name}". Rename or move that tag first.` };
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags WHERE folder_id = ?').bind(f.id).first();
      return {
        statements: [env.DB.prepare('UPDATE tags SET folder_id = NULL WHERE folder_id = ?').bind(f.id), env.DB.prepare('DELETE FROM tag_folders WHERE id = ?').bind(f.id)],
        summary: `Deleted the folder "${f.name}"${n.n ? ` (its ${plural(n.n, 'tag')} moved to "No folder")` : ''}`,
      };
    }
    return { error: 'Unknown change.' };
  }

  // Tags.
  const types = fieldAll('types').filter((k) => KEYS.includes(k));
  const readTag = async (except) => {
    const name = cleanText(field('name'), 60);
    if (!name) return { error: 'Please type a name for the tag.' };
    const folderId = Number(field('folder')) || 0;
    const folder = folderId ? await folderOf(env, folderId) : null;
    if (folderId && !folder) return { error: 'That folder is not there any more.' };
    if (!types.length) return { error: 'Please tick at least one kind of record the tag can be used on.' };
    if (await nameTaken(env, name, folderId, except)) return { error: `"${folder ? folder.name : 'No folder'}" already has a tag called "${name}".` };
    const colour = COLOURS.includes(field('colour')) ? field('colour') : 'grey';
    return { name, folder, colour };
  };
  if (op === 'tag_add') {
    const t = await readTag(0);
    if (t.error) return t;
    return {
      statements: [env.DB.prepare('INSERT INTO tags (name, folder_id, colour, on_vas, on_applicants, on_clients, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(t.name, t.folder?.id || null, t.colour, ...KEYS.map((k) => (types.includes(k) ? 1 : 0)), now, user.id)],
      summary: `Added the tag "${t.name}" to "${t.folder ? t.folder.name : 'No folder'}"`,
    };
  }
  const tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(Number(field('id')) || 0).first();
  if (!tag) return { error: 'That tag is not there any more.' };
  const uses = await env.DB.prepare('SELECT r.module, COUNT(*) AS n FROM record_tags rt JOIN records r ON r.id = rt.record_id WHERE rt.tag_id = ? GROUP BY r.module').bind(tag.id).all();
  const usedOn = Object.fromEntries(uses.results.map((u) => [u.module, u.n]));
  if (op === 'tag_save') {
    const t = await readTag(tag.id);
    if (t.error) return t;
    // A kind of record can only be unticked when no record of that kind has the tag.
    for (const [k, label] of tv.TAG_KEYS) {
      if (!types.includes(k) && usedOn[k]) return { error: `${plural(usedOn[k], ONE[k])} ${usedOn[k] === 1 ? 'has' : 'have'} "${tag.name}", so it must stay usable on ${label.toLowerCase()}. Remove it from them first (tick them on the ${label === 'Applicants' ? 'Hiring' : label} page, then Remove tag).` };
    }
    const changes = [];
    const folders = await env.DB.prepare('SELECT id, name FROM tag_folders').all();
    const folderName = (id) => folders.results.find((f) => f.id === id)?.name || 'No folder';
    if (t.name !== tag.name) changes.push(`Renamed the tag "${tag.name}" to "${t.name}"`);
    if ((t.folder?.id || null) !== (tag.folder_id || null)) changes.push(`Moved "${t.name}" to "${folderName(t.folder?.id)}"`);
    if (t.colour !== tag.colour) changes.push(`Made "${t.name}" ${t.colour}`);
    const before = KEYS.filter((k) => tag[`on_${k}`]);
    if (before.join() !== KEYS.filter((k) => types.includes(k)).join()) {
      changes.push(`"${t.name}" can be used on ${tv.TAG_KEYS.filter(([k]) => types.includes(k)).map(([, l]) => l.toLowerCase()).join(', ')}`);
    }
    if (!changes.length) return { statements: [] };
    return {
      statements: [env.DB.prepare('UPDATE tags SET name = ?, folder_id = ?, colour = ?, on_vas = ?, on_applicants = ?, on_clients = ? WHERE id = ?')
        .bind(t.name, t.folder?.id || null, t.colour, ...KEYS.map((k) => (types.includes(k) ? 1 : 0)), tag.id)],
      summary: changes.join('; '),
    };
  }
  if (op === 'tag_delete') {
    const n = Object.values(usedOn).reduce((a, b) => a + b, 0);
    return {
      statements: [
        env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, at) SELECT record_id, ?, ?, ? FROM record_tags WHERE tag_id = ?')
          .bind(user.id, `Tag removed: ${tag.name} (the tag was deleted)`, now, tag.id),
        env.DB.prepare('DELETE FROM record_tags WHERE tag_id = ?').bind(tag.id),
        env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(tag.id),
      ],
      summary: `Deleted the tag "${tag.name}"${n ? ` (removed from ${plural(n, 'record')})` : ''}`,
    };
  }
  return { error: 'Unknown change.' };
}

async function settingsPage(env, user, { message = null, error = null } = {}, status = 200) {
  const all = await loadTags(env);
  const { results } = await env.DB.prepare('SELECT tag_id, COUNT(*) AS n FROM record_tags GROUP BY tag_id').all().catch(() => ({ results: [] }));
  const { results: log } = await env.DB.prepare(
    "SELECT l.summary, l.at, u.name AS user_name FROM field_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.module = 'tags' ORDER BY l.id DESC LIMIT 20"
  ).all().catch(() => ({ results: [] }));
  return page(tv.tagsPage({ user, ...all, counts: new Map(results.map((r) => [r.tag_id, r.n])), log, message, error }), status);
}

// Adds or removes one tag on many records of one kind: a line in each changed record's history. Returns how many
// records changed, or { error }.
async function bulkChange(env, user, key, ids, tag, add, now) {
  const list = JSON.stringify(ids);
  const which = `SELECT r.id FROM records r WHERE r.id IN (SELECT value FROM json_each(?1)) AND r.module = ?2 AND ${add ? 'NOT ' : ''}EXISTS (SELECT 1 FROM record_tags WHERE record_id = r.id AND tag_id = ?3)`;
  const summary = `Tag ${add ? 'added' : 'removed'}: ${tag.name}`;
  const res = await env.DB.batch([
    env.DB.prepare(`INSERT INTO record_history (record_id, user_id, summary, at) SELECT id, ?4, ?5, ?6 FROM (${which})`).bind(list, key, tag.id, user.id, summary, now),
    add
      ? env.DB.prepare(`INSERT OR IGNORE INTO record_tags (record_id, tag_id, added_by, added_at) SELECT id, ?3, ?4, ?6 FROM (${which})`).bind(list, key, tag.id, user.id, summary, now)
      : env.DB.prepare(`DELETE FROM record_tags WHERE tag_id = ?3 AND record_id IN (${which})`).bind(list, key, tag.id),
  ]);
  return res[1].meta?.changes || 0;
}

// Settings > Tags (GET and POST) and POST /admin/tags/bulk (from a list page).
export async function tagRoutes(env, user, path, method, field, fieldAll, message) {
  const now = new Date().toISOString();
  if (path === '/admin/tags/bulk' && method === 'POST') {
    const key = KEYS.includes(field('module')) ? field('module') : null;
    const back = /^\/admin\/(vas|clients|applicants)(\?[^#]*)?$/.test(field('back')) ? field('back') : `/admin/${key || 'vas'}`;
    const go = (msg) => redirect(`${back}${back.includes('?') ? '&' : '?'}msg=${msg}`);
    const ids = [...new Set(fieldAll('ids').map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2000);
    if (!key || !ids.length) return go('tags-none-selected');
    const tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(Number(field('tag')) || 0).first();
    if (!tag) return go('tag-missing');
    const add = field('op') !== 'remove';
    if (add && !tag[`on_${key}`]) return go('tag-not-allowed');
    const n = await bulkChange(env, user, key, ids, tag, add, now);
    return go(n ? (add ? 'tags-added' : 'tags-removed') : 'no-changes');
  }
  if (path !== '/admin/settings/tags') return redirect('/admin/settings/tags');
  if (method !== 'POST') return settingsPage(env, user, { message });
  const { statements, summary, error } = await applyChange(env, user, field, fieldAll, now);
  if (error) return settingsPage(env, user, { error }, 400);
  if (statements.length) await env.DB.batch([...statements, ...(summary ? [log(env, user, summary, now)] : [])]);
  const id = field('id');
  return redirect(`/admin/settings/tags?msg=saved${field('op').startsWith('tag_') && id && field('op') !== 'tag_delete' ? `#tg-${encodeURIComponent(id)}` : ''}`);
}

// POST /admin/{vas|applicants|clients}/{id}/tags from the picker on a record page: tick (tag, on = 1 or 0) or
// "Create tag" (new_name, new_folder, new_colour). Answers with JSON { ok, chips, picker } or { error }.
export async function recordTagChange(env, user, key, record, field) {
  if (!KEYS.includes(key)) return json({ error: "This kind of record can't have tags." }, 400);
  const now = new Date().toISOString();
  const statements = [];
  let tag;
  let add = field('on') === '1';
  const newName = cleanText(field('new_name'), 60);
  if (newName) {
    // A new tag, made here: usable on VAs and applicants (made on a VA or applicant) or on clients (made on a client).
    const folder = await folderOf(env, field('new_folder'));
    if (Number(field('new_folder')) && !folder) return json({ error: 'That folder is not there any more.' }, 400);
    const same = await nameTaken(env, newName, folder?.id || 0);
    if (same) {
      tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(same.id).first();
    } else {
      const colour = COLOURS.includes(field('new_colour')) ? field('new_colour') : 'grey';
      const on = key === 'clients' ? [0, 0, 1] : [1, 1, 0];
      tag = await env.DB.prepare('INSERT INTO tags (name, folder_id, colour, on_vas, on_applicants, on_clients, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
        .bind(newName, folder?.id || null, colour, ...on, now, user.id).first();
      statements.push(log(env, user, `Added the tag "${newName}" to "${folder ? folder.name : 'No folder'}" (on ${record.name}'s page)`, now));
    }
    add = true;
  } else {
    tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(Number(field('tag')) || 0).first();
    if (!tag) return json({ error: 'That tag is not there any more. Please reload the page.' }, 400);
  }
  if (add && !tag[`on_${key}`]) return json({ error: `"${tag.name}" can't be used on ${tv.TAG_KEYS.find(([k]) => k === key)[1].toLowerCase()}. Change that on Settings > Tags.` }, 400);
  const has = await env.DB.prepare('SELECT 1 AS x FROM record_tags WHERE record_id = ? AND tag_id = ?').bind(record.id, tag.id).first();
  if (add && !has) {
    statements.push(
      env.DB.prepare('INSERT OR IGNORE INTO record_tags (record_id, tag_id, added_by, added_at) VALUES (?, ?, ?, ?)').bind(record.id, tag.id, user.id, now),
      env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, at) VALUES (?, ?, ?, ?)').bind(record.id, user.id, `Tag added: ${tag.name}`, now),
    );
  } else if (!add && has) {
    statements.push(
      env.DB.prepare('DELETE FROM record_tags WHERE record_id = ? AND tag_id = ?').bind(record.id, tag.id),
      env.DB.prepare('INSERT INTO record_history (record_id, user_id, summary, at) VALUES (?, ?, ?, ?)').bind(record.id, user.id, `Tag removed: ${tag.name}`, now),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  const all = await loadTags(env);
  const { results } = await env.DB.prepare('SELECT tag_id FROM record_tags WHERE record_id = ?').bind(record.id).all();
  const ids = results.map((r) => r.tag_id);
  return json({ ok: true, chips: tv.tagChips(tagsOn(all, ids)), picker: newName ? tv.pickerList(key, all, new Set(ids)) : null });
}
