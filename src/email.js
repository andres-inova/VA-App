// Shared client and VA email (replaces Zoho CRM's email feature).
//
// Each admin clicks "Connect Gmail" once (Settings > Email) and signs in with their @inovalocal.com Google
// account. The app may then read that mailbox (read-only), but it saves ONLY emails to or from an address of a
// client, a client contact or a VA in the app. Every other email is never saved. Each person chooses whether
// the emails saved from their inbox are Shared with the team (all admins see them on the records) or Private
// (only they see them).
//
// How mail is read: right after connecting, the app looks through the last 90 days, searching for the record
// addresses a few at a time. After that it asks Gmail every few minutes what is new ("history"). Everything
// runs in small steps from the every-minute job, with a cap on Gmail requests per run, and continues where it
// stopped. The Google key (refresh token) is kept encrypted with the EMAIL_TOKEN_KEY secret and is never shown.

import { redirect, page } from './util.js';
import { allFields, loadFieldLayouts } from './fields.js';
import * as ev from './email-views.js';

// Google's addresses. Tests point these at a fake Google server with --var.
const google = (env) => ({
  auth: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  revoke: env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
  gmail: env.GMAIL_API_URL || 'https://gmail.googleapis.com',
});

const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const DOMAIN = '@inovalocal.com';
const CALLS_PER_RUN = 20;   // Gmail/Google requests per run, all inboxes together (Cloudflare's free plan allows 50)
const BACKFILL_DAYS = 90;   // how far back the first look goes
const SHORT_DAYS = 7;       // how far back to look again when Gmail's "what's new" mark is too old
const BODY_MAX = 20000;     // characters of plain text kept per email
const ADDRESS_BATCH = 8;    // record addresses per Gmail search
const MAX_TRIES = 3;        // a step that fails this many times is skipped
const STATE_MINUTES = 15;   // how long a "Connect Gmail" click stays valid
const RECORD_MODULES = ['clients', 'contacts', 'vas'];
const SKIP_LABELS = ['DRAFT', 'SPAM', 'TRASH', 'CHAT'];

// What is missing before Connect Gmail can work ([] = ready).
export function emailMissing(env) {
  const missing = [];
  if (!env.EMAIL_TOKEN_KEY) missing.push('EMAIL_TOKEN_KEY');
  if (!env.GMAIL_CLIENT_ID) missing.push('GMAIL_CLIENT_ID');
  if (!env.GMAIL_CLIENT_SECRET) missing.push('GMAIL_CLIENT_SECRET');
  return missing;
}
const ready = (env) => !emailMissing(env).length;

// ---- Encryption of the Google keys (AES-GCM, key made from the EMAIL_TOKEN_KEY secret) ----

async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(env.EMAIL_TOKEN_KEY).trim()));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
const fromBinary = (bin) => {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text)));
  const all = new Uint8Array(12 + ct.length);
  all.set(iv);
  all.set(ct, 12);
  return toBase64(all);
}
async function unseal(env, text) {
  const all = fromBinary(atob(text));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, await aesKey(env), all.subarray(12));
  return new TextDecoder().decode(plain);
}

// ---- Talking to Google ----

class Stop extends Error {}       // this run's Gmail requests are used up; continue next run
class Reconnect extends Error {}  // the connection no longer works; the person must connect again

async function googleToken(env, params) {
  const res = await fetch(google(env).token, {
    method: 'POST',
    body: new URLSearchParams({ client_id: String(env.GMAIL_CLIENT_ID).trim(), client_secret: String(env.GMAIL_CLIENT_SECRET).trim(), ...params }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok && Boolean(data.access_token), data, status: res.status };
}

async function revoke(env, token) {
  try {
    await fetch(google(env).revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
  } catch (err) {
    console.error(`Google revoke failed: ${err.message}`);
  }
}

// A short-lived access token for an inbox: the saved one while it is still good, otherwise a new one.
async function accessFor(ctx, inbox) {
  if (inbox._token) return inbox._token;
  if (inbox.access) {
    try {
      const a = JSON.parse(await unseal(ctx.env, inbox.access));
      if (a.expires > Date.now() + 120000) return (inbox._token = a.token);
    } catch { /* made with another key; get a new one */ }
  }
  if (!inbox.token) throw new Reconnect('Not connected.');
  let refresh;
  try {
    refresh = await unseal(ctx.env, inbox.token);
  } catch {
    throw new Reconnect('The saved Google connection could not be read (the EMAIL_TOKEN_KEY secret may have changed). Please click Connect Gmail again.');
  }
  if (ctx.calls >= ctx.limit) throw new Stop();
  ctx.calls++;
  const r = await googleToken(ctx.env, { refresh_token: refresh, grant_type: 'refresh_token' });
  if (!r.ok) {
    if (r.data.error === 'invalid_grant') throw new Reconnect('Google ended the connection (it was removed in the Google account, or the password changed). Please click Connect Gmail again.');
    throw new Error(`Google sign-in did not work (${r.status} ${r.data.error || ''}). The app tries again in a few minutes.`);
  }
  inbox._token = r.data.access_token;
  inbox.access = await seal(ctx.env, JSON.stringify({ token: r.data.access_token, expires: Date.now() + (Number(r.data.expires_in) || 3600) * 1000 }));
  inbox._accessChanged = true;
  return inbox._token;
}

function gmailProblem(status, text) {
  if (status === 403) return `Gmail refused (403). The connection may be missing permission to read email: click Connect Gmail again and tick the box that lets the app read email. (${text.slice(0, 200)})`;
  if (status === 429) return 'Gmail asked the app to slow down (429). It tries again in a few minutes.';
  if (status >= 500) return `Gmail had a problem on its side (${status}). The app tries again in a few minutes.`;
  return `Gmail answered ${status}: ${text.slice(0, 200)}`;
}

// One Gmail request for an inbox ("users/me/<path>"). Returns the JSON, or null when Gmail says 404.
async function gmail(ctx, inbox, path) {
  if (ctx.calls >= ctx.limit) throw new Stop();
  const token = await accessFor(ctx, inbox);
  if (ctx.calls >= ctx.limit) throw new Stop();
  ctx.calls++;
  const res = await fetch(`${google(ctx.env).gmail}/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (res.status === 401) {
    inbox._token = null;
    inbox.access = null;
    inbox._accessChanged = true;
    throw new Error('Gmail did not accept the sign-in (401). The app tries again in a few minutes.');
  }
  if (!res.ok) throw new Error(gmailProblem(res.status, await res.text()));
  return res.json();
}

// ---- Reading emails ----

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const unentity = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => {
  if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()];
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(n); } catch { return m; }
  }
  return m;
});

// Header values written as =?UTF-8?B?...?= (accented letters in names and subjects).
function decodeWords(v) {
  if (!v || !v.includes('=?')) return v || '';
  return v.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=(\s+(?==\?))?/g, (m, cs, enc, txt) => {
    try {
      const bin = enc.toUpperCase() === 'B' ? atob(txt) : txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16)));
      return new TextDecoder(cs).decode(fromBinary(bin));
    } catch {
      return m;
    }
  });
}

// Every email address in a header value, lowercase.
const addressesIn = (text) => String(text || '').toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) || [];

function headersOf(part) {
  const h = {};
  for (const x of part?.headers || []) {
    const k = x.name.toLowerCase();
    if (!(k in h)) h[k] = decodeWords(x.value || '');
  }
  return h;
}

// Gmail's base64url text, decoded with the part's character set. Only the first ~60 KB are read.
function decodeData(data, charset) {
  let s = String(data || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (s.length > 80000) s = s.slice(0, 80000);
  s = s.slice(0, s.length - (s.length % 4 === 1 ? 1 : 0));
  while (s.length % 4) s += '=';
  let bytes;
  try { bytes = fromBinary(atob(s)); } catch { return ''; }
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

function htmlToText(html) {
  return unentity(String(html).slice(0, 200000)
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The plain text of an email (or its HTML turned into text) and its attachments (names and sizes only).
function readParts(payload) {
  let plain = null;
  let html = null;
  const files = [];
  const walk = (part, depth) => {
    if (!part || depth > 8) return;
    const type = (part.mimeType || '').toLowerCase();
    if (part.filename) {
      if (files.length < 20) files.push({ p: part.partId || '', n: part.filename.slice(0, 200), s: part.body?.size || 0, t: type.slice(0, 100) });
    } else if (type === 'text/plain' && plain === null && part.body?.data) {
      plain = part;
    } else if (type === 'text/html' && html === null && part.body?.data) {
      html = part;
    }
    for (const p of part.parts || []) walk(p, depth + 1);
  };
  walk(payload, 0);
  const charset = (part) => (/charset="?([^";\s]+)/i.exec(headersOf(part)['content-type'] || '') || [])[1];
  let text = '';
  if (plain) text = decodeData(plain.body.data, charset(plain));
  else if (html) text = htmlToText(decodeData(html.body.data, charset(html)));
  text = text.replace(/\r\n?/g, '\n').trim();
  if (text.length > BODY_MAX) text = `${text.slice(0, BODY_MAX)}\n\n[… The rest of this email is only in Gmail.]`;
  return { text, files };
}

// ---- Which records an email belongs to ----

const cleanAddress = (v) => (addressesIn(v)[0] || '');

// Every record address (client emails, contact emails, VA emails) and the records that have it.
// Addresses of admins and of connected inboxes never count (they are on almost every email).
export async function recordAddresses(env) {
  await loadFieldLayouts(env);
  const keys = Object.fromEntries(RECORD_MODULES.map((m) => [m, allFields(m).filter((x) => x.type === 'email').map((x) => x.key)]));
  const [{ results }, { results: own }] = await Promise.all([
    env.DB.prepare("SELECT id, module, data FROM records WHERE module IN ('clients', 'contacts', 'vas')").all(),
    env.DB.prepare('SELECT email FROM users WHERE is_admin = 1 UNION SELECT email FROM email_inboxes').all(),
  ]);
  const skip = new Set(own.map((r) => (r.email || '').toLowerCase()));
  const map = new Map();
  for (const r of results) {
    const d = JSON.parse(r.data);
    for (const k of keys[r.module]) {
      const a = cleanAddress(d[k]);
      if (!a || skip.has(a)) continue;
      if (!map.has(a)) map.set(a, new Set());
      map.get(a).add(r.id);
    }
  }
  return map;
}

// The addresses on one record (for a client: also its contacts').
async function addressesOfRecord(env, record) {
  const rows = [record];
  if (record.module === 'clients') {
    rows.push(...(await env.DB.prepare("SELECT id, module, data FROM records WHERE module = 'contacts' AND parent_id = ?").bind(record.id).all()).results);
  }
  const all = await recordAddresses(env);
  const ids = new Set(rows.map((r) => r.id));
  return [...all.entries()].filter(([, set]) => [...set].some((id) => ids.has(id))).map(([a]) => a);
}

// Gmail searches for a list of addresses, in groups, going back `days` days.
function searchJobs(addresses, days) {
  const d = new Date(Date.now() - days * 86400000);
  const after = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  const list = [...new Set(addresses)].filter((a) => /^[a-z0-9._%+'-]+@[a-z0-9.-]+$/.test(a)).sort();
  const jobs = [];
  for (let i = 0; i < list.length; i += ADDRESS_BATCH) {
    const part = list.slice(i, i + ADDRESS_BATCH);
    jobs.push({ t: 'list', q: `{${part.map((a) => `from:${a} to:${a} cc:${a} bcc:${a}`).join(' ')}} after:${after} -in:drafts -in:chats` });
  }
  return jobs;
}

// Message ids from the list that are not saved yet for this inbox.
async function notSaved(env, userId, ids) {
  if (!ids.length) return [];
  const { results } = await env.DB.prepare('SELECT gmail_id FROM emails WHERE user_id = ? AND gmail_id IN (SELECT value FROM json_each(?))')
    .bind(userId, JSON.stringify(ids)).all();
  const have = new Set(results.map((r) => r.gmail_id));
  return [...new Set(ids)].filter((id) => !have.has(id));
}

function matchRecords(h, addr) {
  const ids = new Set();
  for (const a of ['from', 'to', 'cc', 'bcc'].flatMap((k) => addressesIn(h[k]))) for (const id of addr.get(a) || []) ids.add(id);
  return ids;
}

// Saves one Gmail message (format=full) when it belongs to records. Returns true if it was saved now.
async function saveMessage(env, inbox, m, addr) {
  if ((m.labelIds || []).some((l) => SKIP_LABELS.includes(l))) return false;
  const h = headersOf(m.payload);
  const ids = matchRecords(h, addr);
  if (!ids.size) return false;
  const { text, files } = readParts(m.payload);
  const sent = Number(m.internalDate) ? new Date(Number(m.internalDate)).toISOString() : new Date(h.date || Date.now()).toISOString();
  const cut = (s, n) => (s || '').slice(0, n);
  const row = await env.DB.prepare(
    `INSERT INTO emails (user_id, gmail_id, thread_id, msg_id, sent_at, from_addr, to_addr, cc_addr, subject, snippet, body, attachments, outgoing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, gmail_id) DO NOTHING RETURNING id`
  ).bind(inbox.user_id, m.id, m.threadId || m.id, cut(h['message-id'], 300) || null, sent, cut(h.from, 500), cut(h.to, 2000), cut(h.cc, 2000),
    cut(h.subject, 500), cut(unentity(m.snippet), 300), text, files.length ? JSON.stringify(files) : null, (m.labelIds || []).includes('SENT') ? 1 : 0).first();
  if (!row) return false;
  await env.DB.batch([...ids].map((rid) => env.DB.prepare('INSERT OR IGNORE INTO email_links (email_id, record_id) VALUES (?, ?)').bind(row.id, rid)));
  return true;
}

const META = 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc';

// One step for an inbox. Returns the steps that come right after it.
async function runJob(ctx, inbox, job, addr) {
  const { env } = ctx;
  if (job.t === 'list') {
    const params = new URLSearchParams({ q: job.q, maxResults: '100' });
    if (job.page) params.set('pageToken', job.page);
    const data = (await gmail(ctx, inbox, `messages?${params}`)) || {};
    const ids = await notSaved(env, inbox.user_id, (data.messages || []).map((x) => x.id));
    return [...ids.map((id) => ({ t: 'msg', id })), ...(data.nextPageToken ? [{ t: 'list', q: job.q, page: data.nextPageToken }] : [])];
  }
  if (job.t === 'history') {
    const params = new URLSearchParams({ startHistoryId: job.start, historyTypes: 'messageAdded', maxResults: '100' });
    if (job.page) params.set('pageToken', job.page);
    const data = await gmail(ctx, inbox, `history?${params}`);
    if (!data) {
      // Gmail's mark is too old (Gmail keeps it about a week): start a new mark and look through the last days again.
      const profile = await gmail(ctx, inbox, 'profile');
      if (profile?.historyId) inbox.history_id = String(profile.historyId);
      return searchJobs([...addr.keys()], SHORT_DAYS);
    }
    const added = (data.history || []).flatMap((x) => x.messagesAdded || []).map((x) => x.message || {})
      .filter((x) => x.id && !(x.labelIds || []).some((l) => SKIP_LABELS.includes(l)));
    const ids = await notSaved(env, inbox.user_id, added.map((x) => x.id));
    if (data.nextPageToken) return [...ids.map((id) => ({ t: 'meta', id })), { t: 'history', start: job.start, page: data.nextPageToken }];
    if (data.historyId) inbox.history_id = String(data.historyId);
    return ids.map((id) => ({ t: 'meta', id }));
  }
  if (job.t === 'meta') {
    if (!(await notSaved(env, inbox.user_id, [job.id])).length) return [];
    const m = await gmail(ctx, inbox, `messages/${encodeURIComponent(job.id)}?${META}`);
    if (!m || (m.labelIds || []).some((l) => SKIP_LABELS.includes(l))) return [];
    return matchRecords(headersOf(m.payload), addr).size ? [{ t: 'msg', id: job.id }] : [];
  }
  if (job.t === 'msg') {
    if (!(await notSaved(env, inbox.user_id, [job.id])).length) return [];
    const m = await gmail(ctx, inbox, `messages/${encodeURIComponent(job.id)}?format=full`);
    if (m && (await saveMessage(env, inbox, m, addr))) ctx.saved++;
    return [];
  }
  return [];
}

// ---- The every-minute step ----

// Called from the every-minute job. Works on each connected inbox in turn until this run's Gmail
// requests are used up: first anything waiting in its queue, and every few minutes a check for new mail.
export async function syncEmail(env, now = new Date()) {
  if (!ready(env)) return null;
  const { results: inboxes } = await env.DB.prepare('SELECT * FROM email_inboxes WHERE token IS NOT NULL ORDER BY last_sync_at IS NOT NULL, last_sync_at').all();
  if (!inboxes.length) return null;

  const every = Number(env.EMAIL_CHECK_MINUTES ?? 5) * 60000;
  const work = [];
  for (const inbox of inboxes) {
    inbox.q = JSON.parse(inbox.queue || '[]');
    inbox.checked = false;
    const due = !inbox.checked_at || now - Date.parse(inbox.checked_at) >= every - 5000;
    if (due && inbox.history_id && !inbox.q.some((j) => j.t === 'history')) {
      inbox.q.unshift({ t: 'history', start: inbox.history_id });
      inbox.checked = true;
    }
    if (inbox.q.length) work.push(inbox);
  }
  if (!work.length) return null;

  // Only one run at a time (a run that crashed frees the lock after 2 minutes).
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('email_sync_busy', '0')").run();
  const claim = await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'email_sync_busy' AND value < ?")
    .bind(new Date(Date.now() + 120000).toISOString(), new Date().toISOString()).run();
  if (claim.meta.changes !== 1) return null;

  const ctx = { env, calls: 0, limit: CALLS_PER_RUN, saved: 0 };
  try {
    const addr = await recordAddresses(env);
    for (let i = 0; i < work.length && ctx.calls < CALLS_PER_RUN; i++) {
      const inbox = work[i];
      const share = Math.max(5, Math.floor((CALLS_PER_RUN - ctx.calls) / (work.length - i)));
      ctx.limit = Math.min(CALLS_PER_RUN, ctx.calls + share);
      let error = null;
      let reconnect = false;
      while (inbox.q.length && ctx.calls < ctx.limit) {
        const job = inbox.q[0];
        try {
          const next = await runJob(ctx, inbox, job, addr);
          inbox.q.splice(0, 1, ...next);
        } catch (err) {
          if (err instanceof Stop) break;
          if (err instanceof Reconnect) { reconnect = true; error = err.message; break; }
          error = String(err.message || err).slice(0, 500);
          job.n = (job.n || 0) + 1;
          if (job.n >= MAX_TRIES) {
            inbox.q.shift();
            error += ' (That step was skipped after 3 tries.)';
          }
          console.error(`Email sync for inbox ${inbox.user_id}: ${error}`);
          break;
        }
      }
      const at = now.toISOString();
      // Only the same connection is updated (not one that was disconnected or reconnected meanwhile).
      await env.DB.prepare(
        `UPDATE email_inboxes SET queue = ?, history_id = ?, access = ?, checked_at = ?, token = CASE WHEN ? THEN NULL ELSE token END,
           last_sync_at = CASE WHEN ? IS NULL THEN ? ELSE last_sync_at END, last_error = ?, last_error_at = CASE WHEN ? IS NULL THEN last_error_at ELSE ? END
         WHERE user_id = ? AND connected_at = ?`
      ).bind(reconnect ? '[]' : JSON.stringify(inbox.q), inbox.history_id, reconnect ? null : inbox.access, inbox.checked ? at : inbox.checked_at,
        reconnect ? 1 : 0, error, at, error, error, at, inbox.user_id, inbox.connected_at).run();
    }
  } finally {
    await env.DB.prepare("UPDATE settings SET value = '0' WHERE key = 'email_sync_busy'").run();
  }
  return { calls: ctx.calls, saved: ctx.saved };
}

// ---- What a record page shows ----

// The saved emails of some records that this person may see: Shared inboxes, and their own.
export async function recordEmails(env, user, recordIds) {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT e.id, e.user_id, e.gmail_id, e.thread_id, e.msg_id, e.sent_at, e.from_addr, e.to_addr, e.cc_addr, e.subject, e.snippet,
       e.attachments, e.outgoing, i.shared, i.email AS inbox_email, u.name AS owner_name
     FROM email_links l JOIN emails e ON e.id = l.email_id JOIN email_inboxes i ON i.user_id = e.user_id LEFT JOIN users u ON u.id = e.user_id
     WHERE l.record_id IN (SELECT value FROM json_each(?)) AND (i.shared = 1 OR e.user_id = ?)
     ORDER BY e.sent_at DESC LIMIT 301`
  ).bind(JSON.stringify(recordIds), user.id).all();
  const connected = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_inboxes WHERE token IS NOT NULL').first();
  return { emails: results.slice(0, 300), more: results.length > 300, connected: connected?.n || 0, ready: ready(env) };
}

// When a record is deleted: its links go, and emails that belonged only to deleted records are deleted too.
export async function forgetRecordEmails(env, recordIds) {
  const list = JSON.stringify(recordIds);
  const { results } = await env.DB.prepare('SELECT DISTINCT email_id FROM email_links WHERE record_id IN (SELECT value FROM json_each(?))').bind(list).all();
  const ids = JSON.stringify(results.map((r) => r.email_id));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_links WHERE record_id IN (SELECT value FROM json_each(?))').bind(list),
    env.DB.prepare('DELETE FROM emails WHERE id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM email_links l WHERE l.email_id = emails.id)').bind(ids),
  ]);
}

// ---- Pages and buttons ----

const BACK = /^\/admin\/(clients|contacts|vas)\/\d+$/;

async function visibleEmail(env, user, id) {
  const e = await env.DB.prepare(
    `SELECT e.*, i.shared, i.email AS inbox_email, i.token IS NOT NULL AS connected, u.name AS owner_name
     FROM emails e JOIN email_inboxes i ON i.user_id = e.user_id LEFT JOIN users u ON u.id = e.user_id WHERE e.id = ?`
  ).bind(id).first();
  return e && (e.shared || e.user_id === user.id) ? e : null;
}

async function deleteInbox(env, userId) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_links WHERE email_id IN (SELECT id FROM emails WHERE user_id = ?)').bind(userId),
    env.DB.prepare('DELETE FROM emails WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM email_inboxes WHERE user_id = ?').bind(userId),
  ]);
}

function decodeAll(data) {
  const s = String(data || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (typeof Uint8Array.fromBase64 === 'function') {
    try { return Uint8Array.fromBase64(s, { lastChunkHandling: 'loose' }); } catch { /* fall back */ }
  }
  let t = s;
  while (t.length % 4) t += '=';
  return fromBinary(atob(t));
}

export async function emailRoutes(env, user, path, method, field, message, url) {
  let m;
  const redirectUri = `${url.origin}/admin/email/callback`;

  // Settings > Email: who is connected, Shared or Private, last sync and problems.
  if (path === '/admin/email' && method === 'GET') {
    const { results: people } = await env.DB.prepare(
      `SELECT u.id, u.name, u.email AS login_email, i.email, i.token IS NOT NULL AS connected, i.shared, i.queue, i.connected_at, i.checked_at,
         i.last_sync_at, i.last_error, i.last_error_at, i.user_id AS has_inbox, (SELECT COUNT(*) FROM emails e WHERE e.user_id = u.id) AS saved
       FROM users u LEFT JOIN email_inboxes i ON i.user_id = u.id WHERE u.is_admin = 1 OR i.user_id IS NOT NULL ORDER BY u.name`
    ).all();
    for (const p of people) p.steps = p.queue ? JSON.parse(p.queue).length : 0;
    return page(ev.emailSettingsPage({ user, people, missing: emailMissing(env), redirectUri, message }));
  }

  // "Connect Gmail": remembers the click (so Google's answer can be checked), then goes to Google's sign-in.
  if (path === '/admin/email/connect' && method === 'POST') {
    if (!ready(env)) return redirect('/admin/email?msg=email-not-set-up');
    const share = field('share');
    if (!['shared', 'private'].includes(share)) return redirect('/admin/email?msg=email-choose-share#mine');
    const state = toBase64(crypto.getRandomValues(new Uint8Array(24))).replace(/[+/=]/g, '');
    const cutoff = new Date(Date.now() - STATE_MINUTES * 60000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM settings WHERE key LIKE 'email_state:%' AND json_extract(value, '$.at') < ?").bind(cutoff),
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(`email_state:${state}`, JSON.stringify({ u: user.id, share, at: new Date().toISOString() })),
    ]);
    const params = new URLSearchParams({
      client_id: String(env.GMAIL_CLIENT_ID).trim(), redirect_uri: redirectUri, response_type: 'code',
      scope: `${READ_SCOPE} openid email`, access_type: 'offline', prompt: 'consent', state, hd: DOMAIN.slice(1),
    });
    if ((user.email || '').toLowerCase().endsWith(DOMAIN)) params.set('login_hint', user.email.toLowerCase());
    return new Response(null, { status: 303, headers: { Location: `${google(env).auth}?${params}`, 'Cache-Control': 'no-store' } });
  }

  // Google sends the person back here after they sign in.
  if (path === '/admin/email/callback' && method === 'GET') {
    const state = url.searchParams.get('state') || '';
    const row = state ? await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(`email_state:${state}`).first() : null;
    if (row) await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(`email_state:${state}`).run();
    const saved = row ? JSON.parse(row.value) : null;
    if (!saved || saved.u !== user.id || Date.now() - Date.parse(saved.at) > STATE_MINUTES * 60000) return redirect('/admin/email?msg=email-bad-state');
    if (url.searchParams.get('error')) return redirect('/admin/email?msg=email-cancelled');
    if (!ready(env)) return redirect('/admin/email?msg=email-not-set-up');
    const code = url.searchParams.get('code');
    if (!code) return redirect('/admin/email?msg=email-google-failed');
    const t = await googleToken(env, { code, grant_type: 'authorization_code', redirect_uri: redirectUri });
    if (!t.ok) {
      console.error(`Connect Gmail: Google token exchange failed: ${t.status} ${t.data.error || ''}`);
      return redirect('/admin/email?msg=email-google-failed');
    }
    const refresh = t.data.refresh_token;
    const scopes = String(t.data.scope || '').split(/\s+/);
    if (!scopes.includes(READ_SCOPE)) {
      await revoke(env, refresh || t.data.access_token);
      return redirect('/admin/email?msg=email-no-read');
    }
    const res = await fetch(`${google(env).gmail}/gmail/v1/users/me/profile`, { headers: { Authorization: `Bearer ${t.data.access_token}` } });
    const profile = res.ok ? await res.json() : null;
    const email = String(profile?.emailAddress || '').toLowerCase();
    if (!profile) {
      console.error(`Connect Gmail: profile failed: ${res.status}`);
      return redirect('/admin/email?msg=email-google-failed');
    }
    if (!email.endsWith(DOMAIN)) {
      await revoke(env, refresh || t.data.access_token);
      return redirect('/admin/email?msg=email-wrong-domain');
    }
    if (!refresh) return redirect('/admin/email?msg=email-google-failed');
    const other = await env.DB.prepare('SELECT user_id FROM email_inboxes WHERE email = ? AND user_id != ? AND token IS NOT NULL').bind(email, user.id).first();
    if (other) return redirect('/admin/email?msg=email-taken');
    const now = new Date().toISOString();
    const access = await seal(env, JSON.stringify({ token: t.data.access_token, expires: Date.now() + (Number(t.data.expires_in) || 3600) * 1000 }));
    const queue = JSON.stringify(searchJobs([...(await recordAddresses(env)).keys()], BACKFILL_DAYS));
    await env.DB.prepare(
      `INSERT INTO email_inboxes (user_id, email, token, access, shared, history_id, queue, connected_at, checked_at, last_sync_at, last_error, last_error_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
       ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, token = excluded.token, access = excluded.access, shared = excluded.shared,
         history_id = excluded.history_id, queue = excluded.queue, connected_at = excluded.connected_at, checked_at = excluded.checked_at,
         last_error = NULL, last_error_at = NULL`
    ).bind(user.id, email, await seal(env, refresh), access, saved.share === 'shared' ? 1 : 0, String(profile.historyId || ''), queue, now, now).run();
    return redirect('/admin/email?msg=email-connected');
  }

  // Shared with the team or Private (one's own inbox only). Applies to every email saved from it.
  if (path === '/admin/email/share' && method === 'POST') {
    const share = field('share');
    if (!['shared', 'private'].includes(share)) return redirect('/admin/email?msg=email-choose-share#mine');
    await env.DB.prepare('UPDATE email_inboxes SET shared = ? WHERE user_id = ?').bind(share === 'shared' ? 1 : 0, user.id).run();
    return redirect('/admin/email?msg=email-share-saved');
  }

  // Disconnect (any admin may do it, for example for someone who left). Ends the connection at Google too.
  // With delete_emails=1 the inbox's saved emails are deleted.
  if (path === '/admin/email/disconnect' && method === 'POST') {
    const who = Number(field('user_id')) || user.id;
    const inbox = await env.DB.prepare('SELECT * FROM email_inboxes WHERE user_id = ?').bind(who).first();
    if (!inbox) return redirect('/admin/email');
    // Never revoke the app's own sending account: that would also stop the app's emails.
    if (inbox.token && ready(env) && inbox.email !== String(env.EMAIL_FROM || '').toLowerCase()) {
      try { await revoke(env, await unseal(env, inbox.token)); } catch { /* unreadable key: nothing to revoke */ }
    }
    if (field('delete_emails') === '1') {
      await deleteInbox(env, who);
      return redirect('/admin/email?msg=email-disconnected-deleted');
    }
    await env.DB.prepare("UPDATE email_inboxes SET token = NULL, access = NULL, queue = '[]', last_error = NULL WHERE user_id = ?").bind(who).run();
    return redirect('/admin/email?msg=email-disconnected');
  }

  // "Look for older emails" on a record: searches each connected inbox for its addresses (last 90 days).
  if (path === '/admin/emails/lookup' && method === 'POST') {
    const record = await env.DB.prepare("SELECT id, module, data FROM records WHERE id = ? AND module IN ('clients', 'contacts', 'vas')").bind(Number(field('record_id'))).first();
    if (!record) return redirect('/admin/clients');
    const back = `/admin/${record.module}/${record.id}`;
    const addresses = await addressesOfRecord(env, record);
    if (!addresses.length) return redirect(`${back}?msg=email-lookup-no-address#emails`);
    const { results: inboxes } = await env.DB.prepare('SELECT user_id, queue FROM email_inboxes WHERE token IS NOT NULL').all();
    if (!inboxes.length || !ready(env)) return redirect(`${back}?msg=email-lookup-none#emails`);
    const jobs = searchJobs(addresses, BACKFILL_DAYS);
    await env.DB.batch(inboxes.map((i) => {
      const q = JSON.parse(i.queue || '[]');
      const have = new Set(q.filter((j) => j.t === 'list' && !j.page).map((j) => j.q));
      return env.DB.prepare('UPDATE email_inboxes SET queue = ? WHERE user_id = ?').bind(JSON.stringify([...q, ...jobs.filter((j) => !have.has(j.q))]), i.user_id);
    }));
    return redirect(`${back}?msg=email-lookup-queued#emails`);
  }

  // One saved email, with its full text.
  if ((m = path.match(/^\/admin\/emails\/(\d+)$/)) && method === 'GET') {
    const e = await visibleEmail(env, user, Number(m[1]));
    if (!e) return redirect('/admin/clients?msg=email-gone');
    const { results: records } = await env.DB.prepare(
      'SELECT r.id, r.module, r.name FROM email_links l JOIN records r ON r.id = l.record_id WHERE l.email_id = ? ORDER BY r.name'
    ).bind(e.id).all();
    const back = BACK.test(url.searchParams.get('back') || '') ? url.searchParams.get('back') : null;
    return page(ev.emailPage({ user, email: e, records, back, message }));
  }

  // An attachment, opened live from the owner's Gmail.
  if ((m = path.match(/^\/admin\/emails\/(\d+)\/files\/(\d+)$/)) && method === 'GET') {
    const e = await visibleEmail(env, user, Number(m[1]));
    if (!e) return redirect('/admin/clients?msg=email-gone');
    const file = JSON.parse(e.attachments || '[]')[Number(m[2])];
    const fail = (text) => page(ev.attachmentProblem({ user, email: e, text }), 502);
    if (!file) return redirect(`/admin/emails/${e.id}`);
    if (!e.connected || !ready(env)) return fail(`${e.owner_name || 'The owner'}'s Gmail is not connected now, so attachments can't be opened. They can open it in Gmail.`);
    const inbox = await env.DB.prepare('SELECT * FROM email_inboxes WHERE user_id = ?').bind(e.user_id).first();
    const ctx = { env, calls: 0, limit: 4, saved: 0 };
    let bytes;
    try {
      const msg = await gmail(ctx, inbox, `messages/${encodeURIComponent(e.gmail_id)}?format=full`);
      if (!msg) return fail('This email is no longer in Gmail (it may have been deleted there).');
      let part = null;
      const walk = (p) => { if (!p || part) return; if (p.partId === file.p && p.filename) part = p; (p.parts || []).forEach(walk); };
      walk(msg.payload);
      if (!part) return fail('The attachment was not found in the email in Gmail.');
      let data = part.body?.data;
      if (!data && part.body?.attachmentId) {
        const a = await gmail(ctx, inbox, `messages/${encodeURIComponent(e.gmail_id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`);
        data = a?.data;
      }
      if (!data) return fail('Gmail did not send the attachment. Please open it in Gmail.');
      bytes = decodeAll(data);
    } catch (err) {
      return fail(err instanceof Reconnect ? err.message : `Gmail did not send the attachment: ${String(err.message || err).slice(0, 200)}`);
    } finally {
      if (inbox._accessChanged) await env.DB.prepare('UPDATE email_inboxes SET access = ? WHERE user_id = ? AND connected_at = ?').bind(inbox.access, inbox.user_id, inbox.connected_at).run();
    }
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.t || '') ? file.t : 'application/octet-stream';
    const inline = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/.test(type);
    return new Response(bytes, {
      headers: {
        'Content-Type': inline ? type : 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.n.replace(/[^\w .()-]/g, '_')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  return redirect('/admin/email');
}
