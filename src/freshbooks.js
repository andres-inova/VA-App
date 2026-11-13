// FreshBooks invoices for the client portal (piece C5).
//
// - One company-wide connection (Settings > FreshBooks, "Connect FreshBooks", read-only scopes). The keys are kept
//   encrypted with the EMAIL_TOKEN_KEY secret (the same one as the Gmail keys) and are never shown. FreshBooks gives a
//   NEW refresh token every time it is used, so the new one is saved right away.
// - An admin links each client record to its FreshBooks client (names and emails differ between the two).
// - About once an hour (and when a client is linked, or on "Sync now") the app copies the non-draft invoices of the
//   linked clients. A client sees only their own client's copied invoices on the Invoices page.
// - Secrets (set in Cloudflare, never in files or chat): FRESHBOOKS_CLIENT_ID, FRESHBOOKS_CLIENT_SECRET.
//   FRESHBOOKS_AUTH_URL / FRESHBOOKS_API_URL are for tests only (a fake FreshBooks).

import { redirect, page } from './util.js';
import { seal, unseal } from './email.js';
import * as fv from './freshbooks-views.js';

const SCOPES = 'user:profile:read user:invoices:read user:clients:read';
const STATE_MINUTES = 15;
const MAX_PAGES = 10;           // pages of 100 per request series (1,000 invoices or clients)
const CALLS_PER_RUN = 30;       // FreshBooks requests per run (Cloudflare's free plan allows 50 per run)

const urls = (env) => ({
  auth: env.FRESHBOOKS_AUTH_URL || 'https://auth.freshbooks.com/oauth/authorize/',
  api: (env.FRESHBOOKS_API_URL || 'https://api.freshbooks.com').replace(/\/$/, ''),
});

// What is missing before Connect FreshBooks can work ([] = ready).
export function freshbooksMissing(env) {
  const missing = [];
  if (!env.EMAIL_TOKEN_KEY) missing.push('EMAIL_TOKEN_KEY');
  if (!env.FRESHBOOKS_CLIENT_ID) missing.push('FRESHBOOKS_CLIENT_ID');
  if (!env.FRESHBOOKS_CLIENT_SECRET) missing.push('FRESHBOOKS_CLIENT_SECRET');
  return missing;
}
const ready = (env) => !freshbooksMissing(env).length;

class Reconnect extends Error {}   // the connection no longer works; an admin must connect again

// ---- Talking to FreshBooks ----

async function tokenRequest(env, params) {
  const res = await fetch(`${urls(env).api}/auth/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Version': 'alpha' },
    body: JSON.stringify({ client_id: String(env.FRESHBOOKS_CLIENT_ID).trim(), client_secret: String(env.FRESHBOOKS_CLIENT_SECRET).trim(), ...params }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok && Boolean(data.access_token), data, status: res.status };
}

const loadConnection = (env) => env.DB.prepare('SELECT * FROM freshbooks_connection WHERE id = 1').first();

// A usable access token: the saved one while it lasts, otherwise a new one (which also saves the new refresh token).
async function accessToken(env, conn, force = false) {
  if (!force && conn.access) {
    try {
      const a = JSON.parse(await unseal(env, conn.access));
      if (a.expires > Date.now() + 120000) return a.token;
    } catch { /* made with another key; get a new one */ }
  }
  if (!conn.token) throw new Reconnect('Not connected.');
  let refresh;
  try { refresh = await unseal(env, conn.token); } catch {
    throw new Reconnect('The saved FreshBooks connection could not be read (the EMAIL_TOKEN_KEY secret may have changed). Please click Connect FreshBooks again.');
  }
  const r = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh, redirect_uri: `${env.APP_URL}/admin/freshbooks/callback` });
  if (!r.ok) {
    // A run at the same moment may have used this refresh token already; its new key is in the database.
    const latest = await loadConnection(env);
    if (latest && latest.token !== conn.token) { Object.assign(conn, latest); return accessToken(env, conn); }
    if (r.status === 400 || r.status === 401) throw new Reconnect('FreshBooks ended the connection (it was removed in FreshBooks). Please click Connect FreshBooks again.');
    throw new Error(`FreshBooks sign-in did not work (${r.status}). The app tries again later.`);
  }
  const access = await seal(env, JSON.stringify({ token: r.data.access_token, expires: Date.now() + (Number(r.data.expires_in) || 3600) * 1000 }));
  const newRefresh = r.data.refresh_token ? await seal(env, r.data.refresh_token) : conn.token;
  await env.DB.prepare('UPDATE freshbooks_connection SET token = ?, access = ? WHERE id = 1').bind(newRefresh, access).run();
  conn.token = newRefresh; conn.access = access;
  return r.data.access_token;
}

// GET a FreshBooks address (starting with "/"). Returns the parsed JSON. ctx = { env, conn, calls }.
async function apiGet(ctx, path) {
  if (ctx.calls >= CALLS_PER_RUN) throw new Error('Too many FreshBooks requests in one run; the rest continues next time.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(ctx.env, ctx.conn, attempt === 1);
    ctx.calls++;
    const res = await fetch(`${urls(ctx.env).api}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Api-Version': 'alpha', Accept: 'application/json' } });
    if (res.status === 401 && attempt === 0) continue;
    if (res.status === 401) throw new Reconnect('FreshBooks refused the saved connection. Please click Connect FreshBooks again.');
    if (!res.ok) throw new Error(`FreshBooks answered ${res.status} for ${path.split('?')[0]}.`);
    return res.json();
  }
  throw new Error('FreshBooks did not answer.');
}

// The FreshBooks clients (active ones), for the "link a client" lists.
export async function listFbClients(ctx) {
  const out = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const data = await apiGet(ctx, `/accounting/account/${encodeURIComponent(ctx.conn.account_id)}/users/clients?per_page=100&page=${p}`);
    const r = data?.response?.result || {};
    for (const c of r.clients || []) if (!c.vis_state) out.push({ id: String(c.id), org: c.organization || '', name: [c.fname, c.lname].filter(Boolean).join(' '), email: c.email || '' });
    if (p >= (r.pages || 1)) break;
  }
  return out;
}

const money = (v) => { const n = parseFloat(v?.amount ?? v); return Number.isFinite(n) ? n : 0; };

// The line items, discount, taxes, notes and terms of one invoice, as JSON text for the invoice page.
function detailsOf(i) {
  const lines = (Array.isArray(i.lines) ? i.lines : []).map((l) => ({
    name: String(l.name || '').slice(0, 300), description: String(l.description || '').slice(0, 2000),
    qty: parseFloat(l.qty) || 0, unit: money(l.unit_cost), amount: money(l.amount),
    taxes: [[l.taxName1, l.taxAmount1], [l.taxName2, l.taxAmount2]].filter(([n, a]) => n && money(a)).map(([n, a]) => [String(n), money(a)]),
  }));
  return JSON.stringify({
    lines, discount: money(i.discount_total), notes: String(i.notes || '').slice(0, 4000), terms: String(i.terms || '').slice(0, 4000),
  });
}

// Copies the invoices of one FreshBooks client into freshbooks_invoices (drafts and deleted ones are left out, and
// removed from the copy if they were copied before).
async function syncClient(ctx, link) {
  const rows = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const data = await apiGet(ctx, `/accounting/account/${encodeURIComponent(ctx.conn.account_id)}/invoices/invoices?search%5Bcustomerid%5D=${encodeURIComponent(link.fb_client_id)}&include%5B%5D=lines&per_page=100&page=${p}&sort=create_date_desc`);
    const r = data?.response?.result || {};
    for (const i of r.invoices || []) {
      const status = String(i.v3_status || i.display_status || '').toLowerCase();
      if (status === 'draft' || Number(i.status) === 1 || (i.vis_state && Number(i.vis_state) !== 0)) continue;
      const links = i.direct_links && typeof i.direct_links === 'object' ? i.direct_links : {};
      const open = [links.client_view, links.view, links.pdf].find((u) => typeof u === 'string' && /^https:\/\//.test(u)) || null;
      rows.push({
        id: String(i.id || i.invoiceid), number: i.invoice_number || '', created: i.create_date || '', due: i.due_date || '',
        amount: money(i.amount), paid: money(i.paid), outstanding: money(i.outstanding), currency: i.amount?.code || i.currency_code || 'USD',
        status, link: open, updated: i.updated || '', details: detailsOf(i),
      });
    }
    if (p >= (r.pages || 1)) break;
  }
  const now = new Date().toISOString();
  const statements = rows.map((r) => ctx.env.DB.prepare(
    `INSERT INTO freshbooks_invoices (fb_invoice_id, fb_client_id, invoice_number, create_date, due_date, amount, paid, outstanding, currency, status, link, details, updated, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (fb_invoice_id) DO UPDATE SET fb_client_id = excluded.fb_client_id, invoice_number = excluded.invoice_number, create_date = excluded.create_date,
       due_date = excluded.due_date, amount = excluded.amount, paid = excluded.paid, outstanding = excluded.outstanding, currency = excluded.currency,
       status = excluded.status, link = excluded.link, details = excluded.details, updated = excluded.updated, synced_at = excluded.synced_at`
  ).bind(r.id, link.fb_client_id, r.number, r.created, r.due, r.amount, r.paid, r.outstanding, r.currency, r.status, r.link, r.details, r.updated, now));
  // Copied before, but not returned now (deleted or back to draft): remove from the copy.
  statements.push(ctx.env.DB.prepare(
    `DELETE FROM freshbooks_invoices WHERE fb_client_id = ? AND synced_at < ?`
  ).bind(link.fb_client_id, now));
  statements.push(ctx.env.DB.prepare('UPDATE freshbooks_links SET synced_at = ? WHERE client_record_id = ?').bind(now, link.client_record_id));
  for (let i = 0; i < statements.length; i += 50) await ctx.env.DB.batch(statements.slice(i, i + 50));
  return rows.length;
}

// The hourly job (also "Sync now" and right after a client is linked). only = one client record id. Returns a short text.
export async function syncFreshbooks(env, { only = null } = {}) {
  if (!ready(env)) return 'not set up';
  const conn = await loadConnection(env);
  if (!conn) return 'not connected';
  const { results: links } = only
    ? await env.DB.prepare('SELECT * FROM freshbooks_links WHERE client_record_id = ?').bind(only).all()
    : await env.DB.prepare('SELECT * FROM freshbooks_links ORDER BY synced_at IS NOT NULL, synced_at LIMIT 12').all();
  const ctx = { env, conn, calls: 0 };
  let copied = 0, error = null;
  try {
    for (const link of links) copied += await syncClient(ctx, link);
  } catch (err) {
    error = err.message;
    console.error(`FreshBooks sync failed: ${err.stack || err.message}`);
    if (err instanceof Reconnect) {
      await env.DB.prepare('UPDATE freshbooks_connection SET token = NULL, access = NULL WHERE id = 1').run();
    }
  }
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE freshbooks_connection SET last_sync_at = CASE WHEN ?1 IS NULL THEN ?2 ELSE last_sync_at END, last_error = ?1, last_error_at = CASE WHEN ?1 IS NULL THEN last_error_at ELSE ?2 END WHERE id = 1')
    .bind(error, now).run();
  return error ? `problem: ${error}` : `${copied} invoices of ${links.length} clients`;
}

// ---- Settings > FreshBooks (admins) ----

const normal = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(llc|inc|co|corp|company|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

// The FreshBooks client that looks like this client record (by name or by a contact's email), or null.
function suggest(fbClients, record, emails) {
  const n = normal(record.name);
  return fbClients.find((c) => normal(c.org) === n)
    || fbClients.find((c) => c.email && emails.has(c.email.toLowerCase()))
    || fbClients.find((c) => normal(c.org) && (normal(c.org).includes(n) || n.includes(normal(c.org))))
    || null;
}

export async function freshbooksRoutes(env, user, path, method, field, message, url) {
  const redirectUri = `${url.origin}/admin/freshbooks/callback`;

  if (path === '/admin/freshbooks' && method === 'GET') {
    const conn = await loadConnection(env);
    const { results: clients } = await env.DB.prepare(
      `SELECT r.id, r.name, r.status, l.fb_client_id, l.fb_name, l.synced_at,
         (SELECT COUNT(*) FROM freshbooks_invoices i WHERE i.fb_client_id = l.fb_client_id) AS invoices
       FROM records r LEFT JOIN freshbooks_links l ON l.client_record_id = r.id WHERE r.module = 'clients' AND r.status != 'Offboarded' ORDER BY r.name COLLATE NOCASE`
    ).all();
    let fbClients = null, fbError = null, suggestions = new Map();
    if (conn?.token && ready(env)) {
      try {
        const ctx = { env, conn, calls: 0 };
        fbClients = await listFbClients(ctx);
        const { results: contacts } = await env.DB.prepare("SELECT parent_id, email FROM records WHERE module = 'contacts' AND parent_id IS NOT NULL AND email IS NOT NULL").all();
        for (const c of clients) {
          if (c.fb_client_id) continue;
          const emails = new Set(contacts.filter((x) => x.parent_id === c.id).map((x) => x.email.toLowerCase()));
          const s = suggest(fbClients, c, emails);
          if (s) suggestions.set(c.id, s.id);
        }
      } catch (err) {
        fbError = err.message;
      }
    }
    return page(fv.settingsPage({ user, conn, missing: freshbooksMissing(env), redirectUri, clients, fbClients, fbError, suggestions, message }));
  }

  if (path === '/admin/freshbooks/connect' && method === 'POST') {
    if (!ready(env)) return redirect('/admin/freshbooks?msg=freshbooks-not-set-up');
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const state = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
    const cutoff = new Date(Date.now() - STATE_MINUTES * 60000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM settings WHERE key LIKE 'freshbooks_state:%' AND json_extract(value, '$.at') < ?").bind(cutoff),
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(`freshbooks_state:${state}`, JSON.stringify({ u: user.id, at: new Date().toISOString() })),
    ]);
    const params = new URLSearchParams({ response_type: 'code', client_id: String(env.FRESHBOOKS_CLIENT_ID).trim(), redirect_uri: redirectUri, scope: SCOPES, state });
    return new Response(null, { status: 303, headers: { Location: `${urls(env).auth}?${params}`, 'Cache-Control': 'no-store' } });
  }

  // FreshBooks sends the person back here after they sign in and allow the app.
  if (path === '/admin/freshbooks/callback' && method === 'GET') {
    const state = url.searchParams.get('state') || '';
    const row = state ? await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(`freshbooks_state:${state}`).first() : null;
    if (row) await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(`freshbooks_state:${state}`).run();
    const saved = row ? JSON.parse(row.value) : null;
    if (!saved || saved.u !== user.id || Date.now() - Date.parse(saved.at) > STATE_MINUTES * 60000) return redirect('/admin/freshbooks?msg=freshbooks-bad-state');
    if (url.searchParams.get('error')) return redirect('/admin/freshbooks?msg=freshbooks-cancelled');
    if (!ready(env)) return redirect('/admin/freshbooks?msg=freshbooks-not-set-up');
    const code = url.searchParams.get('code');
    if (!code) return redirect('/admin/freshbooks?msg=freshbooks-failed');
    const t = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    if (!t.ok || !t.data.refresh_token) {
      console.error(`Connect FreshBooks: token exchange failed: ${t.status}`);
      return redirect('/admin/freshbooks?msg=freshbooks-failed');
    }
    const me = await fetch(`${urls(env).api}/auth/api/v1/users/me`, { headers: { Authorization: `Bearer ${t.data.access_token}`, 'Api-Version': 'alpha', Accept: 'application/json' } });
    const body = me.ok ? await me.json().catch(() => null) : null;
    const memberships = body?.response?.business_memberships || [];
    const membership = memberships.find((m) => m.role === 'owner' && m.business?.account_id) || memberships.find((m) => m.business?.account_id);
    if (!membership) {
      console.error(`Connect FreshBooks: no business found (${me.status})`);
      return redirect('/admin/freshbooks?msg=freshbooks-no-business');
    }
    const now = new Date().toISOString();
    const access = await seal(env, JSON.stringify({ token: t.data.access_token, expires: Date.now() + (Number(t.data.expires_in) || 3600) * 1000 }));
    await env.DB.prepare(
      `INSERT INTO freshbooks_connection (id, account_id, business_name, token, access, connected_by, connected_at, last_error, last_error_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, NULL, NULL)
       ON CONFLICT (id) DO UPDATE SET account_id = excluded.account_id, business_name = excluded.business_name, token = excluded.token, access = excluded.access,
         connected_by = excluded.connected_by, connected_at = excluded.connected_at, last_error = NULL, last_error_at = NULL`
    ).bind(String(membership.business.account_id), membership.business.name || '', await seal(env, t.data.refresh_token), access, user.id, now).run();
    return redirect('/admin/freshbooks?msg=freshbooks-connected');
  }

  if (path === '/admin/freshbooks/disconnect' && method === 'POST') {
    const conn = await loadConnection(env);
    if (conn?.token && ready(env)) {
      try {
        await fetch(`${urls(env).api}/auth/oauth/revoke`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: String(env.FRESHBOOKS_CLIENT_ID).trim(), client_secret: String(env.FRESHBOOKS_CLIENT_SECRET).trim(), token: await unseal(env, conn.token) }),
        });
      } catch (err) { console.error(`FreshBooks revoke failed: ${err.message}`); }
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM freshbooks_connection WHERE id = 1'),
      env.DB.prepare('DELETE FROM freshbooks_invoices'),
    ]);
    return redirect('/admin/freshbooks?msg=freshbooks-disconnected');
  }

  if (path === '/admin/freshbooks/sync' && method === 'POST') {
    const result = await syncFreshbooks(env);
    return redirect(`/admin/freshbooks?msg=${result.startsWith('problem') ? 'freshbooks-sync-problem' : 'freshbooks-synced'}`);
  }

  // Link (or unlink) one client record.
  if (path === '/admin/freshbooks/link' && method === 'POST') {
    const clientId = Number(field('client_id'));
    const record = await env.DB.prepare("SELECT id, name FROM records WHERE id = ? AND module = 'clients'").bind(clientId).first();
    if (!record) return redirect('/admin/freshbooks');
    const fbId = field('fb_client_id');
    if (!fbId) {
      await env.DB.prepare('DELETE FROM freshbooks_links WHERE client_record_id = ?').bind(clientId).run();
      return redirect('/admin/freshbooks?msg=freshbooks-unlinked');
    }
    // One FreshBooks client belongs to one client record.
    const taken = await env.DB.prepare('SELECT client_record_id FROM freshbooks_links WHERE fb_client_id = ? AND client_record_id != ?').bind(fbId, clientId).first();
    if (taken) return redirect('/admin/freshbooks?msg=freshbooks-taken');
    const conn = await loadConnection(env);
    let fbName = field('fb_name').slice(0, 200);
    if (conn?.token && ready(env) && !fbName) {
      try { fbName = (await listFbClients({ env, conn, calls: 0 })).find((c) => c.id === fbId)?.org || ''; } catch { /* name is only for display */ }
    }
    await env.DB.prepare(
      `INSERT INTO freshbooks_links (client_record_id, fb_client_id, fb_name, linked_by, linked_at, synced_at) VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT (client_record_id) DO UPDATE SET fb_client_id = excluded.fb_client_id, fb_name = excluded.fb_name, linked_by = excluded.linked_by, linked_at = excluded.linked_at, synced_at = NULL`
    ).bind(clientId, fbId, fbName || null, user.id, new Date().toISOString()).run();
    // Remove copies of an earlier link, then copy the invoices of the new one now.
    await env.DB.prepare('DELETE FROM freshbooks_invoices WHERE fb_client_id NOT IN (SELECT fb_client_id FROM freshbooks_links)').run();
    const result = await syncFreshbooks(env, { only: clientId });
    return redirect(`/admin/freshbooks?msg=${result.startsWith('problem') ? 'freshbooks-linked-problem' : 'freshbooks-linked'}`);
  }

  return redirect('/admin/freshbooks');
}

// ---- The client's Invoices page ----

export async function clientInvoicesRoutes(env, user, client, message, invoiceId = null) {
  const link = await env.DB.prepare('SELECT * FROM freshbooks_links WHERE client_record_id = ?').bind(client.id).first();
  if (invoiceId) {
    // One invoice page: only an invoice of the FreshBooks client linked to this client.
    const inv = link ? await env.DB.prepare('SELECT * FROM freshbooks_invoices WHERE fb_invoice_id = ? AND fb_client_id = ?').bind(invoiceId, link.fb_client_id).first() : null;
    return inv ? page(fv.invoicePage({ user, client, invoice: inv, back: '/client/invoices', admin: false, message })) : redirect('/client/invoices');
  }
  const { results: invoices } = link
    ? await env.DB.prepare('SELECT * FROM freshbooks_invoices WHERE fb_client_id = ? ORDER BY create_date DESC, invoice_number DESC LIMIT 200').bind(link.fb_client_id).all()
    : { results: [] };
  return page(fv.invoicesPage({ user, client, linked: Boolean(link), invoices, syncedAt: link?.synced_at || null, message }));
}
