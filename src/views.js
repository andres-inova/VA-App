// The HTML for each page.
//
// Look and feel: a left sidebar (collapses into a menu on phones, with a bottom tab bar),
// rows with initials avatars and colored status chips, and collapsible sections
// (<details>) so each page shows what matters first and hides the rest until clicked.

import { esc } from './util.js';
import { isExempt } from './jobs.js';
import { formatDate, formatTimeIn, formatHM, parseHHMM, zoneFor, weekdayOf, DAY_NAMES, addDays, partsIn } from './time.js';

// Short messages shown at the top of a page after an action.
const MESSAGES = {
  'checked-in': ['good', 'You are checked in. Have a good shift!'],
  'already-in': ['info', 'You already checked in today.'],
  'bad-dates': ['bad', 'Please choose a start date and an end date that is the same or later.'],
  'approved': ['good', 'Request approved.'],
  'denied': ['good', 'Request denied.'],
  'saved': ['good', 'Saved.'],
  'synced': ['good', 'VAs and projects were updated from Zoho.'],
  'sync-failed': ['bad', 'The Zoho sync did not work. Check the Zoho settings (see README).'],
  'report-sent': ['good', 'Report posted in #check-in-tracker and emailed to the report recipients.'],
  'report-email-failed': ['bad', 'The report was posted in #check-in-tracker, but the email did not send. See "Last email problem" below.'],
  'password-changed': ['good', 'Your password was changed.'],
  'admin-added': ['good', 'Admin added. Use "Set temporary password" so they can log in.'],
  'removed': ['good', 'Removed.'],
  'choose-backup': ['bad', 'This is time off that needs coverage: choose who covers (Edit) before approving.'],
  'clickup-failed': ['bad', 'Saved, but the ClickUp checklist could not be created. The reason is shown on the request; use "Create ClickUp checklist" to try again.'],
  'clickup-created': ['good', 'ClickUp checklist created.'],
  'choose-va': ['bad', 'Please choose a VA for the request.'],
  'choose-projects': ['bad', 'Please tick at least one project for the request.'],
  'period-added': ['good', 'Added. No check-in is expected on those days.'],
  'period-cancelled': ['good', 'Cancelled. Check-ins are expected again from today.'],
  'timer-started': ['good', 'Timer started.'],
  'timer-started-checked-in': ['good', 'Timer started, and you are checked in for today.'],
  'timer-stopped': ['info', 'Timer stopped. Add your notes and save it to Zoho.'],
  'timer-discarded': ['good', 'Timer discarded. Nothing was saved to Zoho.'],
  'log-added': ['good', 'Time log saved to Zoho.'],
  'log-updated': ['good', 'Time log updated in Zoho.'],
  'log-deleted': ['good', 'Time log trashed in Zoho.'],
  'task-added': ['good', 'Task added in Zoho.'],
  'task-updated': ['good', 'Task updated in Zoho.'],
  'task-deleted': ['good', 'Task trashed in Zoho.'],
  'list-added': ['good', 'Task list added in Zoho.'],
  'list-updated': ['good', 'Task list renamed in Zoho.'],
  'list-deleted': ['good', 'Task list trashed in Zoho.'],
};

// Status of a day: [label, color, symbol for the History grid].
export const STATUS = {
  pending: ['Not checked in', 'warn', '…'],
  on_time: ['On time', 'good', '✓'],
  late: ['Late', 'warn', 'L'],
  missed: ['No check-in', 'bad', '✗'],
  called_out: ['Called out', 'info', 'C'],
  time_off: ['Time off', 'muted', 'T'],
  emergency: ['Emergency', 'info', '!'],
  coverage: ['Coverage', 'muted', 'V'],
  exempt: ['Exempt', 'muted', 'E'],
  checked_in: ['Checked in', 'good', '✓'],
};

// ---- Small building blocks ----

const ICON_PATHS = {
  today: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  timeoff: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  people: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/>',
  holidays: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"/><path d="M21 4v5h-5M3 20v-5h5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  tasks: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};

const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// A round avatar with the person's initials, in a color that always matches their name.
function avatar(name, size = '') {
  let hue = 0;
  for (const ch of name || '') hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="avatar ${size}" style="--h:${hue}" aria-hidden="true">${esc(initials(name))}</span>`;
}

const chip = (label, tone = 'muted') => `<span class="chip ${tone}">${esc(label)}</span>`;

const pill = (status) => {
  const [label, tone] = STATUS[status] || [status, 'muted'];
  return chip(label, tone);
};

const dateRange = (start, end, year = true) =>
  start === end ? formatDate(start, year) : `${formatDate(start, false)} – ${formatDate(end, year)}`;

// A collapsible section with a title, an optional count badge and an optional hint line.
function section({ title, count, open = true, hint = '', body, tone = '', key = '' }) {
  return `<details class="section ${tone}" ${open ? 'open' : ''} ${key ? `data-key="${esc(key)}"` : ''}>
    <summary><span class="sec-title">${esc(title)}</span>${count !== undefined ? `<span class="count">${count}</span>` : ''}${icon('chevron', 'chev')}</summary>
    ${hint ? `<p class="hint">${hint}</p>` : ''}
    <div class="sec-body">${body}</div>
  </details>`;
}

// A clickable row: avatar, title, subtitle and a chip; clicking opens the extra content.
function item({ name, title, sub = '', side = '', body = '', open = false, tone = '', key = '' }) {
  const head = `${name !== undefined ? avatar(name) : ''}<div class="grow"><div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${side}`;
  if (!body) return `<div class="item flat ${tone}"><div class="item-head">${head}</div></div>`;
  return `<details class="item ${tone}" ${open ? 'open' : ''} ${key ? `data-key="${esc(key)}"` : ''}><summary class="item-head">${head}${icon('chevron', 'chev')}</summary><div class="item-body">${body}</div></details>`;
}

const empty = (text) => `<div class="empty">${text}</div>`;

// ---- Styles ----

const CSS = `
:root{--bg:#efeae2;--surface:#fff;--surface-2:#f6f5f3;--text:#111b21;--muted:#667781;--line:#e6e2dc;
--brand:#008069;--accent:#00a884;--accent-ink:#fff;--accent-soft:#d9fdd3;
--side:#0f2f2a;--side-ink:#d7ece7;--side-muted:#8fb3ab;--side-hover:#18413a;
--good:#067647;--good-bg:#dcfae6;--warn:#935f00;--warn-bg:#fef0c7;--bad:#b42318;--bad-bg:#fee4e2;--info:#175cd3;--info-bg:#e0eaff;--muted-bg:#eef0f2;
--shadow:0 1px 2px rgba(17,27,33,.06),0 2px 8px rgba(17,27,33,.05);--radius:16px}
@media (prefers-color-scheme:dark){:root{--bg:#0b141a;--surface:#111b21;--surface-2:#1a252c;--text:#e9edef;--muted:#8696a0;--line:#233138;
--brand:#00a884;--accent:#00a884;--accent-ink:#04211b;--accent-soft:#0b3d34;--side:#0b1d1a;--side-ink:#d7ece7;--side-muted:#7fa39b;--side-hover:#14302b;
--good:#75e0a7;--good-bg:#0f3321;--warn:#fdb022;--warn-bg:#3b2a07;--bad:#fda29b;--bad-bg:#3d1512;--info:#84adff;--info-bg:#15254d;--muted-bg:#233138;
--shadow:0 1px 2px rgba(0,0,0,.4)}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 "Nunito Sans","Segoe UI",system-ui,-apple-system,Roboto,sans-serif}
a{color:var(--brand)}.ic{width:20px;height:20px;flex:none}
.app{display:flex;min-height:100vh}
.sidebar{width:248px;flex:none;background:var(--side);color:var(--side-ink);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;padding:14px 10px}
.side-brand{display:flex;align-items:center;gap:10px;padding:6px 8px 14px}.side-brand strong{display:block;font-size:16px}.side-brand small{color:var(--side-muted)}
.logo{width:38px;height:38px;border-radius:12px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:800}
.side-group{margin-top:10px}.side-label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--side-muted);padding:4px 10px}
.side-link{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;color:var(--side-ink);text-decoration:none;font-weight:600}
.side-link:hover{background:var(--side-hover)}.side-link.on{background:var(--accent);color:#fff}
.side-link .badge{margin-left:auto}.badge{background:#e53935;color:#fff;border-radius:99px;font-size:12px;font-weight:800;padding:1px 8px;min-width:22px;text-align:center}
.side-user{margin-top:auto;border-top:1px solid var(--side-hover);padding-top:10px}
.side-user .me{display:flex;align-items:center;gap:10px;padding:6px 8px}.side-user .me small{display:block;color:var(--side-muted)}
.side-user form{margin:0}.side-user button{all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;font-weight:600;width:calc(100% - 20px)}
.side-user button:hover{background:var(--side-hover)}
.main-col{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:5;background:var(--surface);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;padding:12px 24px}
.topbar h1{font-size:20px;margin:0;flex:1}.topbar .menu{display:none;cursor:pointer;color:var(--text)}
main{padding:20px 24px 90px;max-width:1080px;width:100%}
.lead{color:var(--muted);margin:0 0 16px}
.toast{display:flex;gap:10px;align-items:center;padding:12px 16px;border-radius:14px;margin-bottom:16px;font-weight:600;box-shadow:var(--shadow)}
.toast.good{background:var(--good-bg);color:var(--good)}.toast.bad{background:var(--bad-bg);color:var(--bad)}.toast.info{background:var(--info-bg);color:var(--info)}
.card{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px;margin-bottom:16px}
.card h2{font-size:17px;margin:0 0 8px}
.section{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:16px;overflow:hidden}
.section>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:14px 18px;font-weight:800;font-size:16px}
.section>summary::-webkit-details-marker,.item>summary::-webkit-details-marker{display:none}
.section>summary:hover{background:var(--surface-2)}.sec-title{flex:1}
.count{background:var(--muted-bg);color:var(--muted);border-radius:99px;padding:1px 10px;font-size:13px}
.section.attention .count{background:var(--bad);color:#fff}.section.attention>summary{color:var(--bad)}
.chev{transition:transform .15s;color:var(--muted)}details[open]>summary>.chev{transform:rotate(90deg)}
.hint{color:var(--muted);margin:-4px 18px 10px;font-size:14px}.sec-body{padding:0 10px 10px}
.item{border-radius:12px}.item+.item{border-top:1px solid var(--line)}
.item-head{display:flex;align-items:center;gap:12px;padding:10px 8px;list-style:none}
details.item>summary{cursor:pointer;border-radius:12px}details.item>summary:hover{background:var(--surface-2)}
.item .title{font-weight:700}.item .sub{color:var(--muted);font-size:14px}
.item-body{padding:4px 12px 14px 60px}.item.flat .item-head{cursor:default}
.grow{flex:1;min-width:0}
.avatar{--h:160;width:40px;height:40px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:800;font-size:14px;color:#fff;background:hsl(var(--h) 45% 42%)}
.avatar.lg{width:56px;height:56px;font-size:18px}
.chip{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:99px;font-size:13px;font-weight:700;white-space:nowrap}
.good{background:var(--good-bg);color:var(--good)}.warn{background:var(--warn-bg);color:var(--warn)}.bad{background:var(--bad-bg);color:var(--bad)}.info{background:var(--info-bg);color:var(--info)}.muted{background:var(--muted-bg);color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.bubble{background:var(--accent-soft);border-radius:4px 14px 14px 14px;padding:10px 14px;margin:6px 0 10px;white-space:pre-line;max-width:640px}
.meta{color:var(--muted);font-size:14px;margin:4px 0}.meta b{color:var(--text)}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.actions form{margin:0}
label{display:block;font-weight:700;margin:12px 0 4px;font-size:14px}
input[type=text],input[type=email],input[type=password],input[type=date],input[type=time],input[type=number],textarea,select{width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);font:inherit}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
textarea{min-height:90px;resize:vertical}
.check{display:flex;gap:8px;align-items:center;font-weight:600;margin-top:12px}.check input{width:18px;height:18px;accent-color:var(--accent)}
button,.btn{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:var(--accent-ink);border:0;border-radius:99px;padding:10px 18px;font:inherit;font-weight:800;cursor:pointer;text-decoration:none;margin-top:12px}
button:hover,.btn:hover{filter:brightness(1.05)}button.plain,.btn.plain{background:var(--muted-bg);color:var(--text)}
button.danger{background:transparent;color:var(--bad);box-shadow:inset 0 0 0 1.5px var(--bad)}button:disabled{opacity:.55;cursor:default;filter:none}
.actions button,.actions .btn{margin-top:0}button.sm{padding:6px 14px;font-size:14px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.row>*{flex:1;min-width:140px}
input[type=date],input[type=time]{min-width:0;max-width:100%;min-height:46px;-webkit-appearance:none;appearance:none;display:block;text-align:left}
input::-webkit-date-and-time-value{text-align:left}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.small{font-size:13px;color:var(--muted)}code{background:var(--muted-bg);padding:2px 6px;border-radius:6px;font-size:13px}
.empty{color:var(--muted);text-align:center;padding:18px}
.summary-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}.summary-chips .chip{font-size:14px;padding:6px 14px;box-shadow:var(--shadow)}
.hero{display:flex;flex-direction:column;align-items:center;text-align:center;padding:26px 18px}
.hero .date{color:var(--muted);font-weight:700}.hero h2{font-size:24px;margin:4px 0 6px}
.checkin{width:170px;height:170px;border-radius:50%;font-size:22px;justify-content:center;flex-direction:column;gap:2px;margin:18px 0 10px;box-shadow:0 10px 30px color-mix(in srgb,var(--accent) 45%,transparent)}
.checkin.done{background:var(--good-bg);color:var(--good);box-shadow:none}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%}
.hist th,.hist td{text-align:center;padding:5px 3px;min-width:30px;font-size:13px;border-bottom:1px solid var(--line)}
.hist td:first-child,.hist th:first-child{text-align:left;white-space:nowrap;position:sticky;left:0;background:var(--surface);padding-right:10px;font-weight:700}
.cell{display:inline-block;width:26px;height:26px;line-height:26px;border-radius:8px;font-weight:800;font-size:13px}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:6px 0 12px;font-size:13px;color:var(--muted)}
.days{display:inline-flex;flex-wrap:wrap;gap:4px}.days label{margin:0;font-weight:700;font-size:13px}
.days input{position:absolute;opacity:0;pointer-events:none}.days span{display:inline-block;padding:4px 9px;border-radius:99px;background:var(--muted-bg);color:var(--muted);cursor:pointer}
.days input:checked+span{background:var(--accent);color:#fff}.days input:focus-visible+span{outline:2px solid var(--accent)}
.assign{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 0;border-bottom:1px dashed var(--line)}
.assign input[type=time],.assign select{width:auto}.assign .who{display:flex;align-items:center;gap:8px;font-weight:700;min-width:170px}
.cal{width:48px;flex:none;border-radius:12px;overflow:hidden;text-align:center;box-shadow:var(--shadow);background:var(--surface)}
.cal .m{background:#e53935;color:#fff;font-size:11px;font-weight:800;text-transform:uppercase;padding:2px 0}.cal .d{font-size:18px;font-weight:800;padding:2px 0}
.auth{min-height:100vh;display:grid;place-items:center;padding:16px}.auth .card{width:100%;max-width:420px;padding:28px}
.auth .logo{width:52px;height:52px;font-size:20px;margin-bottom:10px}
.tabbar{display:none}
.scrim{display:none}#nav-toggle{display:none}
/* Page changes: the content fades and slides slightly while the menu and bars stay still. */
@view-transition{navigation:auto}
.sidebar{view-transition-name:sidebar}.topbar{view-transition-name:topbar}.tabbar{view-transition-name:tabbar}
::view-transition-old(root){animation:vt-out .16s ease-in both}::view-transition-new(root){animation:vt-in .24s cubic-bezier(.2,.8,.2,1) both}
@keyframes vt-out{to{opacity:0;transform:translateY(-4px)}}@keyframes vt-in{from{opacity:0;transform:translateY(8px)}}
/* Sections slide open and closed (in browsers that support it; others just open). */
@supports selector(::details-content){:root{interpolate-size:allow-keywords}
  details::details-content{height:0;overflow:clip;transition:height .24s cubic-bezier(.2,.8,.2,1),content-visibility .24s allow-discrete}
  details[open]::details-content{height:auto}}
main>*{animation:rise .28s cubic-bezier(.2,.8,.2,1) both}main>*:nth-child(2){animation-delay:.03s}main>*:nth-child(3){animation-delay:.06s}main>*:nth-child(n+4){animation-delay:.09s}
@keyframes rise{from{opacity:0;transform:translateY(6px)}}
button,.btn,.side-link,details>summary,.chip{transition:background-color .15s,color .15s,transform .1s,box-shadow .15s,filter .15s}
button:active,.btn:active{transform:scale(.97)}
:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 60%,transparent);outline-offset:2px;border-radius:10px}
button.busy{pointer-events:none;opacity:.8}
button.busy::after{content:"";width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:spin .7s linear infinite}
.checkin.busy::after{width:22px;height:22px}
@keyframes spin{to{transform:rotate(360deg)}}
.toast{transition:opacity .4s,transform .4s,max-height .4s,margin .4s,padding .4s;max-height:200px;overflow:hidden}
.toast.hide{opacity:0;transform:translateY(-6px);max-height:0;margin:0;padding-top:0;padding-bottom:0}
.search{display:flex;align-items:center;gap:8px;background:var(--surface);border-radius:99px;box-shadow:var(--shadow);padding:4px 16px;margin-bottom:16px}
.search input{border:0;box-shadow:none;background:transparent;padding:10px 0}.search input:focus{box-shadow:none}
.no-results{display:none}
.timerbar{display:flex;align-items:center;gap:10px;background:var(--accent-soft);color:var(--text);border-radius:14px;padding:8px 10px 8px 14px;margin-bottom:16px;box-shadow:var(--shadow);text-decoration:none}
.timerbar a{color:inherit;text-decoration:none}.timerbar form{margin:0}.timerbar button{margin:0}
.timerbar.stopped{background:var(--warn-bg);color:var(--warn);padding:12px 14px}
#timer{scroll-margin-top:80px}[data-since],.bigtime{font-variant-numeric:tabular-nums}.bigtime{font-size:36px;font-weight:800;line-height:1.2}
.proj-tabs{margin:0 0 16px}.proj-tabs .chip{text-decoration:none;font-size:14px;padding:7px 14px;box-shadow:var(--shadow)}.proj-tabs .chip.on{background:var(--accent);color:#fff}
.inline-add{display:flex;gap:8px;align-items:center;padding:8px}.inline-add input{flex:1}.inline-add button{margin:0}
.list-opts{margin:4px 8px 0}.list-opts>summary{cursor:pointer;color:var(--muted);font-size:13px;font-weight:700;list-style:none;padding:4px 0}
.item-head .sm{margin:0}.item-head button:disabled{opacity:.4}
.week{display:flex;flex-wrap:wrap;gap:18px;align-items:center}
.rate{width:96px;height:96px;border-radius:50%;display:grid;place-items:center;flex:none;
  background:conic-gradient(var(--accent) calc(var(--p)*1%),var(--muted-bg) 0)}
.rate>div{width:74px;height:74px;border-radius:50%;background:var(--surface);display:grid;place-items:center;font-size:22px;font-weight:800}
.week h2{margin:0 0 4px}.updated{color:var(--muted);font-size:13px;margin:-8px 0 12px}
.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.cal-grid .dow{font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;text-align:center;padding:4px 0}
.day{background:var(--surface-2);border-radius:12px;min-height:92px;padding:6px;display:flex;flex-direction:column;gap:4px;min-width:0}
.day.out{opacity:.35}.day.today{box-shadow:inset 0 0 0 2px var(--accent)}.day.weekend{background:transparent;box-shadow:inset 0 0 0 1px var(--line)}
.day .n{font-size:13px;font-weight:800;color:var(--muted)}.day.today .n{color:var(--accent)}
.ev{display:block;font-size:12px;font-weight:700;padding:2px 6px;border-radius:6px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev.time_off{background:var(--good-bg);color:var(--good)}.ev.emergency{background:var(--info-bg);color:var(--info)}
.ev.pending{background:transparent;color:var(--warn);box-shadow:inset 0 0 0 1.5px var(--warn)}.ev.holiday{background:#e53935;color:#fff}
.cal-list{display:none}
@media (max-width:700px){.cal-grid{display:none}.cal-list{display:block}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after,::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important;transition:none!important}}
@media (max-width:860px){
  .sidebar{position:fixed;z-index:20;left:0;top:0;transform:translateX(-100%);transition:transform .2s;box-shadow:0 0 40px rgba(0,0,0,.3)}
  #nav-toggle:checked~.app .sidebar{transform:none}
  #nav-toggle:checked~.app .scrim{display:block;position:fixed;inset:0;z-index:15;background:rgba(0,0,0,.35)}
  .topbar{background:var(--brand);color:#fff;border:0;padding:12px 16px}.topbar .menu{display:inline-flex;color:#fff}
  main{padding:16px 16px 96px}.item-body{padding-left:12px}
  .row{flex-direction:column;align-items:stretch;gap:0}.row>*{min-width:0;width:100%}
  input,select,textarea{font-size:16px}
  .inline-add{flex-wrap:wrap}.inline-add input{flex:1 1 12em;min-width:0}
  .item-head .chip{white-space:normal;text-align:center}
  .item.stack>.item-head{flex-wrap:wrap;row-gap:8px}.item.stack>.item-head>.grow{flex:1 1 100%}.item.stack>.item-head>.grow+*{margin-left:auto}
  .sec-title{min-width:0;hyphens:auto;-webkit-hyphens:auto;overflow-wrap:break-word}
  .tabbar{display:flex;position:fixed;bottom:0;left:0;right:0;z-index:10;background:var(--surface);border-top:1px solid var(--line);padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
  .tabbar a,.tabbar label{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;font-weight:700;color:var(--muted);text-decoration:none;position:relative;cursor:pointer;margin:0}
  .tabbar .on{color:var(--brand)}.tabbar .badge{position:absolute;top:-4px;left:52%;font-size:10px;padding:0 6px}
}
`;

// ---- Page frame ----

const SCRIPT = `<script type="speculationrules">{"prefetch":[{"where":{"href_matches":"/*"},"eagerness":"moderate"}]}</script>
<script>
(function () {
  // A page animation is skipped when the window isn't visible; that's fine, so don't report it as an error.
  function quiet(e) {
    var t = e.viewTransition;
    if (t) ['ready', 'finished', 'updateCallbackDone'].forEach(function (k) { if (t[k]) t[k].catch(function () {}); });
  }
  window.addEventListener('pagereveal', quiet);
  window.addEventListener('pageswap', quiet);
  // Buttons: ask first when needed, show a spinner, and ignore a second click while the page loads.
  document.addEventListener('submit', function (e) {
    var form = e.target, button = e.submitter;
    var question = (button && button.dataset.confirm) || form.dataset.confirm;
    if (question && !window.confirm(question)) { e.preventDefault(); return; }
    if (form.dataset.busy) { e.preventDefault(); return; }
    form.dataset.busy = '1';
    if (button) button.classList.add('busy');
  });
  // Coming back with the Back button: make the buttons usable again.
  window.addEventListener('pageshow', function () {
    document.querySelectorAll('form[data-busy]').forEach(function (f) {
      delete f.dataset.busy;
      f.querySelectorAll('.busy').forEach(function (b) { b.classList.remove('busy'); });
    });
  });
  // Success messages fade away; the message is removed from the address so a refresh doesn't repeat it.
  var toast = document.querySelector('.toast.good[role=status], .toast.info[role=status]');
  if (toast) setTimeout(function () { toast.classList.add('hide'); }, 5000);
  if (/[?&]msg=/.test(location.search)) {
    var url = new URL(location.href); url.searchParams.delete('msg');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  // Search boxes: hide rows that don't contain the typed text.
  document.querySelectorAll('[data-filter]').forEach(function (input) {
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase(), shown = 0;
      document.querySelectorAll(input.dataset.filter).forEach(function (row) {
        var match = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
        row.hidden = !match; if (match) shown++;
      });
      var none = document.querySelector(input.dataset.empty);
      if (none) none.style.display = shown ? 'none' : 'block';
    });
  });
  // Pages with data-autorefresh (Today) reload their content every minute, keeping open rows open.
  var live = document.querySelector('[data-autorefresh]');
  function stamp() {
    var s = document.querySelector('[data-updated]');
    if (s) s.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  stamp();
  if (live) setInterval(function () {
    if (document.hidden) return;
    var a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    fetch(location.href, { credentials: 'same-origin' }).then(function (r) {
      return r.ok && !r.redirected ? r.text() : null;
    }).then(function (html) {
      if (!html) return;
      var fresh = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-autorefresh]');
      if (!fresh) return;
      var open = {};
      live.querySelectorAll('details[data-key]').forEach(function (d) { open[d.dataset.key] = d.open; });
      fresh.querySelectorAll('details[data-key]').forEach(function (d) { if (d.dataset.key in open) d.open = open[d.dataset.key]; });
      fresh.style.animation = 'none';
      live.replaceWith(fresh); live = fresh; stamp();
    }).catch(function () {});
  }, 60000);
  // Running timers count up every second.
  function tick() {
    document.querySelectorAll('[data-since]').forEach(function (el) {
      var s = Math.max(0, Math.floor((Date.now() - Date.parse(el.dataset.since)) / 1000));
      var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
      el.textContent = h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
    });
  }
  tick(); setInterval(tick, 1000);
  // Phone menu: close it when a link inside it is tapped.
  var toggle = document.getElementById('nav-toggle');
  if (toggle) document.querySelectorAll('.sidebar a').forEach(function (a) {
    a.addEventListener('click', function () { toggle.checked = false; });
  });
})();
</script>`;

export function layout({ title, user, active, message, body }) {
  const msg = MESSAGES[message];
  const toast = msg ? `<div class="toast ${msg[0]}" role="status">${msg[0] === 'good' ? icon('check') : ''}${esc(msg[1])}</div>` : '';
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#008069"><link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="InoVA"><meta name="apple-mobile-web-app-status-bar-style" content="default"><title>${esc(title)} · InoVA Check-in</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>`;

  // Log-in and set-up pages: a simple centered card.
  if (!user) return `${head}<div class="auth"><div>${toast}${body}</div></div>${SCRIPT}</body></html>`;

  const pending = user.pending_requests || 0;
  const groups = [];
  if (user.is_va) groups.push(['Me', [['/va', 'My day', 'sun'], ['/va/work', 'Tasks & time', 'tasks']]]);
  if (user.is_admin) {
    groups.push(['Daily', [['/admin', 'Today', 'today'], ['/admin/time-off', 'Time off', 'timeoff', pending], ['/admin/calendar', 'Calendar', 'calendar'], ['/admin/history', 'History', 'history']]]);
    groups.push(['Setup', [['/admin/projects', 'Projects', 'projects'], ['/admin/people', 'People', 'people'],
      ['/admin/holidays', 'Holidays', 'holidays'], ['/admin/settings', 'Settings', 'settings']]]);
  }
  const link = ([href, label, ic, badge]) =>
    `<a class="side-link ${href === active ? 'on' : ''}" href="${href}">${icon(ic)}<span>${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
  const sidebar = `<aside class="sidebar" aria-label="Menu">
    <div class="side-brand"><div class="logo">IV</div><div><strong>InoVA Check-in</strong><small>InoVA Local</small></div></div>
    ${groups.map(([label, links]) => `<div class="side-group"><div class="side-label">${label}</div>${links.map(link).join('')}</div>`).join('')}
    <div class="side-user">
      <div class="me">${avatar(user.name)}<div><strong>${esc(user.name)}</strong><small>${user.is_admin ? 'Admin' : 'VA'}</small></div></div>
      <a class="side-link ${active === '/account' ? 'on' : ''}" href="/account">${icon('key')}<span>Password</span></a>
      <form method="post" action="/logout"><button>${icon('logout')}<span>Log out</span></button></form>
    </div>
  </aside>`;

  // Phone bottom bar: the most-used pages, plus "Menu" for the rest.
  const tabs = user.is_admin
    ? [['/admin', 'Today', 'today'], ['/admin/time-off', 'Time off', 'timeoff', pending], ['/admin/projects', 'Projects', 'projects'], ['/admin/people', 'People', 'people']]
    : [['/va', 'My day', 'sun'], ['/va/work', 'Tasks & time', 'tasks']];
  const tabbar = `<nav class="tabbar" aria-label="Main pages">${tabs.map(([href, label, ic, badge]) =>
    `<a href="${href}" class="${href === active ? 'on' : ''}">${icon(ic)}${label}${badge ? `<span class="badge">${badge}</span>` : ''}</a>`).join('')}
    <label for="nav-toggle">${icon('menu')}Menu</label></nav>`;

  return `${head}<input type="checkbox" id="nav-toggle" aria-hidden="true">
<div class="app">${sidebar}<label for="nav-toggle" class="scrim" aria-hidden="true"></label>
  <div class="main-col">
    <header class="topbar"><label for="nav-toggle" class="menu" aria-label="Open menu">${icon('menu')}</label><h1>${esc(title)}</h1></header>
    <main>${toast}${active === '/va/work' ? '' : timerBar(user)}${body}</main>
  </div>
</div>${tabbar}${SCRIPT}</body></html>`;
}

// A bar at the top of every page while a VA's timer runs (or waits to be saved).
function timerBar(user) {
  const t = user.timer;
  if (!t) return '';
  const where = `${esc(t.task_name || 'General')}${t.client ? ` · ${esc(t.client)}` : ''}`;
  const href = `/va/work?project=${encodeURIComponent(t.project_id)}#timer`;
  if (t.stopped_at) {
    return `<a class="timerbar stopped" href="${href}">${icon('timer')}<span class="grow"><b>Timer stopped${t.auto_stopped ? ' after 8 hours' : ''}.</b> Add notes and save it: ${where}</span>${icon('chevron')}</a>`;
  }
  return `<div class="timerbar">${icon('timer')}<a class="grow" href="${href}"><b data-since="${esc(t.started_at)}">0:00:00</b> · ${where}</a>
    <form method="post" action="/va/work/timer/stop"><input type="hidden" name="project" value="${esc(t.project_id)}"><button class="sm">${icon('stop')} Stop</button></form></div>`;
}

// ---- Login pages ----

export function loginPage(error, email = '') {
  const errors = { wrong: 'That email and password do not match.', locked: 'Too many tries. Please wait 15 minutes and try again.', inactive: 'This account is not active. Please contact an admin.' };
  return layout({
    title: 'Log in',
    body: `<div class="card">
      <div class="logo">IV</div>
      <h2 style="font-size:22px">Welcome back</h2>
      <p class="lead">Log in to the InoVA check-in app.</p>
      ${error ? `<div class="toast bad">${esc(errors[error] || error)}</div>` : ''}
      <form method="post" action="/login">
        <label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username" value="${esc(email)}"${email ? '' : ' autofocus'}>
        <label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password"${email ? ' autofocus' : ''}>
        <label class="check"><input type="checkbox" name="remember" value="1" checked> Keep me logged in on this device</label>
        <p class="small" style="margin:4px 0 0 26px">Untick this on a shared computer.</p>
        <button style="width:100%;justify-content:center">Log in</button>
      </form>
      <p class="small" style="margin-top:14px">Forgot your password? Ask an admin to set a temporary one for you.</p>
    </div>`,
  });
}

export function setupPage(admins, error) {
  return layout({
    title: 'First-time setup',
    body: `<div class="card">
      <div class="logo">IV</div>
      <h2 style="font-size:22px">First-time setup</h2>
      <p class="lead">No admin has a password yet. Choose your email and set your password. After that, this page stops working and you set up everyone else from the People page.</p>
      ${error ? `<div class="toast bad">${esc(error)}</div>` : ''}
      <form method="post" action="/setup">
        <label for="email">Your email</label>
        <select id="email" name="email">${admins.map((a) => `<option>${esc(a.email)}</option>`).join('')}</select>
        <label for="password">New password (at least 10 characters)</label><input id="password" name="password" type="password" required minlength="10" autocomplete="new-password">
        <label for="confirm">Type it again</label><input id="confirm" name="confirm" type="password" required autocomplete="new-password">
        <button style="width:100%;justify-content:center">Save and log in</button>
      </form></div>`,
  });
}

export function accountPage(user, error, message) {
  return layout({
    title: 'Password', user, active: '/account', message,
    body: `<div class="card" style="max-width:480px">
      <h2>${user.must_change_password ? 'Choose your own password' : 'Change your password'}</h2>
      ${user.must_change_password ? '<p class="lead">You logged in with a temporary password. Please choose your own password to continue.</p>' : ''}
      ${error ? `<div class="toast bad">${esc(error)}</div>` : ''}
      <form method="post" action="/account">
        <label for="current">Current password</label><input id="current" name="current" type="password" required autocomplete="current-password">
        <label for="password">New password (at least 10 characters)</label><input id="password" name="password" type="password" required minlength="10" autocomplete="new-password">
        <label for="confirm">Type it again</label><input id="confirm" name="confirm" type="password" required autocomplete="new-password">
        <button>Save password</button>
      </form></div>`,
  });
}

// ---- VA page ----

export function vaPage({ user, day, today, requests, history, formUrl, message }) {
  let status;
  if (today?.checked_in_at) {
    status = `${pill(today.status)}<p class="meta">You checked in at <b>${esc(formatTimeIn(today.checked_in_at, day.zone))} ${esc(day.zoneLabel)}</b>.</p>`;
  } else if (today?.status === 'called_out') {
    status = `${pill('called_out')}<p class="meta">You called out today. Feel better soon.</p>`;
  } else if (['time_off', 'emergency', 'coverage'].includes(today?.status) || day.onTimeOff) {
    const kind = ['emergency', 'coverage'].includes(today?.status) ? today.status : today ? 'time_off' : day.timeOffKind;
    status = `${pill(kind)}<p class="meta">You are off today. No check-in is needed.</p>`;
  } else if (day.exempt) {
    status = '<p class="meta">You do not need to check in, but you can if you want to.</p>';
  } else if (day.holiday) {
    status = `${chip(`Holiday: ${day.holiday.name}`, 'info')}<p class="meta">No check-in is needed today.</p>`;
  } else if (!day.expected) {
    status = `<p class="meta">No check-in is needed today${day.projects.length ? ' (your projects today have no fixed start time)' : ' (you have no projects today)'}, but you can still check in.</p>`;
  } else {
    status = `<p class="meta">Please check in by <b>${esc(day.startLabel)}</b>.</p>`;
  }
  const checkedIn = Boolean(today?.checked_in_at);
  const projects = day.projects.length
    ? `<div class="chips" style="justify-content:center">${day.projects.map((p) => chip(`${p.client}${p.start ? ` · ${formatHM(p.start)}` : ''}`, 'muted')).join('')}</div>
       ${day.projects.length > 1 ? '<p class="small">One check-in covers all of these. It is due at the earliest start time.</p>' : ''}`
    : '';

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  return layout({
    title: 'My day', user, active: '/va', message,
    body: `<div class="card hero">
      <div class="date">${esc(formatDate(day.local.date, true))} · ${esc(day.zoneLabel)}</div>
      <h2>Hi ${esc(user.name.split(' ')[0])} 👋</h2>
      ${projects}
      ${day.projectsOffNames ? `<p class="small">Approved time off today for: ${esc(day.projectsOffNames)}.</p>` : ''}
      <form method="post" action="/va/checkin"><button class="checkin ${checkedIn ? 'done' : ''}" ${checkedIn ? 'disabled' : ''}>${checkedIn ? `${icon('check')} Checked in` : 'Check in'}</button></form>
      ${status}
      ${day.projects.length ? `<a class="btn plain" href="/va/work">${icon('tasks')} Tasks &amp; time</a><p class="small">Starting a timer there also checks you in.</p>` : ''}
    </div>
    ${section({
      title: 'Need time off?', open: false,
      body: `<div style="padding:0 8px 8px">
        <p class="meta"><b>At least 2 weeks ahead:</b> send the request form. Type your name exactly as it appears here: <strong>${esc(user.name)}</strong>. Your request shows up below once it is received.</p>
        <a class="btn" href="${esc(formUrl || '#')}" target="_blank" rel="noopener">${icon('external')} Open the request form</a>
        <p class="meta" style="margin-top:18px"><b>Sooner than 2 weeks, or can't work today?</b> Message your management channel on Slack right away, so your team can plan coverage.</p>
        ${user.slack_channel_id ? `<a class="btn plain" href="https://slack.com/app_redirect?channel=${encodeURIComponent(user.slack_channel_id)}" target="_blank" rel="noopener">${icon('external')} Open my management channel</a>` : ''}
      </div>`,
    })}
    ${section({ title: 'My requests', count: requests.length, open: pendingCount > 0, body: requestCards(requests, false) })}
    ${section({
      title: 'Tips', open: false,
      body: `<div style="padding:0 8px 8px">
        <p><strong>${icon('phone')} Put this app on your phone.</strong><br>
        <span class="small">iPhone: open this page in Safari, tap Share, then "Add to Home Screen". Android: open it in Chrome, tap the three dots, then "Install app" or "Add to Home screen".</span></p>
        ${user.slack_user_id ? `<p><strong>Check in from Slack.</strong><br><span class="small">Type <code>/checkin</code> in any Slack channel.</span></p>` : ''}
      </div>`,
    })}
    ${section({
      title: 'My last 30 days', count: history.length, open: false,
      body: history.length ? history.map((h) => item({
        title: esc(formatDate(h.work_date)),
        sub: h.checked_in_at ? `Checked in at ${esc(formatTimeIn(h.checked_in_at, day.zone))}` : '',
        side: pill(h.status),
      })).join('') : empty('Nothing yet.'),
    })}`,
  });
}

// ---- Time-off requests ----

const KIND_LABEL = { time_off: 'Time off', emergency: 'Emergency', coverage: 'Time off' };
const REQUEST_TONE = { pending: 'warn', approved: 'good', denied: 'bad', cancelled: 'muted' };
const needsBackup = (r) => r.kind !== 'emergency' && Boolean(r.needs_coverage);

// Requests as clickable rows. Admins (ctx.vas set) also get actions and the edit form.
function requestCards(requests, forAdmin, ctx = {}) {
  if (!requests.length) return empty('No requests.');
  return requests.map((r) => {
    const status = chip(r.status[0].toUpperCase() + r.status.slice(1), REQUEST_TONE[r.status]);
    const coverage = r.needs_coverage
      ? (needsBackup(r) ? (r.backup_name ? `Covered by ${esc(r.backup_name)}` : '<span style="color:var(--warn);font-weight:700">Backup not chosen</span>') : 'Coverage needed')
      : 'No coverage needed';
    const shortNotice = !r.added_by_admin && r.created_at && r.start_date < addDays(r.created_at.slice(0, 10), 14);
    const sub = `${esc(dateRange(r.start_date, r.end_date))} · ${coverage}${shortNotice ? ` · <span style="color:var(--warn);font-weight:700">Less than 2 weeks' notice</span>` : ''}`;
    const body = `
      ${r.details || r.note ? `<div class="bubble">${esc([r.details, r.note].filter(Boolean).join('\n'))}</div>` : ''}
      <p class="meta">${r.added_by_admin ? 'Added by an admin' : r.source === 'form' ? 'From the request form' : 'Request'}
        · ${r.project_names ? `Only these projects: <b>${esc(r.project_names)}</b>` : 'All projects'}
        ${r.decided_by_name ? ` · ${esc(r.status)} by <b>${esc(r.decided_by_name)}</b>` : ''}</p>
      ${forAdmin && r.clickup_list_url ? `<p class="meta"><a href="${esc(r.clickup_list_url)}" target="_blank" rel="noopener">${icon('external')} Open the ClickUp checklist</a></p>` : ''}
      ${forAdmin && r.status === 'approved' && needsBackup(r) && !r.clickup_list_url && r.clickup_error
        ? `<p class="meta" style="color:var(--bad)">ClickUp: ${esc(r.clickup_error)}</p>` : ''}
      ${forAdmin ? requestActions(r, ctx) : ''}`;
    return item({
      name: forAdmin ? r.name : undefined,
      title: `${forAdmin ? `${esc(r.name)} · ` : ''}${KIND_LABEL[r.kind] || 'Time off'}`,
      sub, side: status, body, open: forAdmin && r.status === 'pending',
    });
  }).join('');
}

function requestActions(r, ctx) {
  const buttons = [];
  if (r.status === 'pending') {
    if (needsBackup(r) && !r.backup_name) buttons.push('<span class="small">Choose who covers (Edit) before approving.</span>');
    buttons.push(`<form method="post" action="/admin/time-off/${r.id}/approve"><button class="sm">${icon('check')} Approve</button></form>`);
    buttons.push(`<form method="post" action="/admin/time-off/${r.id}/deny" data-confirm="Deny this request?"><button class="sm danger">Deny</button></form>`);
  }
  if (r.status === 'approved' && needsBackup(r) && !r.clickup_list_url) {
    buttons.push(`<form method="post" action="/admin/time-off/${r.id}/clickup"><button class="sm plain">Create ClickUp checklist</button></form>`);
  }
  if (r.status === 'approved' && r.cancellable) {
    buttons.push(`<form method="post" action="/admin/time-off/${r.id}/cancel" data-confirm="Cancel this time off? Check-ins will be expected again from today."><button class="sm danger">Cancel time off</button></form>`);
  }
  const edit = ['pending', 'approved'].includes(r.status) && ctx.vas ? editForm(r, ctx) : '';
  return `<div class="actions">${buttons.join('')}</div>${edit}`;
}

// The admin form to change a request's VA, type, dates, coverage and backup VA.
function editForm(r, { vas, backups }) {
  const requester = vas.find((v) => v.id === r.user_id);
  // The VA taking time off can't cover for themselves.
  const choices = backups.filter((b) => !requester || (b.zoho_id !== requester.zoho_id && b.name !== requester.name));
  return `<details class="section" style="margin:12px 0 0;box-shadow:none;background:var(--surface-2)"><summary>Edit${icon('chevron', 'chev')}</summary>
    <form method="post" action="/admin/time-off/${r.id}/edit" style="padding:0 16px 14px">
      <div class="row">
        <div><label>VA</label><select name="user_id">${vas.map((v) => `<option value="${v.id}" ${v.id === r.user_id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
        <div><label>Type</label><select name="kind">
          <option value="time_off" ${r.kind !== 'emergency' ? 'selected' : ''}>Time off</option>
          <option value="emergency" ${r.kind === 'emergency' ? 'selected' : ''}>Emergency</option></select></div>
      </div>
      <div class="row">
        <div><label>First day</label><input type="date" name="start_date" value="${esc(r.start_date)}" required></div>
        <div><label>Last day</label><input type="date" name="end_date" value="${esc(r.end_date)}" required></div>
      </div>
      <label class="check"><input type="checkbox" name="needs_coverage" value="1" ${r.needs_coverage ? 'checked' : ''}> Coverage needed</label>
      <label>Who covers (for time off that needs coverage)</label>
      <select name="backup"><option value="">Not chosen yet</option>${choices.map((b) =>
        `<option value="${esc(b.zoho_id)}" ${b.zoho_id === r.backup_zoho_id ? 'selected' : ''}>${esc(b.name)} (${esc(b.status)})</option>`).join('')}</select>
      <button>Save changes</button>
    </form></details>`;
}

// Form responses whose name matched no VA. The admin picks the VA; that VA's projects then
// appear as checkboxes, all ticked, and the admin unticks any the request does not cover.
function unmatchedCards(unmatched, vas, vaProjects) {
  const projectsOf = (vaId) => vaProjects.filter((p) => p.user_id === vaId);
  return unmatched.map((u) => item({
    name: u.name,
    title: `${esc(u.name)} · Time off`,
    sub: `${esc(dateRange(u.start_date, u.end_date))} · <span style="color:var(--warn);font-weight:700">No VA matched this name</span>`,
    side: chip('Needs a VA', 'warn'),
    open: true,
    body: `${u.details || u.note ? `<div class="bubble">${esc([u.details, u.note].filter(Boolean).join('\n'))}</div>` : ''}
      <form method="post" action="/admin/form-unmatched/${u.id}/assign">
        <label>Who is this?</label>
        <select name="user_id" required aria-label="VA"
          onchange="var va = this.value; this.form.querySelectorAll('[data-va]').forEach(function (g) { g.hidden = g.dataset.va !== va; })">
          <option value="">Choose a VA</option>${vas.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}
        </select>
        ${vas.map((v) => {
          const list = projectsOf(v.id);
          return `<div data-va="${v.id}" hidden>
            ${list.length
              ? `<label>Projects this request covers</label>${list.map((p) => `<label class="check" style="margin-top:6px"><input type="checkbox" name="projects_${v.id}" value="${esc(p.id)}" checked> ${esc(p.client)}</label>`).join('')}`
              : '<p class="small">This VA has no projects, so the request covers the whole day.</p>'}
          </div>`;
        }).join('')}
        <div class="actions"><button class="sm">Assign</button></div>
      </form>
      <form method="post" action="/admin/form-unmatched/${u.id}/discard" class="actions" data-confirm="Discard this form response? It can't be brought back."><button class="sm danger">Discard</button></form>`,
  })).join('');
}

// ---- Admin pages ----

// How a VA's day looks on the Today page: the chip, and which group the VA is listed in.
export function todayStatus(row, day, now) {
  if (row) {
    if (row.status === 'pending') {
      const mins = Math.floor((now - new Date(row.scheduled_start)) / 60000);
      return mins < 0 ? { label: 'Not started yet', tone: 'muted', group: 'upcoming' } : { label: `${mins} min late`, tone: 'bad', group: 'attention' };
    }
    if (row.status === 'missed') return { label: 'No check-in', tone: 'bad', group: 'attention' };
    if (['on_time', 'late', 'checked_in'].includes(row.status)) {
      const [label, tone] = STATUS[row.status];
      return { label, tone, group: 'in' };
    }
    const [label, tone] = STATUS[row.status] || [row.status, 'muted'];
    return { label, tone, group: row.status === 'exempt' ? 'none' : 'off' };
  }
  if (day.exempt) return { label: 'Exempt', tone: 'muted', group: 'none' };
  if (day.onTimeOff) return { label: STATUS[day.timeOffKind][0], tone: STATUS[day.timeOffKind][1], group: 'off' };
  if (day.holiday) return { label: 'Holiday', tone: 'info', group: 'off' };
  if (!day.expected) return { label: 'No check-in today', tone: 'muted', group: 'none' };
  return { label: 'Not started yet', tone: 'muted', group: 'upcoming' };
}

export function adminTodayPage({ user, rows, week, message }) {
  const groups = [
    ['attention', 'Needs attention', 'attention', true],
    ['in', 'Checked in', '', true],
    ['upcoming', 'Not started yet', '', true],
    ['off', 'Off today', '', false],
    ['none', 'Not checked today', '', false],
  ];
  const by = (g) => rows.filter((r) => r.status.group === g);
  const summary = groups.filter(([g]) => by(g).length).map(([g, label]) =>
    chip(`${by(g).length} ${label.toLowerCase()}`, g === 'attention' ? 'bad' : g === 'in' ? 'good' : 'muted')).join('');
  const rowHtml = (r) => item({
    name: r.name, key: `va-${r.name}`,
    title: esc(r.name),
    sub: `${esc(r.projects || 'No projects today')}${r.startLabel ? ` · check in by ${esc(r.startLabel)}` : ''}`,
    side: chip(r.status.label, r.status.tone),
    body: `${r.checkedIn ? `<p class="meta">Checked in at <b>${esc(r.checkedIn)}</b></p>` : ''}
      ${r.note ? `<div class="bubble">${esc(r.note)}</div>` : ''}
      ${!r.checkedIn && !r.note ? '<p class="meta">Nothing else to show for today.</p>' : ''}`,
  });
  return layout({
    title: 'Today', user, active: '/admin', message,
    body: `<div data-autorefresh>
      <p class="updated">Updates by itself every minute · last updated <span data-updated></span></p>
      ${week ? weekCard(week) : ''}
      ${rows.length ? `<div class="summary-chips">${summary}</div>
      ${groups.filter(([g]) => by(g).length).map(([g, title, tone, open]) =>
        section({ title, count: by(g).length, open, tone, key: `group-${g}`, body: by(g).map(rowHtml).join('') })).join('')}`
      : `<div class="card">${empty('No active VAs yet. Go to People and click "Sync with Zoho now".')}</div>`}
    </div>`,
  });
}

// "This week" at the top of Today: on-time rate, counts, and anyone late or missing more than once.
function weekCard(w) {
  const flagged = w.flagged.map((p) => chip(`${p.name.split(' ')[0]} ${p.name.split(' ')[1]?.[0] || ''}. · ${p.total}`, 'bad')).join('');
  return `<div class="card week">
    <div class="rate" style="--p:${w.rate ?? 0}" title="On-time rate"><div>${w.rate === null ? '–' : `${w.rate}%`}</div></div>
    <div class="grow">
      <h2>This week</h2>
      <p class="small" style="margin:0 0 6px">${esc(w.label)} · on time, out of all check-ins that were due</p>
      <div class="chips">${chip(`${w.onTime} on time`, 'good')}${chip(`${w.late} late`, w.late ? 'warn' : 'muted')}${chip(`${w.missed} no check-in`, w.missed ? 'bad' : 'muted')}${chip(`${w.calledOut} call-outs`, 'muted')}${chip(`${w.daysOff} days off`, 'muted')}</div>
      ${w.flagged.length ? `<div class="chips" style="margin-top:8px"><span class="small" style="align-self:center">Late or missing 2+ times:</span>${flagged}
        <a class="small" style="align-self:center" href="/admin/history">See History</a></div>` : ''}
    </div>
  </div>`;
}

export function historyPage({ user, month, prev, next, dates, vas, cells }) {
  const [y, m] = month.split('-').map(Number);
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const legend = ['on_time', 'late', 'missed', 'called_out', 'time_off', 'emergency', 'exempt']
    .map((s) => `<span><span class="cell ${STATUS[s][1]}">${STATUS[s][2]}</span> ${STATUS[s][0]}</span>`).join('');
  return layout({
    title: 'History', user, active: '/admin/history',
    body: `<div class="card">
      <div class="row" style="align-items:center">
        <div><a class="btn plain" href="/admin/history?month=${prev}" style="margin:0">← Earlier</a></div>
        <div style="text-align:center;font-weight:800;font-size:18px">${esc(monthName)}</div>
        <div style="text-align:right"><a class="btn plain" href="/admin/history?month=${next}" style="margin:0">Later →</a></div>
      </div>
      <div class="legend">${legend}<span><span class="cell muted">–</span> No record</span></div>
      <div class="table"><table class="hist">
        <tr><th>VA</th>${dates.map((d) => `<th><div class="small">${weekdayOf(d).slice(0, 2)}</div>${Number(d.slice(8))}</th>`).join('')}<th>On time</th><th>Late</th><th>Missed</th></tr>
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
      <p class="small">Point at a square (or tap it on a phone) to see details, including call-out reasons.</p>
    </div>`,
  });
}

export function timeOffPage({ user, pending, current, recent, vas, unmatched, vaProjects, backups, clickupReady, formUrl, message }) {
  const ctx = { vas, backups };
  const waiting = unmatched.length + pending.length;
  return layout({
    title: 'Time off', user, active: '/admin/time-off', message,
    body: `<p class="lead">VAs ask for time off and coverage with the <a href="${esc(formUrl || '#')}" target="_blank" rel="noopener">request form</a>. New requests appear here within a few seconds.</p>
    ${clickupReady ? '' : '<div class="toast info">ClickUp is not connected yet, so approved coverage requests will not create a checklist. See "Connect ClickUp" in the README.</div>'}
    ${section({
      title: 'Waiting for your decision', count: waiting, open: true, tone: waiting ? 'attention' : '',
      body: waiting ? unmatchedCards(unmatched, vas, vaProjects) + requestCards(pending, true, ctx) : empty('All caught up. Nothing is waiting.'),
    })}
    ${section({
      title: 'Add time off or an emergency', open: false,
      hint: 'It applies right away, without approval. For time off that needs coverage, choose who covers; a ClickUp checklist is created.',
      body: `<form method="post" action="/admin/time-off/add" style="padding:0 8px">
        <div class="row">
          <div><label for="pv">VA</label><select id="pv" name="user_id" required><option value="">Choose a VA</option>${vas.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
          <div><label for="pk">Type</label><select id="pk" name="kind"><option value="time_off">Time off</option><option value="emergency">Emergency</option></select></div>
        </div>
        <div class="row">
          <div><label for="ps">First day</label><input id="ps" name="start_date" type="date" required></div>
          <div><label for="pe">Last day</label><input id="pe" name="end_date" type="date" required></div>
        </div>
        <label class="check"><input type="checkbox" name="needs_coverage" value="1"> Coverage needed</label>
        <label for="pb">Who covers (for time off that needs coverage)</label>
        <select id="pb" name="backup"><option value="">Not needed</option>${backups.map((b) => `<option value="${esc(b.zoho_id)}">${esc(b.name)} (${esc(b.status)})</option>`).join('')}</select>
        <label for="pn">Note (optional)</label><input id="pn" name="note" type="text" maxlength="1000">
        <button>${icon('plus')} Add</button>
      </form>`,
    })}
    ${section({ title: 'Current and upcoming', count: current.length, open: true, body: requestCards(current.map((r) => ({ ...r, cancellable: true })), true, ctx) })}
    ${section({ title: 'Past, denied and cancelled', count: recent.length, open: false, body: requestCards(recent, true) })}`,
  });
}

export function peoplePage({ user, people, onDeck = [], message, tempPassword }) {
  const vas = people.filter((p) => p.is_va);
  const admins = people.filter((p) => p.is_admin);
  let tempBox = '';
  if (tempPassword && 'emailed' in tempPassword) {
    const where = [tempPassword.emailed && `email (${esc(tempPassword.email)})`, tempPassword.slacked && 'Slack'].filter(Boolean).join(' and ');
    tempBox = `<div class="toast ${where ? 'good' : 'bad'}" style="display:block">
      ${where ? `${icon('send')} Login invite sent to <strong>${esc(tempPassword.name)}</strong> by ${where}.` : `The invite for <strong>${esc(tempPassword.name)}</strong> could not be sent (see Settings, "Last email problem").`}<br>
      <span class="small">If they can't find it, their temporary password is <code style="font-size:15px">${esc(tempPassword.password)}</code>. It is not shown again.</span></div>`;
  } else if (tempPassword) {
    tempBox = `<div class="toast info" style="display:block">Temporary password for <strong>${esc(tempPassword.name)}</strong>: <code style="font-size:16px">${esc(tempPassword.password)}</code><br>
       <span class="small">Share it with them privately. They choose their own password when they log in. It is not shown again.</span></div>`;
  }
  const loginText = (p) => (!p.password_hash ? 'Not invited yet'
    : !p.must_change_password ? 'Has logged in'
    : p.invited_at ? `Invited ${formatDate(p.invited_at.slice(0, 10))}` : 'Temporary password');
  const resetBtn = (p) => `<form method="post" action="/admin/people/${p.id}/invite" data-confirm="${esc(`Send ${p.name} a login invite${p.slack_user_id ? ' by email and Slack' : ' by email'}? It includes a new temporary password, so any current password stops working.`)}"><button class="sm">${icon('send')} ${p.password_hash && !p.must_change_password ? 'Send new login invite' : 'Send login invite'}</button></form>
    <form method="post" action="/admin/people/${p.id}/temp-password" data-confirm="${esc(`Show a new temporary password for ${p.name} here, without sending it? Their current password stops working.`)}"><button class="sm plain">${icon('key')} Just show a temporary password</button></form>`;

  // Whether the app checks this VA, why, and a button to exempt them or remove the exemption.
  const checked = (p) => {
    const affiliation = (p.affiliation || '').trim();
    const exempt = isExempt(p);
    const why = p.exempt ? 'Exempted by an admin'
      : !affiliation ? 'VA Company Affiliation is empty in Zoho'
      : affiliation !== 'InoVA Local' ? `Affiliation in Zoho: ${affiliation}` : 'Affiliation in Zoho: InoVA Local';
    const byZoho = affiliation !== 'InoVA Local';
    // VAs exempt because of Zoho are changed in Zoho; the button only exempts (or un-exempts) InoVA Local VAs.
    const button = byZoho && !p.exempt ? '<span class="small">Change the affiliation in Zoho to check this VA.</span>' : `
      <form method="post" action="/admin/people/${p.id}/exempt" data-confirm="${esc(p.exempt ? `Start checking ${p.name} again?` : `Stop checking ${p.name}? They won't get late alerts or appear in reports.`)}">
        <input type="hidden" name="exempt" value="${p.exempt ? 0 : 1}">
        <button class="sm plain">${p.exempt ? 'Remove exemption' : 'Exempt this VA'}</button>
      </form>`;
    return { chip: exempt ? chip('Exempt', !p.exempt && !affiliation ? 'warn' : 'muted') : chip('Checked', 'good'), why, button };
  };

  const vaRow = (p) => {
    const c = checked(p);
    const warnings = [
      !zoneFor(p.time_zone) && 'Time zone missing in Zoho (using EST)',
      !p.slack_channel_id && 'Slack management channel not set in Zoho',
    ].filter(Boolean);
    return item({
      name: p.name, title: esc(p.name), sub: esc(p.project_list || 'No projects'), side: c.chip,
      body: `<p class="meta">${esc(p.email)}</p>
        <div class="chips">${chip(p.time_zone || 'No time zone', zoneFor(p.time_zone) ? 'muted' : 'warn')}${chip(p.availability || 'No availability', 'muted')}${chip(loginText(p), p.password_hash ? 'good' : 'muted')}</div>
        <p class="meta">${esc(c.why)}${p.slack_channel_id ? ` · Slack channel <code>${esc(p.slack_channel_id)}</code>` : ''}</p>
        ${warnings.map((w) => `<p class="meta" style="color:var(--warn)">${esc(w)}</p>`).join('')}
        <div class="actions">${c.button}${resetBtn(p)}</div>`,
    });
  };

  const onDeckRow = (p) => item({
    name: p.name, title: esc(p.name), sub: esc(p.email || 'No email in Zoho'), side: chip('On Deck', 'info'),
    body: `<div class="chips">${chip(p.time_zone || 'No time zone', 'muted')}${chip(p.availability || 'No availability', 'muted')}</div>
      <p class="meta">On Deck VAs don't check in. They can be chosen to cover when someone takes time off. To make them Active, change their VA Status in Zoho and sync.</p>`,
  });

  const adminRow = (p) => item({
    name: p.name, title: esc(p.name), sub: esc(p.email), side: chip(loginText(p), p.password_hash ? 'good' : 'muted'),
    body: `<div class="actions">${resetBtn(p)}${p.id !== user.id ? `<form method="post" action="/admin/people/${p.id}/remove-admin" data-confirm="${esc(`Remove ${p.name} as an admin?`)}"><button class="sm danger">Remove admin</button></form>` : ''}</div>`,
  });

  return layout({
    title: 'People', user, active: '/admin/people', message,
    body: `${tempBox}
    <div class="card" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
      <p class="lead" style="margin:0;flex:1;min-width:240px">VAs come from Zoho CRM and update every hour. To change a VA's details, change them in Zoho, then sync. Projects and start times are on the <a href="/admin/projects">Projects</a> page.</p>
      <form method="post" action="/admin/sync"><input type="hidden" name="back" value="/admin/people"><button style="margin:0">${icon('sync')} Sync with Zoho now</button></form>
    </div>
    <label class="search" for="find-person">${icon('people')}<input id="find-person" type="search" placeholder="Search people" autocomplete="off" data-filter="#people .item" data-empty="#people-none"></label>
    <div id="people">
    ${section({ title: 'Active VAs', count: vas.length, open: true, body: vas.length ? vas.map(vaRow).join('') : empty('No active VAs yet.') })}
    ${section({ title: 'On Deck VAs', count: onDeck.length, open: true, body: onDeck.length ? onDeck.map(onDeckRow).join('') : empty('No On Deck VAs in Zoho.') })}
    ${section({
      title: 'Admins', count: admins.length, open: false,
      body: `${admins.map(adminRow).join('')}
        <form method="post" action="/admin/people/add-admin" class="row" style="padding:8px">
          <div><label for="an">Add an admin: name</label><input id="an" name="name" type="text" required></div>
          <div><label for="ae">Email</label><input id="ae" name="email" type="email" required></div>
          <div style="flex:0"><button>${icon('plus')} Add</button></div>
        </form>`,
    })}
    </div><div id="people-none" class="card empty no-results">Nobody matches your search.</div>`,
  });
}

export function holidaysPage({ user, holidays, message }) {
  const cal = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    const month = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
    return `<div class="cal"><div class="m">${month}</div><div class="d">${d}</div></div>`;
  };
  return layout({
    title: 'Holidays', user, active: '/admin/holidays', message,
    body: `<p class="lead">No check-in is expected on these dates, so nobody gets late alerts.</p>
    ${section({
      title: 'Add a holiday', open: false,
      body: `<form method="post" action="/admin/holidays" class="row" style="padding:0 8px 8px">
        <div><label for="hd">Date</label><input id="hd" name="date" type="date" required></div>
        <div><label for="hn">Name</label><input id="hn" name="name" type="text" required placeholder="For example: Thanksgiving"></div>
        <div style="flex:0"><button>${icon('plus')} Add</button></div>
      </form>`,
    })}
    ${section({
      title: 'Holidays', count: holidays.length, open: true,
      body: holidays.length ? holidays.map((h) => `<div class="item flat"><div class="item-head">${cal(h.date)}
        <div class="grow"><div class="title">${esc(h.name)}</div><div class="sub">${esc(formatDate(h.date, true))}</div></div>
        <form method="post" action="/admin/holidays/${esc(h.date)}/delete" data-confirm="${esc(`Remove ${h.name}?`)}"><button class="sm danger" style="margin:0">Remove</button></form></div></div>`).join('')
        : empty('No holidays added.'),
    })}`,
  });
}

export function settingsPage({ user, grace, emailError, admins, recipients, message }) {
  return layout({
    title: 'Settings', user, active: '/admin/settings', message,
    body: `${section({
      title: 'My notifications', open: true,
      body: `<form method="post" action="/admin/settings/notifications" style="padding:0 8px 8px">
        <label class="check"><input type="checkbox" name="notify_time_off" value="1" ${user.notify_time_off ? 'checked' : ''}> Email me when a VA sends a new time-off request</label>
        <button>Save</button></form>`,
    })}
    ${section({
      title: 'Report emails', count: recipients.length, open: false,
      hint: 'The weekly (Mondays) and monthly (the 1st) reports go out at 9:00 AM Eastern as one email, with everyone below on it.',
      body: `<form method="post" action="/admin/settings/recipients" style="padding:0 8px 8px">
        ${admins.map((a) => `<label class="check"><input type="checkbox" name="admin_email" value="${esc(a.email)}" ${recipients.includes(a.email) ? 'checked' : ''}> ${esc(a.name)} <span class="small">(${esc(a.email)})</span></label>`).join('')}
        <label for="other">Other email addresses (one per line)</label>
        <textarea id="other" name="other" placeholder="name@inovalocal.com">${esc(recipients.filter((e) => !admins.some((a) => a.email === e)).join('\n'))}</textarea>
        <button>Save recipients</button>
        ${recipients.length ? '' : '<div class="toast bad" style="margin-top:12px">Nobody is selected, so report emails are not sent. Reports are still posted in Slack.</div>'}
        <div class="actions" style="margin-top:16px">
          <span class="small">Send a report now:</span>
          <button class="sm plain" formaction="/admin/reports/weekly">Weekly</button>
          <button class="sm plain" formaction="/admin/reports/monthly">Monthly</button>
        </div>
      </form>`,
    })}
    ${section({
      title: 'On-time rule', open: false,
      body: `<form method="post" action="/admin/settings/grace" style="padding:0 8px 8px">
        <label for="grace">A check-in counts as on time up to this many minutes after the start time</label>
        <input id="grace" name="grace" type="number" min="0" max="9" value="${grace}" style="max-width:120px">
        <p class="small">Late alerts are still sent at 10 and 15 minutes.</p>
        <button>Save</button></form>`,
    })}
    ${section({
      title: 'Last email problem', open: Boolean(emailError), tone: emailError ? 'attention' : '',
      body: `<div style="padding:0 8px 8px">${emailError
        ? `<p class="small">${esc(new Date(emailError.at).toLocaleString('en-US', { timeZone: 'America/New_York' }))} ET, sending to ${esc(emailError.to)}:</p><p><code>${esc(emailError.problem)}</code></p>`
        : '<p class="small">No email problems so far.</p>'}</div>`,
    })}`,
  });
}

// ---- Projects page ----

// Work-day toggles, Monday first. Each looks like a small pill that turns green when on.
function dayBoxes(days) {
  const on = new Set((days ?? '1,2,3,4,5').split(','));
  return `<span class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) =>
    `<label><input type="checkbox" name="days" value="${d}" ${on.has(String(d)) ? 'checked' : ''}><span>${DAY_NAMES[d].slice(0, 2)}</span></label>`).join('')}</span>`;
}

export function projectsPage({ user, projects, assignments, vas, message }) {
  const byProject = new Map(projects.map((p) => [p.id, []]));
  for (const a of assignments) byProject.get(a.project_id)?.push(a);
  const unassigned = projects.filter((p) => !byProject.get(p.id).length);
  const assigned = projects.filter((p) => byProject.get(p.id).length);

  const assignmentRow = (a) => `
    <div class="assign">
      <form method="post" action="/admin/assignments/${a.id}" class="assign" style="border:0;padding:0;flex:1">
        <span class="who">${avatar(a.va_name)}${esc(a.va_name)}</span>
        <input type="time" name="start_time" value="${esc(a.start_time || '')}" aria-label="Start time">
        <span class="small">${esc(zoneFor(a.time_zone) ? a.time_zone : 'EST')}</span>
        ${dayBoxes(a.days)}
        <button class="sm plain" style="margin:0">Save</button>
      </form>
      <form method="post" action="/admin/assignments/${a.id}/delete" data-confirm="${esc(`Take ${a.va_name} off this project?`)}"><button class="sm danger" style="margin:0">Remove</button></form>
      ${parseHHMM(a.start_time) ? '' : `<div style="width:100%">${chip('No start time: no check-in or late alerts for this project', 'warn')}</div>`}
    </div>`;

  const addForm = (p) => `
    <details class="section" style="margin:10px 0 0;box-shadow:none;background:var(--surface-2)"><summary>${icon('plus')} Add a VA${icon('chevron', 'chev')}</summary>
      <form method="post" action="/admin/projects/${esc(p.id)}/assign" class="assign" style="border:0;padding:0 16px 14px">
        <select name="user_id" required aria-label="VA"><option value="">Choose a VA</option>${vas.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
        <input type="time" name="start_time" aria-label="Start time">
        ${dayBoxes()}
        <button class="sm" style="margin:0">Add</button>
      </form>
    </details>`;

  const projectRow = (p, open = false) => {
    const list = byProject.get(p.id);
    const missingTime = list.some((a) => !parseHHMM(a.start_time));
    const who = list.map((a) => `${esc(a.va_name)}${a.start_time ? ` · ${esc(formatHM(parseHHMM(a.start_time) || { hour: 0, minute: 0 }))}` : ''}`).join(', ');
    return item({
      name: p.client, title: esc(p.client), sub: esc(who || 'No VA assigned'),
      side: !list.length ? chip('No VA', 'warn') : missingTime ? chip('Needs a start time', 'warn') : chip(`${list.length} VA${list.length > 1 ? 's' : ''}`, 'good'),
      open,
      body: `<p class="meta">${esc(p.name)}</p>${list.map(assignmentRow).join('')}${addForm(p)}`,
    });
  };

  return layout({
    title: 'Projects', user, active: '/admin/projects', message,
    body: `<div class="card" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
      <p class="lead" style="margin:0;flex:1;min-width:240px">Projects come from Zoho Projects every hour. A new project is given to the VA named after the " - " in its name, with their Zoho start time. Start times are in each VA's own time zone. A VA with several projects checks in once a day, by the earliest start.</p>
      <form method="post" action="/admin/sync"><input type="hidden" name="back" value="/admin/projects"><button style="margin:0">${icon('sync')} Sync with Zoho now</button></form>
    </div>
    <label class="search" for="find-project">${icon('projects')}<input id="find-project" type="search" placeholder="Search projects or VAs" autocomplete="off" data-filter="#projects-list .item" data-empty="#projects-none"></label>
    <div id="projects-list">
    ${unassigned.length ? section({
      title: 'Projects with no VA', count: unassigned.length, open: true, tone: 'attention',
      hint: 'No active VA matched the name in these projects. Open one to add a VA if someone should check in for it.',
      body: unassigned.map((p) => projectRow(p)).join(''),
    }) : ''}
    ${section({ title: 'Projects', count: assigned.length, open: true, body: assigned.length ? assigned.map((p) => projectRow(p)).join('') : empty('No projects yet. Click "Sync with Zoho now".') })}
    </div><div id="projects-none" class="card empty no-results">No project matches your search.</div>`,
  });
}

// ---- Calendar page ----

// events: [{ date, name, kind, status, backup, id }]; holidays: [{ date, name }].
export function calendarPage({ user, month, prev, next, today, events, holidays, message }) {
  const [y, m] = month.split('-').map(Number);
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const iso = (d) => d.toISOString().slice(0, 10);
  const cells = [];
  for (let i = -lead; i < Math.ceil((lead + daysInMonth) / 7) * 7 - lead; i++) cells.push(new Date(Date.UTC(y, m - 1, 1 + i)));
  const byDate = new Map();
  for (const e of events) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
  const holidayOn = new Map(holidays.map((h) => [h.date, h.name]));
  const short = (name) => `${name.split(' ')[0]} ${name.split(' ')[1]?.[0] ? `${name.split(' ')[1][0]}.` : ''}`.trim();
  const label = (e) => `${e.name}: ${e.kind === 'emergency' ? 'Emergency' : 'Time off'}${e.status === 'pending' ? ' (waiting for a decision)' : ''}${e.backup ? `, covered by ${e.backup}` : ''}`;
  const evHtml = (e) => `<a class="ev ${e.status === 'pending' ? 'pending' : e.kind}" href="/admin/time-off" title="${esc(label(e))}">${esc(short(e.name))}${e.backup ? ' ⇄' : ''}</a>`;

  const grid = `<div class="cal-grid">
    ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('')}
    ${cells.map((d) => {
      const date = iso(d);
      const wd = d.getUTCDay();
      const cls = [d.getUTCMonth() !== m - 1 && 'out', date === today && 'today', (wd === 0 || wd === 6) && 'weekend'].filter(Boolean).join(' ');
      return `<div class="day ${cls}"><span class="n">${d.getUTCDate()}</span>
        ${holidayOn.has(date) ? `<span class="ev holiday" title="${esc(holidayOn.get(date))}">${esc(holidayOn.get(date))}</span>` : ''}
        ${(byDate.get(date) || []).map(evHtml).join('')}</div>`;
    }).join('')}
  </div>`;

  const listDays = cells.map(iso).filter((d) => d.slice(0, 7) === month && (byDate.has(d) || holidayOn.has(d)));
  const list = `<div class="cal-list">${listDays.length ? listDays.map((d) => item({
    title: esc(formatDate(d)),
    sub: [holidayOn.has(d) && `🎉 ${esc(holidayOn.get(d))}`, ...(byDate.get(d) || []).map((e) => esc(label(e)))].filter(Boolean).join('<br>'),
  })).join('') : empty('Nobody is off this month.')}</div>`;

  const legend = `<div class="legend"><span><span class="ev time_off" style="display:inline-block">Name</span> Time off</span>
    <span><span class="ev emergency" style="display:inline-block">Name</span> Emergency</span>
    <span><span class="ev pending" style="display:inline-block">Name</span> Waiting for a decision</span>
    <span>⇄ someone covers</span><span><span class="ev holiday" style="display:inline-block">Holiday</span></span></div>`;

  return layout({
    title: 'Calendar', user, active: '/admin/calendar', message,
    body: `<div class="card">
      <div class="row" style="align-items:center">
        <div><a class="btn plain" href="/admin/calendar?month=${prev}" style="margin:0">← Earlier</a></div>
        <div style="text-align:center;font-weight:800;font-size:18px">${esc(monthName)}</div>
        <div style="text-align:right"><a class="btn plain" href="/admin/calendar?month=${next}" style="margin:0">Later →</a></div>
      </div>
      ${legend}${grid}${list}
      <p class="small">Click a name to open the Time off page. Point at a name to see the details.</p>
    </div>`,
  });
}

// ---- Tasks and time (Zoho Projects) ----

const hhmm = (p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
const clock = (value) => { const t = parseHHMM(value); return t ? formatHM(t) : ''; };
const minutesOf = (hours) => { const m = /^(\d+):(\d{2})$/.exec(hours || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const asHours = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

export function workPage({ user, day, projects, project, lists, logs, week, thisWeek, today, message, zohoError, logsError = '' }) {
  const title = 'Tasks & time';
  if (!project) {
    return layout({ title, user, active: '/va/work', message, body: `<div class="card">${empty('You have no projects yet. An admin assigns them on the Projects page.')}</div>` });
  }
  const zone = day.zone;
  const t = user.timer;
  const q = (extra = {}) => `/va/work?${new URLSearchParams({ project: project.id, ...extra })}`;
  const hidden = (projectId = project.id) => `<input type="hidden" name="project" value="${esc(projectId)}">`;
  const allTasks = lists.flatMap((l) => l.tasks);

  const error = zohoError ? `<div class="toast bad" role="alert">${esc(zohoError)}</div>` : '';
  const switcher = projects.length > 1
    ? `<nav class="chips proj-tabs" aria-label="Projects">${projects.map((p) =>
      `<a class="chip ${p.id === project.id ? 'on' : 'muted'}" href="/va/work?project=${encodeURIComponent(p.id)}">${esc(p.client)}</a>`).join('')}</nav>`
    : '';

  const taskOptions = `<option value="">General (no task)</option>${lists.filter((l) => l.tasks.length).map((l) =>
    `<optgroup label="${esc(l.name)}">${l.tasks.map((x) => `<option value="${esc(x.id)}|${esc(x.name)}">${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}`;
  const logFields = ({ date = today, start = '', end = '', billable = true, notes = '' } = {}) => `
    <div class="row">
      <div><label>Date</label><input type="date" name="date" required value="${esc(date)}" max="${esc(today)}"></div>
      <div><label>Start time</label><input type="time" name="start" required value="${esc(start)}"></div>
      <div><label>End time</label><input type="time" name="end" required value="${esc(end)}"></div>
      <div><label>Billing type</label><select name="billable"><option value="yes" ${billable ? 'selected' : ''}>Billable</option><option value="no" ${billable ? '' : 'selected'}>Non Billable</option></select></div>
    </div>
    <label>Notes</label><textarea name="notes" maxlength="10000" placeholder="What you worked on">${esc(notes)}</textarea>`;

  // The timer
  let timerCard;
  if (t?.stopped_at) {
    const s = partsIn(zone, new Date(t.started_at));
    const e = partsIn(zone, new Date(t.stopped_at));
    const crosses = s.date !== e.date;
    timerCard = `<div class="card" id="timer">
      <h2>${icon('timer')} Save your timer</h2>
      <p class="meta"><b>${esc(t.task_name || 'General')}</b>${t.client ? ` · ${esc(t.client)}` : ''}</p>
      ${t.auto_stopped ? '<p class="small">This timer stopped by itself after 8 hours. Change the times if you stopped working earlier.</p>' : ''}
      ${crosses ? '<p class="small">This timer ran past midnight, so it ends at 11:59 PM here. Use "Log time" to add the time after midnight.</p>' : ''}
      <form method="post" action="/va/work/log">
        ${hidden(t.project_id)}<input type="hidden" name="from_timer" value="1">
        <input type="hidden" name="task" value="${esc(t.task_id || '')}|${esc(t.task_name || 'General')}">
        ${logFields({ date: s.date, start: hhmm(s), end: crosses ? '23:59' : hhmm(e) })}
        <button>${icon('check')} Save to Zoho</button>
      </form>
      <form method="post" action="/va/work/timer/discard" data-confirm="Discard this timer? Nothing will be saved to Zoho.">${hidden(t.project_id)}<button class="danger sm">${icon('trash')} Discard</button></form>
    </div>`;
  } else if (t) {
    timerCard = `<div class="card hero" id="timer">
      <div class="date">Timer running</div>
      <div class="bigtime" data-since="${esc(t.started_at)}">0:00:00</div>
      <p class="meta"><b>${esc(t.task_name || 'General')}</b>${t.client ? ` · ${esc(t.client)}` : ''}<br>Started at ${esc(formatTimeIn(t.started_at, zone))} ${esc(day.zoneLabel)}</p>
      <form method="post" action="/va/work/timer/stop">${hidden(t.project_id)}<button>${icon('stop')} Stop timer</button></form>
      <p class="small">It keeps running if you close the app, and stops by itself after 8 hours.</p>
    </div>`;
  } else {
    timerCard = `<div class="card" id="timer">
      <h2>${icon('timer')} Timer</h2>
      <p class="meta">Press <b>Start</b> next to a task below. The timer keeps running if you close the app, and stops by itself after 8 hours. Starting your first timer of the day also checks you in.</p>
      <form method="post" action="/va/work/timer/start">${hidden()}<input type="hidden" name="task_name" value="General"><button class="plain sm">${icon('play')} Start a general timer</button></form>
    </div>`;
  }

  // This week's time logs
  const total = logs.reduce((sum, l) => sum + minutesOf(l.hours), 0);
  const billable = logs.filter((l) => l.billable).reduce((sum, l) => sum + minutesOf(l.hours), 0);
  const weekNav = `<div class="actions" style="padding:0 8px 8px">
    <a class="btn plain sm" href="${q({ week: addDays(week, -7) })}">‹ Previous week</a>
    ${week !== thisWeek ? `<a class="btn plain sm" href="${q({ week: addDays(week, 7) })}">Next week ›</a><a class="btn plain sm" href="${q()}">This week</a>` : ''}
  </div>`;
  const logItems = logs.map((l) => item({
    title: esc(l.title),
    tone: 'stack',
    sub: `${esc(formatDate(l.date))}${l.start && l.end ? ` · ${esc(clock(l.start))}–${esc(clock(l.end))}` : ''} · ${esc(l.hours)} h`,
    side: chip(l.billable ? 'Billable' : 'Non Billable', l.billable ? 'good' : 'muted'),
    key: `log-${l.id}`,
    body: `${l.notes ? `<div class="bubble">${esc(l.notes)}</div>` : ''}
      <form method="post" action="/va/work/log/edit">
        ${hidden()}<input type="hidden" name="log" value="${esc(l.id)}">
        <input type="hidden" name="task" value="${esc(l.taskId)}|${esc(l.title)}">
        ${l.type === 'general' ? `<label>Log name</label><input type="text" name="name" maxlength="1000" value="${esc(l.title)}">` : ''}
        ${logFields({ date: l.date, start: l.start, end: l.end, billable: l.billable, notes: l.notes })}
        <button>Save changes</button>
      </form>
      <form method="post" action="/va/work/log/delete" data-confirm="Trash this time log in Zoho?">
        ${hidden()}<input type="hidden" name="log" value="${esc(l.id)}"><input type="hidden" name="type" value="${l.type === 'general' ? 'general' : 'task'}">
        <button class="danger sm">${icon('trash')} Trash</button>
      </form>`,
  })).join('');

  // Task lists and tasks
  const listOptions = (selected) => lists.filter((l) => l.id).map((l) => `<option value="${esc(l.id)}" ${l.id === selected ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const startForms = allTasks.map((x) => `<form id="start-${esc(x.id)}" method="post" action="/va/work/timer/start" hidden>${hidden()}
    <input type="hidden" name="task" value="${esc(x.id)}"><input type="hidden" name="task_name" value="${esc(x.name)}"></form>`).join('');
  const taskRow = (x, list) => {
    const running = t && !t.stopped_at && t.task_id === x.id;
    return item({
      title: esc(x.name),
      sub: esc(x.prefix),
      tone: 'stack',
      side: running ? chip('Running', 'good') : `<button class="sm" form="start-${esc(x.id)}" ${t ? 'disabled title="Stop or save your current timer first"' : ''}>${icon('play')} Start</button>`,
      key: `task-${x.id}`,
      body: `<form method="post" action="/va/work/task/edit">
          ${hidden()}<input type="hidden" name="task" value="${esc(x.id)}"><input type="hidden" name="old_list" value="${esc(list.id)}">
          <div class="row"><div><label>Task name</label><input type="text" name="name" required maxlength="500" value="${esc(x.name)}"></div>
          ${list.id ? `<div><label>Task list</label><select name="list">${listOptions(list.id)}</select></div>` : ''}</div>
          <button>Save</button>
        </form>
        <form method="post" action="/va/work/task/delete" data-confirm="Trash the task &quot;${esc(x.name)}&quot; in Zoho?">
          ${hidden()}<input type="hidden" name="task" value="${esc(x.id)}"><button class="danger sm">${icon('trash')} Trash task</button>
        </form>`,
    });
  };
  const listSections = lists.map((l) => section({
    title: l.name, count: l.tasks.length, key: `list-${l.id || 'other'}`,
    body: `${l.tasks.map((x) => taskRow(x, l)).join('') || empty('No open tasks in this list.')}
      <form class="inline-add" method="post" action="/va/work/task/add">${hidden()}<input type="hidden" name="list" value="${esc(l.id)}">
        <input type="text" name="name" required maxlength="500" placeholder="Add a task to ${esc(l.name)}" aria-label="New task name"><button class="sm">${icon('plus')} Add</button></form>
      ${l.id ? `<details class="list-opts"><summary>List options</summary>
        <form class="inline-add" method="post" action="/va/work/list/rename">${hidden()}<input type="hidden" name="list" value="${esc(l.id)}">
          <input type="text" name="name" required maxlength="500" value="${esc(l.name)}" aria-label="Task list name"><button class="sm plain">Rename</button></form>
        <form method="post" action="/va/work/list/delete" style="padding:0 8px" data-confirm="Trash the task list &quot;${esc(l.name)}&quot; and its tasks in Zoho?">${hidden()}<input type="hidden" name="list" value="${esc(l.id)}">
          <button class="danger sm">${icon('trash')} Trash this list</button></form>
      </details>` : ''}`,
  })).join('');

  return layout({
    title, user, active: '/va/work', message,
    body: `${error}${switcher}${timerCard}
    ${section({
      title: 'Log time', open: false, key: 'log-time',
      hint: 'Add time you worked without the timer. It is saved in Zoho under your name.',
      body: `<form method="post" action="/va/work/log" style="padding:0 8px 8px">${hidden()}
        <div class="row"><div><label>Task</label><select name="task">${taskOptions}</select></div>
        <div><label>Log name (only for General)</label><input type="text" name="name" maxlength="1000" placeholder="General"></div></div>
        ${logFields()}
        <button>${icon('check')} Save to Zoho</button></form>`,
    })}
    ${section({
      title: `My time · ${formatDate(week, false)} – ${formatDate(addDays(week, 6), false)}`, count: `${asHours(total)} h`, key: 'my-time',
      hint: `Billable ${asHours(billable)} h · Non billable ${asHours(total - billable)} h. Zoho only accepts time from recent days (up to 10 hours a day and 50 a week).`,
      body: `${logsError ? `<div class="toast bad" style="margin:0 8px 10px">${esc(logsError)}</div>` : ''}${weekNav}${logItems || (logsError ? '' : empty('No time logged this week.'))}`,
    })}
    ${listSections}
    ${section({
      title: 'Add a task list', open: false, key: 'add-list',
      body: `<form class="inline-add" method="post" action="/va/work/list/add">${hidden()}
        <input type="text" name="name" required maxlength="500" placeholder="Task list name" aria-label="Task list name"><button class="sm">${icon('plus')} Add list</button></form>`,
    })}
    ${startForms}`,
  });
}
