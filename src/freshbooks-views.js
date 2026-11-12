// The HTML of the FreshBooks pages (see freshbooks.js): Settings > FreshBooks for admins, and the client's Invoices page.

import { esc } from './util.js';
import { layout, icon, chip, section, empty, zohoTime, settingsTabs } from './views.js';
import { formatDate, partsIn, ZONES } from './time.js';

const money = (n, code = 'USD') => {
  const s = Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${code && code !== 'USD' ? `${code} ` : '$'}${s}`;
};

// ---- Settings > FreshBooks ----

export function settingsPage({ user, conn, missing, redirectUri, clients, fbClients, fbError, suggestions, message }) {
  const connected = Boolean(conn?.token);
  const setup = missing.length ? `<div class="card"><h2>Set up FreshBooks first</h2>
      <p class="meta">Missing in Cloudflare: <b>${missing.map(esc).join(', ')}</b>. Do these steps once:</p>
      <ol class="steps">
        <li>In FreshBooks, open <b>developer.freshbooks.com</b>, sign in and create a new app (name it "InoVA Local app").</li>
        <li>As the redirect (callback) address, paste exactly: <code>${esc(redirectUri)}</code></li>
        <li>Allow only these read-only permissions: <code>user:profile:read</code>, <code>user:invoices:read</code>, <code>user:clients:read</code>.</li>
        <li>FreshBooks shows a Client ID and a Client Secret. Save them in Cloudflare yourself (never paste them in chat or a file): in this project's folder run
          <code>npx wrangler secret put FRESHBOOKS_CLIENT_ID</code> and <code>npx wrangler secret put FRESHBOOKS_CLIENT_SECRET</code>, and paste each value when asked.</li>
        <li>Reload this page and click Connect FreshBooks.</li>
      </ol></div>` : '';

  const status = connected
    ? `<p class="meta">Connected to <b>${esc(conn.business_name || 'your FreshBooks account')}</b>${conn.connected_at ? ` on ${esc(zohoTime(conn.connected_at))}` : ''}. Read-only: the app can see clients and invoices, never change them.</p>
      <p class="meta">${conn.last_sync_at ? `Invoices last copied ${esc(zohoTime(conn.last_sync_at))}.` : 'Invoices not copied yet.'} The app copies them about once an hour.</p>
      ${conn.last_error ? `<div class="toast bad" style="display:block">${esc(conn.last_error)}${conn.last_error_at ? ` (${esc(zohoTime(conn.last_error_at))})` : ''}</div>` : ''}`
    : conn
      ? `<div class="toast bad" style="display:block">${conn.last_error ? esc(conn.last_error) : 'The FreshBooks connection ended. Please click Connect FreshBooks again.'}</div>`
      : '<p class="meta">Not connected yet.</p>';
  const buttons = missing.length ? '' : `<div class="actions">
      <form method="post" action="/admin/freshbooks/connect"><button class="${connected ? 'plain sm' : ''}">${icon('send')} ${connected ? 'Connect again' : 'Connect FreshBooks'}</button></form>
      ${connected ? `<form method="post" action="/admin/freshbooks/sync"><button class="sm">${icon('check')} Sync now</button></form>
      <form method="post" action="/admin/freshbooks/disconnect" data-confirm="Disconnect FreshBooks? Clients will no longer see invoices, and the copied invoices are deleted. Your links between clients stay."><button class="sm danger">Disconnect</button></form>` : ''}</div>`;

  const options = (current, suggested) => `<option value="">Not linked</option>${(fbClients || []).map((c) => `<option value="${esc(c.id)}" ${c.id === (current || suggested) ? 'selected' : ''}>${esc(c.org || c.name || c.email || c.id)}${c.email ? ` · ${esc(c.email)}` : ''}</option>`).join('')}`;
  const rows = clients.map((c) => {
    const sug = suggestions.get(c.id);
    const form = fbClients
      ? `<form method="post" action="/admin/freshbooks/link" class="row" style="align-items:flex-end"><input type="hidden" name="client_id" value="${c.id}">
          <div class="grow"><select name="fb_client_id" aria-label="FreshBooks client for ${esc(c.name)}">${options(c.fb_client_id, sug)}</select></div>
          <div style="flex:0"><button class="sm">${c.fb_client_id ? 'Save' : sug ? 'Link suggested' : 'Link'}</button></div></form>`
      : c.fb_client_id ? `<p class="small" style="margin:0">Linked to ${esc(c.fb_name || c.fb_client_id)}</p>` : '<p class="small" style="margin:0">Connect FreshBooks to link.</p>';
    return `<div class="item flat"><div class="item-head"><div class="grow"><div class="title"><a href="/admin/clients/${c.id}">${esc(c.name)}</a></div>
      <div class="sub">${c.fb_client_id ? `Linked: ${esc(c.fb_name || c.fb_client_id)} · ${c.invoices} invoice${c.invoices === 1 ? '' : 's'} copied${c.synced_at ? ` · ${esc(zohoTime(c.synced_at))}` : ''}` : sug ? 'A FreshBooks client looks like a match (pre-selected).' : 'Not linked: this client sees no invoices yet.'}</div></div>
      ${c.fb_client_id ? `<form method="post" action="/admin/view-as" style="margin:0"><input type="hidden" name="client_id" value="${c.id}"><input type="hidden" name="to" value="invoices"><button class="sm plain">View invoices as client</button></form>` : ''}
      ${c.fb_client_id ? chip('Linked', 'good') : chip('Not linked', 'muted')}</div>${form}</div>`;
  }).join('');

  return layout({
    title: 'FreshBooks', user, active: '/admin/settings', message,
    body: `${settingsTabs('/admin/freshbooks')}${setup}
      <div class="card"><h2>FreshBooks</h2>${status}${buttons}</div>
      ${fbError ? `<div class="toast bad" style="display:block">Could not load the FreshBooks clients: ${esc(fbError)}</div>` : ''}
      ${section({ title: 'Link clients to FreshBooks', count: clients.length, open: connected, hint: 'Choose the FreshBooks client of each client record. Names and emails can differ, so check each match. A client sees only the invoices of the FreshBooks client linked here.', body: clients.length ? rows : empty('No clients yet.') })}`,
  });
}

// ---- The client's Invoices page ----

export function invoicesPage({ user, client, linked, invoices, syncedAt, message }) {
  const today = partsIn(ZONES.EST).date;
  const state = (i) => {
    if (i.outstanding <= 0.004) return ['Paid', 'good'];
    if (i.due_date && i.due_date < today) return ['Overdue', 'bad'];
    return i.paid > 0 ? ['Partly paid', 'warn'] : ['Due', 'info'];
  };
  const open = invoices.filter((i) => i.outstanding > 0.004);
  const owed = open.reduce((t, i) => t + i.outstanding, 0);
  const code = invoices[0]?.currency || 'USD';
  const summary = `<div class="card hr-total"><p class="meta" style="margin:0">Balance due</p>
      <div class="hr-big">${esc(money(owed, code))}</div>
      <p class="meta" style="margin:0">${open.length ? `${open.length} open invoice${open.length === 1 ? '' : 's'}` : 'Nothing is due. Thank you!'}</p></div>`;
  const row = (i) => {
    const [label, tone] = state(i);
    return `<div class="item flat"><div class="item-head"><div class="grow">
        <div class="title">${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener">Invoice ${esc(i.invoice_number || '')}</a>` : `Invoice ${esc(i.invoice_number || '')}`}</div>
        <div class="sub">${i.create_date ? `Issued ${esc(formatDate(i.create_date, true))}` : ''}${i.due_date ? ` · Due ${esc(formatDate(i.due_date, true))}` : ''}</div>
        ${i.outstanding > 0.004 && i.paid > 0 ? `<div class="sub">${esc(money(i.paid, i.currency))} paid · ${esc(money(i.outstanding, i.currency))} still due</div>` : ''}</div>
        <div style="text-align:right"><b>${esc(money(i.amount, i.currency))}</b><div>${chip(label, tone)}</div></div></div></div>`;
  };
  const body = !linked
    ? `<div class="card"><h2>Invoices</h2><p class="lead">Your invoices will appear here once your InoVA Local team connects your account. Questions? Reply to your latest invoice email.</p></div>`
    : `${summary}<div class="card"><h2>Your invoices</h2>${invoices.length ? invoices.map(row).join('') : empty('No invoices yet.')}
        <p class="small" style="margin:8px 0 0">${syncedAt ? `Updated ${esc(zohoTime(syncedAt))}. ` : ''}This list refreshes about once an hour. Your FreshBooks email has the payment link.</p></div>`;
  return layout({ title: 'Invoices', user, active: '/client/invoices', message, body });
}
