// The admin Invoices page: every copied FreshBooks invoice of every linked client in one place (what is owed, what is
// overdue, by client), with filters and a CSV file. Read-only; the invoices are copied from FreshBooks about once an
// hour (see freshbooks.js), and a client sees only their own on their Invoices page.

import { layout, icon, chip, empty, zohoTime } from './views.js';
import { esc, page, redirect } from './util.js';
import { invoicePage } from './freshbooks-views.js';
import { ZONES, partsIn, formatDate } from './time.js';
import { toCsv } from './lists.js';

const PAGE_SIZE = 100;
const MAX_SHOW = 2000;
const MAX_CSV = 10000;
const STATUSES = [['all', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid']];

const link0 = (id) => `/admin/invoices?client=${id}`;
const money = (n, code = 'USD') => `${code && code !== 'USD' ? `${code} ` : '$'}${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Paid, Partly paid, Due or Overdue (same words as the client's page).
const stateOf = (i, today) => {
  if (i.outstanding <= 0.004) return ['Paid', 'good'];
  if (i.due_date && i.due_date < today) return ['Overdue', 'bad'];
  return i.paid > 0 ? ['Partly paid', 'warn'] : ['Due', 'info'];
};

export async function adminInvoicesRoutes(env, user, path, url, message) {
  const today = partsIn(ZONES.EST).date;
  const q = url.searchParams;
  const status = STATUSES.some(([k]) => k === q.get('status')) ? q.get('status') : 'all';
  const clientId = Number(q.get('client')) || 0;

  // The clients that have a FreshBooks link (for the filter and the "by client" list), and the connection state.
  const [conn, { results: linked }, unlinked] = await Promise.all([
    env.DB.prepare('SELECT business_name, last_sync_at, last_error, token IS NOT NULL AS connected FROM freshbooks_connection WHERE id = 1').first(),
    env.DB.prepare(
      `SELECT r.id, r.name, l.fb_client_id, l.synced_at FROM freshbooks_links l JOIN records r ON r.id = l.client_record_id ORDER BY r.name COLLATE NOCASE`
    ).all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM records r WHERE r.module = 'clients' AND r.status != 'Offboarded' AND NOT EXISTS (SELECT 1 FROM freshbooks_links l WHERE l.client_record_id = r.id)").first(),
  ]);
  const client = linked.find((c) => c.id === clientId) || null;

  let where = '1 = 1';
  const binds = [];
  if (client) { where += ' AND i.fb_client_id = ?'; binds.push(client.fb_client_id); }
  const statusSql = status === 'paid' ? ' AND i.outstanding <= 0.004'
    : status === 'open' ? ' AND i.outstanding > 0.004'
    : status === 'overdue' ? ' AND i.outstanding > 0.004 AND i.due_date IS NOT NULL AND i.due_date < ?' : '';
  const statusBinds = status === 'overdue' ? [today] : [];

  const listSql = `SELECT i.*, l.client_record_id, r.name AS client_name FROM freshbooks_invoices i
      JOIN freshbooks_links l ON l.fb_client_id = i.fb_client_id JOIN records r ON r.id = l.client_record_id
      WHERE ${where}${statusSql} ORDER BY i.create_date DESC, i.invoice_number DESC LIMIT ?`;

  const one = /^\/admin\/invoices\/(\d{1,20})$/.exec(path);
  if (one) {
    const inv = await env.DB.prepare(
      `SELECT i.*, l.client_record_id, r.name AS client_name FROM freshbooks_invoices i JOIN freshbooks_links l ON l.fb_client_id = i.fb_client_id
       JOIN records r ON r.id = l.client_record_id WHERE i.fb_invoice_id = ?`).bind(one[1]).first();
    if (!inv) return redirect('/admin/invoices');
    return page(invoicePage({ user, client: { id: inv.client_record_id, name: inv.client_name }, invoice: inv, back: link0(inv.client_record_id), admin: true, message }));
  }

  if (path === '/admin/invoices.csv') {
    const { results } = await env.DB.prepare(listSql).bind(...binds, ...statusBinds, MAX_CSV).all();
    const csv = toCsv([
      ['Client', 'Invoice', 'Issued', 'Due', 'Amount', 'Paid', 'Outstanding', 'Status', 'Currency'],
      ...results.map((i) => [i.client_name, i.invoice_number, i.create_date, i.due_date, i.amount, i.paid, i.outstanding, stateOf(i, today)[0], i.currency || 'USD']),
    ]);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="invoices.csv"', 'Cache-Control': 'private, no-store' } });
  }

  const show = Math.min(MAX_SHOW, Math.max(PAGE_SIZE, Math.ceil((Number(q.get('show')) || PAGE_SIZE) / PAGE_SIZE) * PAGE_SIZE));
  const [{ results: list }, { results: perClient }, totals] = await env.DB.batch([
    env.DB.prepare(listSql).bind(...binds, ...statusBinds, show + 1),
    // Per client: open balance, overdue balance and number of invoices (ignores the status filter).
    env.DB.prepare(
      `SELECT l.client_record_id AS id, r.name, COUNT(i.fb_invoice_id) AS n,
         COALESCE(SUM(CASE WHEN i.outstanding > 0.004 THEN i.outstanding END), 0) AS open,
         COALESCE(SUM(CASE WHEN i.outstanding > 0.004 AND i.due_date IS NOT NULL AND i.due_date < ?1 THEN i.outstanding END), 0) AS overdue
       FROM freshbooks_links l JOIN records r ON r.id = l.client_record_id LEFT JOIN freshbooks_invoices i ON i.fb_client_id = l.fb_client_id
       GROUP BY l.client_record_id ORDER BY open DESC, r.name COLLATE NOCASE`
    ).bind(today),
    env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN i.outstanding > 0.004 THEN i.outstanding END), 0) AS open,
         COALESCE(SUM(CASE WHEN i.outstanding > 0.004 AND i.due_date IS NOT NULL AND i.due_date < ?1 THEN i.outstanding END), 0) AS overdue,
         COALESCE(SUM(CASE WHEN i.outstanding > 0.004 THEN 1 END), 0) AS open_n,
         COALESCE(SUM(CASE WHEN i.outstanding > 0.004 AND i.due_date IS NOT NULL AND i.due_date < ?1 THEN 1 END), 0) AS overdue_n
       FROM freshbooks_invoices i WHERE ${where}`
    ).bind(today, ...binds),
  ]);
  const t = totals.results[0] || { n: 0, open: 0, overdue: 0, open_n: 0, overdue_n: 0 };
  const shown = list.slice(0, show);
  const more = list.length > show;

  const link = (changes = {}) => {
    const p = new URLSearchParams();
    const next = { client: client?.id || '', status, ...changes };
    for (const [k, v] of Object.entries(next)) if (v !== '' && v !== null && v !== undefined && !(k === 'status' && v === 'all')) p.set(k, String(v));
    const s = p.toString();
    return s ? `/admin/invoices?${s}` : '/admin/invoices';
  };
  const opt = (value, label, on) => `<option value="${esc(value)}" ${on ? 'selected' : ''}>${esc(label)}</option>`;

  const notConnected = !conn?.connected
    ? `<div class="card"><p class="meta" style="margin:0">FreshBooks is not connected${conn ? ' any more' : ' yet'}. ${conn?.last_error ? `${esc(conn.last_error)} ` : ''}<a href="/admin/freshbooks">Open Settings &gt; FreshBooks</a>${linked.length ? ' (the invoices below are the last copied ones)' : ''}.</p></div>` : '';
  const summary = `<div class="card hr-total"><p class="meta" style="margin:0">${client ? esc(client.name) : 'All linked clients'}</p>
      <div class="hr-big">${esc(money(t.open))}</div>
      <p class="meta" style="margin:0">owed on ${t.open_n} open invoice${t.open_n === 1 ? '' : 's'}${t.overdue_n ? ` · <b style="color:var(--bad)">${esc(money(t.overdue))} overdue</b> (${t.overdue_n})` : ''} · ${t.n} invoice${t.n === 1 ? '' : 's'} in all</p>
      <p class="small" style="margin:6px 0 0">${conn?.last_sync_at ? `Copied from FreshBooks ${esc(zohoTime(conn.last_sync_at))}.` : 'Not copied yet.'} About once an hour, or Sync now on <a href="/admin/freshbooks">Settings &gt; FreshBooks</a>.${unlinked.n ? ` ${unlinked.n} client${unlinked.n === 1 ? ' is' : 's are'} not linked to FreshBooks yet.` : ''}</p></div>`;

  const filters = `<form method="get" action="/admin/invoices" class="card"><input type="hidden" name="status" value="${esc(status)}">
      <label for="ai-client" style="margin-top:0">Client</label>
      <select id="ai-client" name="client" onchange="this.form.submit()">${opt('', 'All linked clients', !client)}${linked.map((c) => opt(c.id, c.name, client?.id === c.id)).join('')}</select></form>
      <nav class="pj-grid hr-ranges ta-ranges" aria-label="Status">${STATUSES.map(([k, label]) => `<a class="pj-btn ${k === status ? 'on' : ''}" href="${esc(link({ status: k, show: '' }))}" ${k === status ? 'aria-current="page"' : ''}><b>${esc(label)}</b></a>`).join('')}</nav>`;

  const byClient = !client && perClient.length > 1 ? `<div class="card"><h2>By client</h2>${perClient.map((c) => `<div class="item flat"><div class="item-head"><div class="grow">
      <div class="title"><a href="${esc(link({ client: c.id, status: 'all' }))}">${esc(c.name)}</a></div>
      <div class="sub">${c.n} invoice${c.n === 1 ? '' : 's'}${c.overdue > 0 ? ` · ${esc(money(c.overdue))} overdue` : ''}</div></div>
      <div style="text-align:right"><b>${esc(money(c.open))}</b><div class="small" style="margin:0">owed</div></div></div></div>`).join('')}</div>` : '';

  const row = (i) => {
    const [label, tone] = stateOf(i, today);
    return `<div class="item flat"><div class="item-head"><div class="grow">
      <div class="title"><a href="/admin/invoices/${esc(i.fb_invoice_id)}">Invoice ${esc(i.invoice_number || '')}</a> · <a href="/admin/clients/${i.client_record_id}">${esc(i.client_name)}</a></div>
      <div class="sub">${i.create_date ? `Issued ${esc(formatDate(i.create_date, true))}` : ''}${i.due_date ? ` · Due ${esc(formatDate(i.due_date, true))}` : ''}</div>
      ${i.outstanding > 0.004 && i.paid > 0 ? `<div class="sub">${esc(money(i.paid, i.currency))} paid · ${esc(money(i.outstanding, i.currency))} still due</div>` : ''}</div>
      <div style="text-align:right"><b>${esc(money(i.amount, i.currency))}</b><div>${chip(label, tone)}</div></div></div></div>`;
  };
  const csvLink = link({}).replace('/admin/invoices', '/admin/invoices.csv');
  const listCard = `<div class="card" id="list"><h2>Invoices</h2>
      ${client ? `<form method="post" action="/admin/view-as" style="margin:0 0 8px"><input type="hidden" name="client_id" value="${client.id}"><input type="hidden" name="to" value="invoices"><button class="sm plain">${icon('building')} View as ${esc(client.name)}</button></form>` : ''}
      ${shown.length ? shown.map(row).join('') : empty(linked.length ? 'No invoices match.' : 'No client is linked to FreshBooks yet. Link clients on <a href="/admin/freshbooks">Settings &gt; FreshBooks</a>.')}
      ${more ? `<a class="btn big-btn plain" href="${esc(link({ show: String(show + 100) }))}#list">Show more</a>` : ''}
      ${shown.length ? `<div class="actions"><a class="btn sm plain" href="${esc(csvLink)}" download>${icon('download')} Invoices (CSV)</a></div>` : ''}</div>`;

  return page(layout({ title: 'Invoices', user, active: '/admin/invoices', message, body: `${notConnected}${summary}${filters}${byClient}${listCard}` }));
}
