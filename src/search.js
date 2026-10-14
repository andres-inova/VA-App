// Search everything (admins): the box at the top of the menu opens /admin/search?q=... Results are grouped by kind:
// clients, contacts, VAs, applicants, notes, saved emails, projects and people (logins).
//
// How it searches: plain LIKE queries on D1, every word must match (capitals don't matter). Records are searched in
// records.search (see searchOf in fields.js: name, emails, phone, place, title, fields added on Settings > Fields,
// phones as digits only) plus their tag names and, for contacts, their client's name. records.search is kept up to
// date on every save; when what it holds changes (a new app version, or fields added or removed on Settings >
// Fields), the first search after that rebuilds it for all records once (ensureSearchText). For a few hundred
// records and a few thousand emails each query takes a few milliseconds, so no extra index is needed.

import { esc, page } from './util.js';
import { MODULES, searchOf } from './fields.js';
import { layout, icon, avatar, chip, section, empty, zohoTime } from './views.js';
import { nameIn } from './email-views.js';

// Raise this when searchOf changes, so the saved search text of every record is rebuilt once.
const SEARCH_VERSION = 2;
const SHOWN = 10;       // results per kind on the first page
const ALL = 200;        // results on "Show all"

// What the saved search text depends on: this version and the fields added on Settings > Fields.
const signature = () => JSON.stringify([SEARCH_VERSION, ...Object.keys(MODULES).map((k) => {
  const L = MODULES[k].layout;
  return Object.entries(L.custom).map(([key, c]) => `${key}:${c.type}:${L.hidden.includes(key) ? 'h' : ''}`).join(',');
})]);

// Writes the search text of every record (or of one kind) again, only where it changed. Two small queries per 200
// changed records. Called after each change on Settings > Fields, and by ensureSearchText.
export async function refreshSearchText(env, key = null) {
  const { results } = await (key
    ? env.DB.prepare('SELECT id, module, name, search, data FROM records WHERE module = ?').bind(key)
    : env.DB.prepare('SELECT id, module, name, search, data FROM records')).all();
  const changed = [];
  for (const r of results) {
    if (!MODULES[r.module]) continue;
    let data;
    try { data = JSON.parse(r.data); } catch { continue; }
    const s = searchOf(r.module, data, r.name);
    if (s !== r.search) changed.push({ id: r.id, s });
  }
  for (let i = 0; i < changed.length; i += 200) {
    await env.DB.prepare(
      `UPDATE records SET search = (SELECT json_extract(value, '$.s') FROM json_each(?1) WHERE json_extract(value, '$.id') = records.id)
       WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`
    ).bind(JSON.stringify(changed.slice(i, i + 200))).run();
  }
  return changed.length;
}

async function ensureSearchText(env) {
  const sig = signature();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'search_text'").first();
  if (row?.value === sig) return;
  await refreshSearchText(env);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('search_text', ?)").bind(sig).run();
}

// The typed words, each with the ways it may match. A phone-like search ("(512) 555", "555-0100") also matches the
// digits only. Every word must match.
export function searchTerms(q) {
  const text = String(q || '').trim().toLowerCase().slice(0, 100);
  if (!text) return [];
  const digits = (s) => s.replace(/\D/g, '');
  const phoneLike = (s) => /^[\d\s()+.-]+$/.test(s) && digits(s).length >= 3;
  if (/\s/.test(text) && phoneLike(text)) return [[text.replace(/\s+/g, ' '), digits(text)]];
  return text.split(/\s+/).slice(0, 8).map((w) => (phoneLike(w) && digits(w) !== w ? [w, digits(w)] : [w]));
}

// "expr LIKE ? AND (expr LIKE ? OR expr LIKE ?)" for the words, with the values to bind.
function matching(expr, terms) {
  const binds = [];
  const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const sql = terms.map((alts) => `(${alts.map((a) => { binds.push(like(a)); return `${expr} LIKE ? ESCAPE '\\'`; }).join(' OR ')})`).join(' AND ');
  return { sql, binds };
}

const KINDS = [
  ['clients', 'Clients'], ['contacts', 'Contacts'], ['vas', 'VAs'], ['applicants', 'Applicants'],
  ['notes', 'Notes'], ['emails', 'Emails'], ['projects', 'Projects'], ['people', 'People'],
];

async function findRecords(env, terms) {
  const m = matching('hay', terms);
  const { results } = await env.DB.prepare(
    `SELECT * FROM (
       SELECT r.id, r.module, r.name, r.status, r.parent_id, p.name AS parent_name, r.email,
         json_extract(r.data, '$.Phone') AS phone, json_extract(r.data, '$.Title') AS title, json_extract(r.data, '$.Location') AS location,
         lower(IFNULL(r.search, r.name) || ' ' || IFNULL(p.name, '') || ' ' || IFNULL(tg.names, '')) AS hay
       FROM records r
       LEFT JOIN records p ON p.id = r.parent_id AND r.module = 'contacts'
       LEFT JOIN (SELECT rt.record_id, group_concat(t.name, ' ') AS names FROM record_tags rt JOIN tags t ON t.id = rt.tag_id GROUP BY rt.record_id) tg ON tg.record_id = r.id
     ) WHERE ${m.sql} ORDER BY name COLLATE NOCASE LIMIT 2000`
  ).bind(...m.binds).all();
  return results;
}

async function findNotes(env, terms, limit) {
  const m = matching("lower(n.body || ' ' || r.name)", terms);
  return (await env.DB.prepare(
    `SELECT n.id, n.record_id, n.body, n.author, n.created_at, r.name, r.module, COUNT(*) OVER () AS total
     FROM record_notes n JOIN records r ON r.id = n.record_id WHERE ${m.sql} ORDER BY n.created_at DESC LIMIT ?`
  ).bind(...m.binds, limit).all()).results;
}

// Saved emails this admin may see, exactly as on record pages: from a Shared inbox, or from their own.
// The same email in two inboxes shows once.
async function findEmails(env, user, terms, limit) {
  const m = matching("lower(IFNULL(e.subject, '') || ' ' || IFNULL(e.from_addr, '') || ' ' || IFNULL(e.to_addr, '') || ' ' || IFNULL(e.snippet, ''))", terms);
  return (await env.DB.prepare(
    `SELECT e.id, e.sent_at, e.from_addr, e.subject, e.snippet, e.outgoing, i.shared,
       (SELECT json_object('module', r.module, 'id', r.id, 'name', r.name) FROM email_links l JOIN records r ON r.id = l.record_id
        WHERE l.email_id = e.id ORDER BY r.module = 'contacts' LIMIT 1) AS rec,
       COUNT(*) OVER () AS total
     FROM emails e JOIN email_inboxes i ON i.user_id = e.user_id
     WHERE (i.shared = 1 OR e.user_id = ?) AND ${m.sql}
     GROUP BY COALESCE(e.msg_id, 'id:' || e.id) ORDER BY e.sent_at DESC LIMIT ?`
  ).bind(user.id, ...m.binds, limit).all()).results;
}

async function findProjects(env, terms, limit) {
  const m = matching("lower(p.name || ' ' || IFNULL(p.client, ''))", terms);
  return (await env.DB.prepare(
    `SELECT p.id, p.name, p.active, p.client_record_id, COUNT(*) OVER () AS total FROM projects p WHERE ${m.sql}
     ORDER BY p.active DESC, p.name COLLATE NOCASE LIMIT ?`
  ).bind(...m.binds, limit).all()).results;
}

async function findPeople(env, terms, limit) {
  const m = matching("lower(u.name || ' ' || u.email)", terms);
  return (await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.is_admin, u.is_va, u.record_id, COUNT(*) OVER () AS total FROM users u WHERE ${m.sql}
     ORDER BY u.name COLLATE NOCASE LIMIT ?`
  ).bind(...m.binds, limit).all()).results;
}

export async function searchRoutes(env, user, url, message) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const only = KINDS.some(([k]) => k === url.searchParams.get('type')) ? url.searchParams.get('type') : null;
  const terms = searchTerms(q);
  const groups = new Map();
  if (terms.length) {
    await ensureSearchText(env);
    const limit = only ? ALL : SHOWN;
    const want = (k) => !only || only === k;
    if (['clients', 'contacts', 'vas', 'applicants'].some(want)) {
      for (const r of await findRecords(env, terms)) {
        if (!want(r.module)) continue;
        if (!groups.has(r.module)) groups.set(r.module, { total: 0, rows: [] });
        const g = groups.get(r.module);
        g.total++;
        if (g.rows.length < (only ? 2000 : SHOWN)) g.rows.push(r);
      }
    }
    const add = (k, rows) => { if (rows.length) groups.set(k, { total: rows[0].total, rows }); };
    if (want('notes')) add('notes', await findNotes(env, terms, limit));
    if (want('emails')) add('emails', await findEmails(env, user, terms, limit));
    if (want('projects')) add('projects', await findProjects(env, terms, limit));
    if (want('people')) add('people', await findPeople(env, terms, limit));
  }
  return page(searchPage({ user, q, terms, only, groups, message }));
}

// ---- The page ----

const TONE = { Current: 'good', Active: 'good', Paused: 'warn', 'On Deck': 'info', Offboarded: 'muted', 'n/a': 'muted', Hired: 'good', Declined: 'muted', Ghosted: 'muted' };

// The part of a note around the first word found.
function excerpt(text, terms) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const low = t.toLowerCase();
  let at = -1;
  for (const alts of terms) for (const a of alts) { const i = low.indexOf(a); if (i !== -1 && (at === -1 || i < at)) at = i; }
  const start = Math.max(0, at - 50);
  const part = t.slice(start, start + 180);
  return `${start ? '…' : ''}${part}${start + 180 < t.length ? '…' : ''}`;
}

const row = (href, lead, title, sub, side = '') => `<a class="item flat pick" href="${esc(href)}"><div class="item-head">${lead}
  <div class="grow"><div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${side}${icon('chevron', 'chev')}</div></a>`;

function rowOf(kind, r, terms) {
  if (['clients', 'contacts', 'vas', 'applicants'].includes(kind)) {
    const sub = [kind === 'contacts' ? r.parent_name || 'No client' : '', r.title, r.email, r.phone, r.location].filter(Boolean).map(esc).join(' · ');
    const status = kind === 'contacts' ? (r.status === 'Offboarded' ? chip('Offboarded', 'muted') : '') : chip(r.status === 'n/a' ? 'No status' : r.status, TONE[r.status] || 'info');
    return row(`/admin/${kind}/${r.id}`, avatar(r.name), esc(r.name), sub, status);
  }
  if (kind === 'notes') {
    return row(`/admin/${r.module}/${r.record_id}#notes`, `<span class="file-ic">${icon('note')}</span>`, `Note on ${esc(r.name)} <span class="small">(${esc(MODULES[r.module]?.one || r.module)})</span>`,
      `${esc(excerpt(r.body, terms))}<br>${esc([r.author, r.created_at && zohoTime(r.created_at.includes('T') ? r.created_at : `${r.created_at.replace(' ', 'T')}Z`)].filter(Boolean).join(' · '))}`);
  }
  if (kind === 'emails') {
    let rec = null;
    try { rec = r.rec ? JSON.parse(r.rec) : null; } catch { rec = null; }
    const back = rec && ['clients', 'contacts', 'vas'].includes(rec.module) ? `?back=${encodeURIComponent(`/admin/${rec.module}/${rec.id}`)}` : '';
    const sub = [nameIn(r.from_addr) + (r.outgoing ? ' (sent)' : ''), zohoTime(r.sent_at), rec && rec.name].filter(Boolean).map(esc).join(' · ');
    return row(`/admin/emails/${r.id}${back}`, `<span class="file-ic">${icon('mail')}</span>`, esc(r.subject || '(no subject)'),
      `${sub}<br><span class="mail-snippet">${esc(r.snippet || '')}</span>`, r.shared ? '' : chip('Private', 'muted'));
  }
  if (kind === 'projects') {
    return row(r.client_record_id ? `/admin/clients/${r.client_record_id}` : '/admin/projects', `<span class="file-ic">${icon('projects')}</span>`, esc(r.name),
      r.client_record_id ? 'Open the client' : 'No client yet: open the Projects page', r.active ? '' : chip('Not active', 'muted'));
  }
  // People (logins).
  const role = r.is_admin ? 'Admin' : r.is_va ? 'VA' : 'No VA access';
  return row(r.record_id ? `/admin/vas/${r.record_id}` : '/admin/people', avatar(r.name), esc(r.name), esc(r.email), chip(role, r.is_admin ? 'info' : 'muted'));
}

export function searchPage({ user, q, terms, only, groups, message }) {
  const link = (type) => `/admin/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`;
  const box = `<form class="search page-search" action="/admin/search" method="get" role="search">${icon('search')}
    <input id="page-search" type="search" name="q" value="${esc(q)}" placeholder="Search names, emails, phones, notes, emails…" aria-label="Search everything" autocomplete="off"${q ? '' : ' autofocus'}>
    ${only ? `<input type="hidden" name="type" value="${only}">` : ''}<button class="sm">Search</button></form>`;
  let body;
  if (!terms.length) {
    body = `<p class="lead">Search clients, contacts, VAs, applicants, notes and saved emails at once. Every word you type must match. Tip: press <kbd>/</kbd> on any page to jump to the search box.</p>${box}`;
  } else {
    const found = KINDS.filter(([k]) => groups.has(k));
    const total = found.reduce((n, [k]) => n + groups.get(k).total, 0);
    const sections = found.map(([k, label]) => {
      const g = groups.get(k);
      const more = !only && g.total > g.rows.length ? `<div class="actions" style="margin:6px 8px"><a class="btn sm plain" href="${esc(link(k))}">Show all ${g.total}</a></div>` : '';
      const cut = only && g.total > g.rows.length ? `<p class="small" style="margin:8px">Only the first ${g.rows.length} are shown. Type more words to find fewer.</p>` : '';
      return section({ title: label, count: g.total, key: `search-${k}`, body: g.rows.map((r) => rowOf(k, r, terms)).join('') + more + cut });
    }).join('');
    const kindLabel = only ? KINDS.find(([k]) => k === only)[1].toLowerCase() : '';
    body = `${box}
      ${only ? `<p class="lead"><a href="${esc(link(null))}">← All results for “${esc(q)}”</a></p>` : `<p class="lead">${total ? `${total} found for “${esc(q)}”.` : ''}</p>`}
      ${sections || `<div class="card">${empty(`Nothing ${only ? `in ${kindLabel} ` : ''}matches “${esc(q)}”. Check the spelling, or type fewer words.`)}</div>`}`;
  }
  return layout({ title: 'Search', user, active: '/admin/search', message, body });
}
