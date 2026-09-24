// The HTML for each page.

import { esc } from './util.js';
import { formatDate, formatTimeIn, formatHM, parseHHMM, zoneFor, weekdayOf, DAY_NAMES } from './time.js';

// Short messages shown at the top of a page after an action.
const MESSAGES = {
  'checked-in': ['good', 'You are checked in. Have a good shift!'],
  'already-in': ['info', 'You already checked in today.'],
  'called-out': ['good', 'Your call-out was sent to your management channel.'],
  'reason-needed': ['bad', 'Please write a short reason for calling out.'],
  'request-sent': ['good', 'Your time-off request was sent to the admins.'],
  'bad-dates': ['bad', 'Please choose a start date and an end date that is the same or later.'],
  'approved': ['good', 'Request approved.'],
  'denied': ['good', 'Request denied.'],
  'saved': ['good', 'Saved.'],
  'synced': ['good', 'VAs and projects were updated from Zoho.'],
  'sync-failed': ['bad', 'The Zoho sync did not work. Check the Zoho settings (see README).'],
  'report-sent': ['good', 'Report sent to #check-in-tracker and emailed to admins.'],
  'report-email-failed': ['bad', 'The report was posted in #check-in-tracker, but one or more emails did not send. See "Last email problem" below.'],
  'password-changed': ['good', 'Your password was changed.'],
  'admin-added': ['good', 'Admin added. Use "Set temporary password" so they can log in.'],
  'removed': ['good', 'Removed.'],
};

export const STATUS = {
  pending: ['Not checked in', 'warn', '…'],
  on_time: ['On time', 'good', '✓'],
  late: ['Late', 'warn', 'L'],
  missed: ['No check-in', 'bad', '✗'],
  called_out: ['Called out', 'info', 'C'],
  time_off: ['Time off', 'muted', 'T'],
  checked_in: ['Checked in', 'good', '✓'],
};

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1d2330;--muted:#5f6b7a;--line:#e1e5ea;--accent:#0f766e;--accent-text:#fff;
--good:#15803d;--good-bg:#dcfce7;--warn:#a16207;--warn-bg:#fef3c7;--bad:#b91c1c;--bad-bg:#fee2e2;--info:#1d4ed8;--info-bg:#dbeafe;--muted-bg:#eef0f3}
@media (prefers-color-scheme:dark){:root{--bg:#12151a;--card:#1b2028;--text:#e7eaee;--muted:#9aa5b1;--line:#2c333d;--accent:#2dd4bf;--accent-text:#062b27;
--good:#4ade80;--good-bg:#12311f;--warn:#fbbf24;--warn-bg:#3a2d0c;--bad:#f87171;--bad-bg:#3b1515;--info:#93c5fd;--info-bg:#162a4a;--muted-bg:#262c35}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:var(--card);border-bottom:1px solid var(--line)}
.bar{max-width:1100px;margin:0 auto;padding:10px 16px;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}
.brand{font-weight:700;margin-right:auto}nav{display:flex;flex-wrap:wrap;gap:4px 12px}nav a{color:var(--muted);text-decoration:none}nav a.on{color:var(--text);font-weight:600}
main{max-width:1100px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 16px}h2{font-size:17px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
label{display:block;font-weight:600;margin:10px 0 4px}input[type=text],input[type=email],input[type=password],input[type=date],input[type=time],input[type=number],textarea,select{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--text);font:inherit}
textarea{min-height:80px}.check{display:flex;gap:8px;align-items:center;font-weight:400;margin-top:12px}
button,.btn{display:inline-block;background:var(--accent);color:var(--accent-text);border:0;border-radius:6px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;margin-top:12px}
button.big{font-size:18px;padding:14px 28px}button.plain{background:var(--muted-bg);color:var(--text)}button.danger{background:var(--bad);color:#fff}button:disabled{opacity:.5;cursor:default}
.inline{display:inline}.inline button{margin:0 4px 0 0;padding:5px 10px}
.msg{padding:10px 14px;border-radius:8px;margin-bottom:16px}.msg.good{background:var(--good-bg);color:var(--good)}.msg.bad{background:var(--bad-bg);color:var(--bad)}.msg.info{background:var(--info-bg);color:var(--info)}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:13px;font-weight:600;white-space:nowrap}
.good{background:var(--good-bg);color:var(--good)}.warn{background:var(--warn-bg);color:var(--warn)}.bad{background:var(--bad-bg);color:var(--bad)}.info{background:var(--info-bg);color:var(--info)}.muted{background:var(--muted-bg);color:var(--muted)}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:13px;color:var(--muted);font-weight:600}
.hist td,.hist th{text-align:center;padding:5px 4px;min-width:30px}.hist td:first-child,.hist th:first-child{text-align:left;white-space:nowrap}
.cell{display:inline-block;width:26px;height:24px;line-height:24px;border-radius:5px;font-weight:700;font-size:13px}
.small{font-size:13px;color:var(--muted)}.big-status{font-size:20px;font-weight:700;margin:6px 0}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.row>*{flex:1;min-width:140px}
code{background:var(--muted-bg);padding:2px 6px;border-radius:4px}
.assign{padding:6px 0;border-bottom:1px dashed var(--line)}.assign-form{display:inline-flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.assign-form input[type=time]{width:auto}.assign-form select{width:auto}.assign-form button,.assign .inline button{margin:0}
.days{display:inline-flex;gap:2px}.days label{display:inline-flex;align-items:center;gap:2px;font-weight:400;margin:0 4px 0 0;font-size:13px}
details{margin-top:6px}summary{cursor:pointer}
`;

export function layout({ title, user, active, message, body }) {
  const links = [];
  if (user?.is_va) links.push(['/va', 'My day']);
  if (user?.is_admin) {
    links.push(['/admin', 'Today'], ['/admin/history', 'History'], ['/admin/projects', 'Projects'], ['/admin/time-off', 'Time off'],
      ['/admin/people', 'People'], ['/admin/holidays', 'Holidays'], ['/admin/settings', 'Settings']);
  }
  const nav = user
    ? `<nav>${links.map(([href, label]) => `<a href="${href}" class="${href === active ? 'on' : ''}">${label}</a>`).join('')}
       <a href="/account">Password</a><form method="post" action="/logout" class="inline"><button class="plain" style="margin:0;padding:3px 10px">Log out</button></form></nav>`
    : '';
  const msg = MESSAGES[message];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · InoVA Check-in</title><style>${CSS}</style></head><body>
<header><div class="bar"><div class="brand">InoVA Check-in</div>${nav}</div></header>
<main>${msg ? `<div class="msg ${msg[0]}">${esc(msg[1])}</div>` : ''}${body}</main></body></html>`;
}

const pill = (status) => {
  const [label, cls] = STATUS[status] || [status, 'muted'];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};

// ---- Login pages ----

export function loginPage(error) {
  const errors = { wrong: 'That email and password do not match.', locked: 'Too many tries. Please wait 15 minutes and try again.', inactive: 'This account is not active. Please contact an admin.' };
  return layout({
    title: 'Log in',
    body: `<div class="card" style="max-width:400px;margin:40px auto">
      <h1>Log in</h1>
      ${error ? `<div class="msg bad">${esc(errors[error] || error)}</div>` : ''}
      <form method="post" action="/login">
        <label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username">
        <label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
        <button>Log in</button>
      </form>
      <p class="small">Forgot your password? Ask an admin to set a temporary one for you.</p>
    </div>`,
  });
}

export function setupPage(admins, error) {
  return layout({
    title: 'First-time setup',
    body: `<div class="card" style="max-width:440px;margin:40px auto">
      <h1>First-time setup</h1>
      <p>No admin has a password yet. Choose your email and set your password. After that, this page stops working and you can set up everyone else from the People page.</p>
      ${error ? `<div class="msg bad">${esc(error)}</div>` : ''}
      <form method="post" action="/setup">
        <label for="email">Your email</label>
        <select id="email" name="email">${admins.map((a) => `<option>${esc(a.email)}</option>`).join('')}</select>
        <label for="password">New password (at least 10 characters)</label><input id="password" name="password" type="password" required minlength="10" autocomplete="new-password">
        <label for="confirm">Type it again</label><input id="confirm" name="confirm" type="password" required autocomplete="new-password">
        <button>Save and log in</button>
      </form></div>`,
  });
}

export function accountPage(user, error, message) {
  return layout({
    title: 'Change password', user, active: '/account', message,
    body: `<div class="card" style="max-width:440px">
      <h1>${user.must_change_password ? 'Choose your own password' : 'Change password'}</h1>
      ${user.must_change_password ? '<p>You logged in with a temporary password. Please choose your own password to continue.</p>' : ''}
      ${error ? `<div class="msg bad">${esc(error)}</div>` : ''}
      <form method="post" action="/account">
        <label for="current">Current password</label><input id="current" name="current" type="password" required autocomplete="current-password">
        <label for="password">New password (at least 10 characters)</label><input id="password" name="password" type="password" required minlength="10" autocomplete="new-password">
        <label for="confirm">Type it again</label><input id="confirm" name="confirm" type="password" required autocomplete="new-password">
        <button>Save password</button>
      </form></div>`,
  });
}

// ---- VA page ----

export function vaPage({ user, day, today, requests, history, message }) {
  let statusHtml;
  if (today?.checked_in_at) {
    statusHtml = `<div class="big-status">${pill(today.status)}</div><p>You checked in at ${esc(formatTimeIn(today.checked_in_at, day.zone))} ${esc(day.zoneLabel)}.</p>`;
  } else if (today?.status === 'called_out') {
    statusHtml = `<div class="big-status">${pill('called_out')}</div><p>You called out today.</p>`;
  } else if (today?.status === 'time_off' || day.onTimeOff) {
    statusHtml = `<div class="big-status">${pill('time_off')}</div><p>You have approved time off today.</p>`;
  } else if (day.holiday) {
    statusHtml = `<p>Today is a company holiday (${esc(day.holiday.name)}). No check-in is needed.</p>`;
  } else if (!day.expected) {
    statusHtml = `<p>No check-in is required today${day.projects.length ? ' (your projects today have no fixed start time)' : ' (you have no projects today)'}, but you can still check in.</p>`;
  } else {
    statusHtml = `<p>You have not checked in yet.</p>`;
  }

  const checkedIn = Boolean(today?.checked_in_at);
  return layout({
    title: 'My day', user, active: '/va', message,
    body: `<h1>Hi ${esc(user.name.split(' ')[0])}</h1>
    <div class="card">
      <h2>Today, ${esc(formatDate(day.local.date))}</h2>
      <p class="small">Your time zone: ${esc(day.zoneLabel)}${day.startLabel ? ` · Check in by: <strong>${esc(day.startLabel)}</strong>` : ''}</p>
      ${day.projects.length ? `<p>Your projects today: ${day.projects.map((p) => `${esc(p.client)}${p.start ? ` (${formatHM(p.start)})` : ''}`).join(', ')}.
        ${day.projects.length > 1 ? '<br><span class="small">One check-in covers all of them. It is due at the earliest start time.</span>' : ''}</p>` : ''}
      ${statusHtml}
      <form method="post" action="/va/checkin"><button class="big" ${checkedIn ? 'disabled' : ''}>${checkedIn ? 'Checked in' : 'Check in'}</button></form>
    </div>
    <div class="grid">
      <div class="card">
        <h2>Call out</h2>
        <p class="small">Use this if you cannot work today. Your reason is sent to your management channel on Slack.</p>
        <form method="post" action="/va/callout">
          <label for="reason">Reason</label>
          <textarea id="reason" name="reason" required maxlength="1000" placeholder="A short explanation"></textarea>
          <button>Send call-out</button>
        </form>
      </div>
      <div class="card">
        <h2>Request time off</h2>
        <form method="post" action="/va/time-off">
          <div class="row">
            <div><label for="start">First day off</label><input id="start" name="start_date" type="date" required></div>
            <div><label for="end">Last day off</label><input id="end" name="end_date" type="date" required></div>
          </div>
          <label class="check"><input type="checkbox" name="needs_coverage" value="1"> I need another InoVA VA to cover for me</label>
          <label for="note">Note (optional)</label>
          <textarea id="note" name="note" maxlength="1000"></textarea>
          <button>Send request</button>
        </form>
      </div>
    </div>
    <div class="card"><h2>My time-off requests</h2>${requestsTable(requests, false)}</div>
    <div class="card"><h2>My last 30 days</h2>
      ${history.length ? `<div class="table"><table><tr><th>Date</th><th>Status</th><th>Checked in</th></tr>
      ${history.map((h) => `<tr><td>${esc(formatDate(h.work_date))}</td><td>${pill(h.status)}</td><td>${esc(formatTimeIn(h.checked_in_at, day.zone))}</td></tr>`).join('')}
      </table></div>` : '<p class="small">Nothing yet.</p>'}
    </div>`,
  });
}

function requestsTable(requests, forAdmin) {
  if (!requests.length) return '<p class="small">No requests.</p>';
  const statusPill = (s) => `<span class="pill ${{ pending: 'warn', approved: 'good', denied: 'bad' }[s]}">${esc(s[0].toUpperCase() + s.slice(1))}</span>`;
  return `<div class="table"><table><tr>${forAdmin ? '<th>VA</th>' : ''}<th>Dates</th><th>Coverage needed</th><th>Note</th><th>Status</th>${forAdmin ? '<th></th>' : ''}</tr>
  ${requests.map((r) => `<tr>
    ${forAdmin ? `<td>${esc(r.name)}</td>` : ''}
    <td>${esc(formatDate(r.start_date, true))}${r.end_date !== r.start_date ? ` to ${esc(formatDate(r.end_date, true))}` : ''}</td>
    <td>${r.needs_coverage ? '<strong>Yes</strong>' : 'No'}</td>
    <td>${esc(r.note || '')}</td>
    <td>${statusPill(r.status)}${r.decided_by_name ? `<div class="small">by ${esc(r.decided_by_name)}</div>` : ''}</td>
    ${forAdmin ? `<td>${r.status === 'pending' ? `
      <form method="post" action="/admin/time-off/${r.id}/approve" class="inline"><button>Approve</button></form>
      <form method="post" action="/admin/time-off/${r.id}/deny" class="inline"><button class="danger">Deny</button></form>` : ''}</td>` : ''}
  </tr>`).join('')}</table></div>`;
}

// ---- Admin pages ----

export function adminTodayPage({ user, rows, message }) {
  return layout({
    title: 'Today', user, active: '/admin', message,
    body: `<h1>Today</h1>
    <div class="card table"><table>
      <tr><th>VA</th><th>Projects today</th><th>Check in by</th><th>Status</th><th>Checked in</th><th>Notes</th></tr>
      ${rows.map((r) => `<tr>
        <td>${esc(r.name)}</td>
        <td class="small">${esc(r.projects || 'None')}</td>
        <td>${esc(r.startLabel || 'No fixed start')}</td>
        <td>${r.statusHtml}</td>
        <td>${esc(r.checkedIn || '')}</td>
        <td class="small">${esc(r.note || '')}</td>
      </tr>`).join('') || '<tr><td colspan="6">No active VAs yet. Go to People and click "Sync with Zoho now".</td></tr>'}
    </table></div>`,
  });
}

export function todayStatusHtml(row, day, now) {
  if (row) {
    if (row.status === 'pending') {
      const mins = Math.floor((now - new Date(row.scheduled_start)) / 60000);
      return mins < 0 ? '<span class="pill muted">Shift not started</span>' : `<span class="pill bad">Not checked in (${mins} min)</span>`;
    }
    return pill(row.status);
  }
  if (day.onTimeOff) return pill('time_off');
  if (day.holiday) return '<span class="pill muted">Holiday</span>';
  if (!day.expected) return '<span class="pill muted">No check-in expected</span>';
  return '<span class="pill muted">Shift not started</span>';
}

export function historyPage({ user, month, prev, next, dates, vas, cells }) {
  const [y, m] = month.split('-').map(Number);
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const legend = ['on_time', 'late', 'missed', 'called_out', 'time_off']
    .map((s) => `<span><span class="cell ${STATUS[s][1]}">${STATUS[s][2]}</span> ${STATUS[s][0]}</span>`).join('');
  return layout({
    title: 'History', user, active: '/admin/history',
    body: `<h1>Check-in history</h1>
    <div class="card">
      <div class="row" style="align-items:center">
        <div><a class="btn" href="/admin/history?month=${prev}" style="margin:0">← Earlier</a></div>
        <div style="text-align:center;font-weight:700;font-size:17px">${esc(monthName)}</div>
        <div style="text-align:right"><a class="btn" href="/admin/history?month=${next}" style="margin:0">Later →</a></div>
      </div>
      <div class="legend small">${legend}<span><span class="cell muted">–</span> No record</span></div>
      <div class="table"><table class="hist">
        <tr><th>VA</th>${dates.map((d) => `<th><div class="small">${weekdayOf(d).slice(0, 2)}</div>${Number(d.slice(8))}</th>`).join('')}<th>On time</th><th>Late</th><th>No check-in</th></tr>
        ${vas.map((v) => {
          const counts = { on_time: 0, late: 0, missed: 0 };
          const tds = dates.map((d) => {
            const c = cells.get(`${v.id}|${d}`);
            if (!c) return '<td><span class="cell muted">–</span></td>';
            if (c.status in counts) counts[c.status]++;
            if (c.status === 'checked_in') counts.on_time++;
            const [label, cls, sym] = STATUS[c.status] || [c.status, 'muted', '?'];
            const tip = [c.callout_reason ? `${label}: ${c.callout_reason}` : label, c.projects ? `Projects: ${c.projects}` : ''].filter(Boolean).join(' · ');
            return `<td><span class="cell ${cls}" title="${esc(tip)}">${sym}</span></td>`;
          }).join('');
          return `<tr><td>${esc(v.name)}</td>${tds}<td>${counts.on_time}</td><td>${counts.late}</td><td>${counts.missed}</td></tr>`;
        }).join('')}
      </table></div>
      <p class="small">Hover over a square to see details, including call-out reasons.</p>
    </div>`,
  });
}

export function timeOffPage({ user, pending, recent, message }) {
  return layout({
    title: 'Time off', user, active: '/admin/time-off', message,
    body: `<h1>Time-off requests</h1>
    <div class="card"><h2>Waiting for a decision</h2>${requestsTable(pending, true)}</div>
    <div class="card"><h2>Recent decisions</h2>${requestsTable(recent, true)}</div>`,
  });
}

export function peoplePage({ user, people, message, tempPassword }) {
  const vas = people.filter((p) => p.is_va);
  const admins = people.filter((p) => p.is_admin);
  const tempBox = tempPassword
    ? `<div class="msg info">Temporary password for <strong>${esc(tempPassword.name)}</strong>: <code>${esc(tempPassword.password)}</code><br>
       Share it with them privately. They will choose their own password when they log in. This password is not shown again.</div>` : '';
  const resetBtn = (p) => `<form method="post" action="/admin/people/${p.id}/temp-password" class="inline"><button class="plain">Set temporary password</button></form>`;
  return layout({
    title: 'People', user, active: '/admin/people', message,
    body: `<h1>People</h1>${tempBox}
    <div class="card">
      <h2>VAs</h2>
      <p class="small">Active VAs are copied from Zoho CRM every hour. To change a VA's name, email, time zone, availability or Slack channels, change it in Zoho, then click "Sync with Zoho now". Projects and start times are set on the <a href="/admin/projects">Projects</a> page.</p>
      <form method="post" action="/admin/sync"><input type="hidden" name="back" value="/admin/people"><button>Sync with Zoho now</button></form>
      <div class="table" style="margin-top:14px"><table>
        <tr><th>Name</th><th>Time zone</th><th>Zoho availability</th><th>Projects</th><th>Slack channel</th><th>Login</th></tr>
        ${vas.map((p) => `<tr>
          <td>${esc(p.name)}<div class="small">${esc(p.email)}</div></td>
          <td>${esc(p.time_zone || '')}${zoneFor(p.time_zone) ? '' : ' <span class="pill warn">Missing, using EST</span>'}</td>
          <td>${esc(p.availability || '')}</td>
          <td class="small">${p.project_list ? esc(p.project_list) : '<span class="pill warn">None</span>'}</td>
          <td>${p.slack_channel_id ? `<code>${esc(p.slack_channel_id)}</code>` : '<span class="pill warn">Not set</span>'}</td>
          <td>${p.password_hash ? (p.must_change_password ? 'Temporary password' : 'Active') : 'No password yet'}<br>${resetBtn(p)}</td>
        </tr>`).join('') || '<tr><td colspan="6">No active VAs yet.</td></tr>'}
      </table></div>
    </div>
    <div class="card">
      <h2>Admins</h2>
      <div class="table"><table><tr><th>Name</th><th>Email</th><th>Login</th><th></th></tr>
      ${admins.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.email)}</td>
        <td>${p.password_hash ? (p.must_change_password ? 'Temporary password' : 'Active') : 'No password yet'}</td>
        <td>${resetBtn(p)}${p.id !== user.id ? `<form method="post" action="/admin/people/${p.id}/remove-admin" class="inline"><button class="danger">Remove admin</button></form>` : ''}</td></tr>`).join('')}
      </table></div>
      <h2 style="margin-top:18px">Add an admin</h2>
      <form method="post" action="/admin/people/add-admin" class="row">
        <div><label for="an">Name</label><input id="an" name="name" type="text" required></div>
        <div><label for="ae">Email</label><input id="ae" name="email" type="email" required></div>
        <div style="flex:0"><button>Add</button></div>
      </form>
    </div>`,
  });
}

export function holidaysPage({ user, holidays, message }) {
  return layout({
    title: 'Holidays', user, active: '/admin/holidays', message,
    body: `<h1>Company holidays</h1>
    <div class="card">
      <p class="small">No check-in is expected on these dates, so there are no late alerts.</p>
      <form method="post" action="/admin/holidays" class="row">
        <div><label for="hd">Date</label><input id="hd" name="date" type="date" required></div>
        <div><label for="hn">Name</label><input id="hn" name="name" type="text" required placeholder="For example: Thanksgiving"></div>
        <div style="flex:0"><button>Add</button></div>
      </form>
      <div class="table" style="margin-top:14px"><table><tr><th>Date</th><th>Name</th><th></th></tr>
      ${holidays.map((h) => `<tr><td>${esc(formatDate(h.date, true))}</td><td>${esc(h.name)}</td>
        <td><form method="post" action="/admin/holidays/${esc(h.date)}/delete" class="inline"><button class="danger">Remove</button></form></td></tr>`).join('') || '<tr><td colspan="3">No holidays added.</td></tr>'}
      </table></div>
    </div>`,
  });
}

export function settingsPage({ user, grace, emailError, message }) {
  return layout({
    title: 'Settings', user, active: '/admin/settings', message,
    body: `<h1>Settings</h1>
    <div class="grid">
      <div class="card">
        <h2>My notifications</h2>
        <form method="post" action="/admin/settings/notifications">
          <label class="check"><input type="checkbox" name="notify_time_off" value="1" ${user.notify_time_off ? 'checked' : ''}> Email me when a VA sends a new time-off request</label>
          <button>Save</button>
        </form>
      </div>
      <div class="card">
        <h2>On-time rule</h2>
        <form method="post" action="/admin/settings/grace">
          <label for="grace">A check-in counts as on time if it happens up to this many minutes after the start time</label>
          <input id="grace" name="grace" type="number" min="0" max="9" value="${grace}">
          <button>Save</button>
        </form>
        <p class="small">Late alerts are still sent at 10 and 15 minutes.</p>
      </div>
      <div class="card">
        <h2>Reports</h2>
        <p class="small">Sent automatically at 9:00 AM Eastern: the weekly report every Monday (for the week before) and the monthly report on the 1st (for the month before). You can also send them now.</p>
        <form method="post" action="/admin/reports/weekly" class="inline"><button class="plain">Send weekly report now</button></form>
        <form method="post" action="/admin/reports/monthly" class="inline"><button class="plain">Send monthly report now</button></form>
      </div>
      <div class="card">
        <h2>Last email problem</h2>
        ${emailError
          ? `<p class="small">${esc(new Date(emailError.at).toLocaleString('en-US', { timeZone: 'America/New_York' }))} ET, sending to ${esc(emailError.to)}:</p><p><code>${esc(emailError.problem)}</code></p>`
          : '<p class="small">No email problems so far.</p>'}
      </div>
    </div>`,
  });
}

// ---- Projects page ----

// Checkboxes for work days, Monday first.
function dayBoxes(days) {
  const on = new Set((days ?? '1,2,3,4,5').split(','));
  return `<span class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) =>
    `<label><input type="checkbox" name="days" value="${d}" ${on.has(String(d)) ? 'checked' : ''}>${DAY_NAMES[d].slice(0, 2)}</label>`).join('')}</span>`;
}

export function projectsPage({ user, projects, assignments, vas, message }) {
  const byProject = new Map(projects.map((p) => [p.id, []]));
  for (const a of assignments) byProject.get(a.project_id)?.push(a);
  const unassigned = projects.filter((p) => !byProject.get(p.id).length);

  const assignmentRow = (a) => `
    <div class="assign">
      <form method="post" action="/admin/assignments/${a.id}" class="assign-form">
        <strong>${esc(a.va_name)}</strong>
        <input type="time" name="start_time" value="${esc(a.start_time || '')}" aria-label="Start time">
        <span class="small">${esc(zoneFor(a.time_zone) ? a.time_zone : 'EST')}</span>
        ${dayBoxes(a.days)}
        <button class="plain">Save</button>
      </form>
      <form method="post" action="/admin/assignments/${a.id}/delete" class="inline"><button class="danger">Remove</button></form>
      ${parseHHMM(a.start_time) ? '' : '<div><span class="pill warn">No start time: no check-in or late alerts for this project</span></div>'}
    </div>`;

  const addForm = (p) => `
    <details><summary class="small">Add a VA</summary>
      <form method="post" action="/admin/projects/${esc(p.id)}/assign" class="assign-form">
        <select name="user_id" required aria-label="VA"><option value="">Choose a VA</option>${vas.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
        <input type="time" name="start_time" aria-label="Start time">
        ${dayBoxes()}
        <button>Add</button>
      </form>
    </details>`;

  return layout({
    title: 'Projects', user, active: '/admin/projects', message,
    body: `<h1>Projects</h1>
    <div class="card">
      <p class="small">Active projects are copied from Zoho Projects every hour. A new project is assigned automatically to the VA named after the " - " in its name (for example "Pool Partners - Tracy Saeman"), using that VA's Zoho availability as the start time. After that, changes here are kept.</p>
      <p class="small">Start times are in each VA's own time zone. A VA with several projects on the same day checks in once, by the earliest start time, and that check-in counts for all of them.</p>
      <form method="post" action="/admin/sync"><input type="hidden" name="back" value="/admin/projects"><button>Sync with Zoho now</button></form>
    </div>
    ${unassigned.length ? `<div class="card"><h2>Projects with no VA (${unassigned.length})</h2>
      <p class="small">No active VA matched the name in these projects. Add a VA below if one should check in for it.</p>
      <ul>${unassigned.map((p) => `<li>${esc(p.name)}</li>`).join('')}</ul></div>` : ''}
    <div class="card table"><table>
      <tr><th>Project</th><th>VA, start time and days</th></tr>
      ${projects.map((p) => `<tr>
        <td><strong>${esc(p.client)}</strong><div class="small">${esc(p.name)}</div></td>
        <td>${byProject.get(p.id).map(assignmentRow).join('')}${addForm(p)}</td>
      </tr>`).join('') || '<tr><td colspan="2">No projects yet. Click "Sync with Zoho now".</td></tr>'}
    </table></div>`,
  });
}
