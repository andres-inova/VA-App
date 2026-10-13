// The HTML of the shared email pages (see email.js): Settings > Email, the "Emails" section on client,
// contact and VA pages, and one saved email.

import { esc } from './util.js';
import { layout, icon, avatar, chip, section, empty, zohoTime, settingsTabs } from './views.js';

const when = (iso) => (iso ? zohoTime(iso) : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Jane Doe <jane@x.com>" gives "Jane Doe"; a bare address stays as it is.
function nameIn(header) {
  const first = String(header || '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0] || '';
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(first);
  return (m ? m[1].trim() || m[2] : first.trim()) || 'Unknown sender';
}
const gmailLink = (e) => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(e.inbox_email || '')}#all/${encodeURIComponent(e.gmail_id)}`;
const inboxOf = (e, user) => (e.user_id === user.id ? 'your inbox' : `${e.owner_name || 'someone'}'s inbox`);
const attachments = (e) => JSON.parse(e.attachments || '[]');
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

// Emails grouped into conversations. The same email in two inboxes (same Message-ID) shows once, and joins
// the two inboxes' conversations. Conversations newest first; inside one, oldest first.
function threads(emails) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) k = parent.get(k); return k; };
  const firstByMsg = new Map();
  for (const e of emails) {
    const t = `${e.user_id}:${e.thread_id}`;
    if (!parent.has(t)) parent.set(t, t);
    if (!e.msg_id) continue;
    if (firstByMsg.has(e.msg_id)) {
      const a = find(t);
      const b = find(firstByMsg.get(e.msg_id));
      if (a !== b) parent.set(a, b);
    } else firstByMsg.set(e.msg_id, t);
  }
  const groups = new Map();
  for (const e of emails) {
    const root = find(`${e.user_id}:${e.thread_id}`);
    if (!groups.has(root)) groups.set(root, { list: [], byMsg: new Map() });
    const g = groups.get(root);
    const same = e.msg_id && g.byMsg.get(e.msg_id);
    if (same) { same.also.push(e); continue; }
    const item = { ...e, also: [] };
    if (e.msg_id) g.byMsg.set(e.msg_id, item);
    g.list.push(item);
  }
  return [...groups.values()].map((g) => g.list.reverse());
}

// The "Emails" section on a client, contact or VA page.
export function emailsSection({ user, record, emails, more, connected, ready }) {
  const here = `/admin/${record.module}/${record.id}`;
  const lookup = `<form method="post" action="/admin/emails/lookup" class="actions" style="margin:6px 8px"
      data-confirm="Look through each connected Gmail inbox for emails to and from this record's addresses in the last 90 days? It runs in the background, a little each minute.">
      <input type="hidden" name="record_id" value="${record.id}"><button class="sm plain">${icon('sync')} Look for older emails</button></form>`;
  if (!ready || !connected) {
    return section({
      title: 'Emails', count: emails.length || undefined, key: 'emails', open: emails.length > 0,
      hint: `No Gmail inbox is connected${ready ? '' : ' (Connect Gmail is not set up yet)'}. <a href="/admin/email">Settings &gt; Email</a>`,
      body: emails.length ? listHtml(emails, user, here, more) : empty('No emails yet.'),
    });
  }
  const whose = record.module === 'clients' ? "this client's and its contacts' email addresses" : 'this email address';
  return section({
    title: 'Emails', count: threads(emails).length, key: 'emails', open: emails.length > 0,
    hint: `Emails to and from ${whose}, from the connected Gmail inboxes. Private inboxes show only to their owner. Added a new address? Use <b>Look for older emails</b>.`,
    body: `${emails.length ? listHtml(emails, user, here, more) : empty('No emails found yet. New ones show up within a few minutes.')}${lookup}`,
  });
}

function listHtml(emails, user, here, more) {
  const rows = threads(emails).map((list, i) => {
    const last = list[list.length - 1];
    const subject = last.subject || list[0].subject || '(no subject)';
    const people = [...new Set(list.map((e) => nameIn(e.from_addr)))].slice(0, 4).join(', ');
    const msgs = list.map((e) => {
      const files = attachments(e);
      const inboxes = [e, ...e.also].map((x) => inboxOf(x, user)).join(' and ');
      const isPrivate = [e, ...e.also].every((x) => !x.shared);
      return `<a class="item flat pick" href="/admin/emails/${e.id}?back=${encodeURIComponent(here)}"><div class="item-head">${avatar(nameIn(e.from_addr))}
        <div class="grow"><div class="title">${esc(nameIn(e.from_addr))}${e.outgoing ? ' <span class="small">(sent)</span>' : ''}</div>
        <div class="sub">${esc(when(e.sent_at))} · from ${esc(inboxes)}${files.length ? ` · ${icon('doc')} ${files.length}` : ''}</div>
        <div class="sub mail-snippet">${esc(e.snippet || '')}</div></div>${isPrivate ? chip('Private', 'muted') : ''}${icon('chevron', 'chev')}</div></a>`;
    }).join('');
    if (list.length === 1 && !list[0].also.length) {
      const e = list[0];
      const files = attachments(e);
      return `<a class="item flat pick mail-thread" href="/admin/emails/${e.id}?back=${encodeURIComponent(here)}"><div class="item-head">${icon('mail')}
        <div class="grow"><div class="title">${esc(subject)}</div><div class="sub">${esc(nameIn(e.from_addr))}${e.outgoing ? ' (sent)' : ''} · ${esc(when(e.sent_at))} · from ${esc(inboxOf(e, user))}${files.length ? ` · ${icon('doc')} ${files.length}` : ''}</div>
        <div class="sub mail-snippet">${esc(e.snippet || '')}</div></div>${e.shared ? '' : chip('Private', 'muted')}${icon('chevron', 'chev')}</div></a>`;
    }
    return `<details class="item mail-thread" ${i === 0 ? 'open' : ''}><summary class="item-head">${icon('mail')}
      <div class="grow"><div class="title">${esc(subject)}</div><div class="sub">${esc(people)} · ${esc(when(last.sent_at))}</div></div>
      ${list.length > 1 ? `<span class="count">${list.length}</span>` : ''}${icon('chevron', 'chev')}</summary>
      <div class="item-body mail-msgs">${msgs}</div></details>`;
  }).join('');
  return rows + (more ? '<p class="small" style="margin:8px">Only the newest 300 emails are shown.</p>' : '');
}

// One saved email.
export function emailPage({ user, email: e, records, back, message }) {
  const files = attachments(e);
  const mine = e.user_id === user.id;
  const line = (label, v) => (v ? `<div><dt>${label}</dt><dd>${esc(v)}</dd></div>` : '');
  const fileList = files.length ? `<div class="mail-files">${files.map((f, i) => `<a class="btn sm plain" href="/admin/emails/${e.id}/files/${i}" target="_blank" rel="noopener">
      ${icon('doc')} ${esc(f.n)} <span class="small">(${esc(size(f.s))})</span></a>`).join('')}</div>
      <p class="small">Attachments are not saved in the app. They open from ${esc(inboxOf(e, user))} in Gmail${e.connected ? '' : ', which is not connected now'}.</p>` : '';
  const backLink = back ? `<a class="chip muted" href="${esc(back)}">‹ Back</a>` : '';
  return layout({
    title: e.subject || 'Email', user, active: '/admin/clients', message,
    body: `<div class="chips proj-tabs">${backLink}${records.map((r) => `<a class="chip muted" href="/admin/${esc(r.module)}/${esc(r.id)}">${esc(r.name)}</a>`).join('')}</div>
    <div class="card mail">
      <h2 class="mail-subject">${esc(e.subject || '(no subject)')}</h2>
      <div class="chips">${chip(e.shared ? 'Shared with the team' : 'Private', e.shared ? 'info' : 'muted')}${e.outgoing ? chip('Sent', 'good') : ''}</div>
      <dl class="fields mail-head">${line('From', e.from_addr)}${line('To', e.to_addr)}${line('Cc', e.cc_addr)}${line('Date', when(e.sent_at))}</dl>
      <p class="meta">From ${esc(inboxOf(e, user))}.${mine ? ` <a href="${esc(gmailLink(e))}" target="_blank" rel="noopener">${icon('external')} Open in Gmail</a>` : ''}</p>
      ${fileList}
      <div class="mail-body">${esc(e.body || e.snippet || '')}</div>
    </div>`,
  });
}

export function attachmentProblem({ user, email: e, text }) {
  return layout({
    title: 'Attachment', user, active: '/admin/clients',
    body: `<div class="card"><h2>The attachment could not be opened</h2><p class="meta">${esc(text)}</p>
      <a class="btn sm plain" href="/admin/emails/${e.id}">‹ Back to the email</a></div>`,
  });
}

// ---- Settings > Email ----

function personCard(p, user) {
  const isMe = p.id === user.id;
  const status = p.connected ? chip('Connected', 'good') : p.has_inbox ? chip(p.last_error ? 'Needs connecting again' : 'Not connected', p.last_error ? 'bad' : 'muted') : chip('Not connected', 'muted');
  const lines = [];
  if (p.has_inbox) {
    lines.push(`Mailbox: <b>${esc(p.email)}</b> · ${p.shared ? 'Shared with the team' : `Private (only ${isMe ? 'you' : 'them'})`}`);
    lines.push(`${plural(p.saved, 'email')} saved${p.connected && p.steps ? ` · still looking through older mail (${plural(p.steps, 'step')} left)` : ''}`);
    if (p.connected) lines.push(`Last sync: ${p.last_sync_at ? esc(when(p.last_sync_at)) : 'not yet (starts within a minute)'}`);
  } else if (!isMe) {
    lines.push('Has not connected Gmail.');
  }
  const problem = p.last_error ? `<div class="toast bad" style="display:block">${p.last_error_at ? `${esc(when(p.last_error_at))}: ` : ''}${esc(p.last_error)}</div>` : '';
  const disconnect = p.has_inbox ? `<form method="post" action="/admin/email/disconnect" class="mail-disconnect"
      data-confirm="${esc(p.connected ? `Disconnect ${isMe ? 'your' : `${p.name}'s`} Gmail? The app stops reading it, and Google is told to end the connection.` : `Delete the emails saved from ${isMe ? 'your' : `${p.name}'s`} inbox?`)}">
      <input type="hidden" name="user_id" value="${p.id}">
      ${p.connected ? `<label class="check"><input type="checkbox" name="delete_emails" value="1" checked> Also delete the ${plural(p.saved, 'email')} saved from this inbox</label>
      <button class="sm danger">Disconnect</button>` : (p.saved ? `<input type="hidden" name="delete_emails" value="1"><button class="sm danger">${icon('trash')} Delete the saved emails</button>` : '')}</form>` : '';
  return `<div class="item flat stack mail-person"><div class="item-head" style="align-items:flex-start">${avatar(p.name)}
    <div class="grow"><div class="title">${esc(p.name)}${isMe ? ' (you)' : ''}</div>${lines.map((l) => `<div class="sub">${l}</div>`).join('')}</div>${status}</div>
    ${problem || disconnect ? `<div class="mail-person-body">${problem}${disconnect}</div>` : ''}</div>`;
}

function myCard(me, missing) {
  if (missing.length) return '';
  const choice = (current) => `<fieldset class="picks share-pick"><legend>Who sees the emails saved from your inbox?</legend>
    <label class="check"><input type="radio" name="share" value="shared" required ${current === 1 ? 'checked' : ''}> <span><b>Shared with the team</b>: every admin sees them on the client, contact and VA pages</span></label>
    <label class="check"><input type="radio" name="share" value="private" required ${current === 0 ? 'checked' : ''}> <span><b>Private</b>: only you see them</span></label></fieldset>`;
  if (me?.connected) {
    return `<div class="card" id="mine"><h2>Your Gmail</h2>
      <p class="meta">Connected as <b>${esc(me.email)}</b>. You can change who sees your saved emails at any time; it applies to all of them.</p>
      <form method="post" action="/admin/email/share">${choice(me.shared)}<button class="sm">${icon('check')} Save</button></form>
      <form method="post" action="/admin/email/connect" style="margin-top:14px"><input type="hidden" name="share" value="${me.shared ? 'shared' : 'private'}">
        <button class="sm plain">${icon('sync')} Connect again</button> <span class="small">Only needed if a problem below says so.</span></form></div>`;
  }
  const problem = me?.last_error ? `<div class="toast bad" style="display:block">${esc(me.last_error)}</div>` : '';
  return `<div class="card" id="mine"><h2>Connect your Gmail</h2>${problem}
    <p class="meta">Sign in with your <b>@inovalocal.com</b> Google account. The app can then read your mailbox, but it only saves emails to or from the addresses of clients, client contacts and VAs in this app. Everything else is never saved. It never sends, changes or deletes anything in Gmail.</p>
    <p class="meta">It first looks through the last 90 days (a little each minute, so this can take a while), then checks for new emails every few minutes.</p>
    <form method="post" action="/admin/email/connect">${choice(me ? me.shared : null)}
      <button>${icon('mail')} ${me?.has_inbox ? 'Connect Gmail again' : 'Connect Gmail'}</button></form></div>`;
}

export function emailSettingsPage({ user, people, missing, redirectUri, message }) {
  const me = people.find((p) => p.id === user.id);
  const notReady = missing.length ? `<div class="card"><h2>Connect Gmail is not set up yet</h2>
    <p class="meta">These secrets are missing in Cloudflare: ${missing.map((m) => `<code>${esc(m)}</code>`).join(', ')}. See README, "Shared email (Connect Gmail)".</p>
    <p class="meta">Google's sign-in comes back to <code style="word-break:break-all">${esc(redirectUri)}</code>. That address must be listed under <b>Authorized redirect URIs</b> of the Google OAuth client.</p></div>` : '';
  return layout({
    title: 'Email', user, active: '/admin/settings', message,
    body: `${settingsTabs('/admin/email')}
    <p class="lead">Emails with clients, client contacts and VAs, saved from each admin's Gmail and shown on their pages.</p>
    ${notReady}${myCard(me, missing)}
    ${section({ title: 'Inboxes', count: people.filter((p) => p.connected).length, key: 'inboxes', hint: 'Every admin, and whether their Gmail is connected.', body: people.map((p) => personCard(p, user)).join('') || empty('No admins.') })}`,
  });
}
