// The HTML for each page.
//
// Look and feel: a left sidebar (collapses into a menu on phones, with a bottom tab bar),
// rows with initials avatars and colored status chips, and collapsible sections
// (<details>) so each page shows what matters first and hides the rest until clicked.

import { esc } from './util.js';
import { isExempt } from './jobs.js';
import { formatDate, formatTimeIn, formatHM, parseHHMM, zoneFor, weekdayOf, DAY_NAMES, addDays, partsIn, REPORT_ZONE } from './time.js';

// Short messages shown at the top of a page after an action.
const MESSAGES = {
  'checked-in': ['good', 'You are checked in. Have a good shift!'],
  'already-in': ['info', 'You already checked in today.'],
  'bad-dates': ['bad', 'Please choose a start date and an end date that is the same or later.'],
  'approved': ['good', 'Request approved.'],
  'denied': ['good', 'Request denied.'],
  'saved': ['good', 'Saved.'],
  'synced': ['good', 'VA logins were updated from the VA records, and projects from Zoho Projects.'],
  'sync-failed': ['bad', 'The Zoho Projects sync did not work. Check the Zoho key (see README). VA logins were still updated from the VA records.'],
  'report-sent': ['good', 'Report posted in #check-in-tracker and emailed to the report recipients.'],
  'report-email-failed': ['bad', 'The report was posted in #check-in-tracker, but the email did not send. See "Last email problem" below.'],
  'password-changed': ['good', 'Your password was changed.'],
  'admin-added': ['good', 'Admin added. Use "Set temporary password" so they can log in.'],
  'removed': ['good', 'Removed.'],
  'clickup-failed': ['bad', 'Saved, but a ClickUp checklist could not be created. The reason is shown on the request; use "Create missing ClickUp checklists" to try again.'],
  'clickup-created': ['good', 'ClickUp checklists created.'],
  'cancelled-clickup-failed': ['bad', 'Cancelled, but a ClickUp checklist could not be deleted. The reason is shown on the request; please delete it in ClickUp.'],
  'choose-va': ['bad', 'Please choose a VA for the request.'],
  'choose-projects': ['bad', 'Please tick at least one project for the request.'],
  'period-added': ['good', 'Added. No check-in is expected on those days.'],
  'period-cancelled': ['good', 'Cancelled. Check-ins are expected again from today, and any ClickUp checklists for it were deleted.'],
  'checkins-paused': ['good', 'All check-ins are paused. No late alerts or reports will be sent.'],
  'checkins-resumed': ['good', 'Check-ins resumed. Late alerts start with the next shift that begins from now on.'],
  'timer-started': ['good', 'Timer started.'],
  'timer-started-checked-in': ['good', 'Timer started, and you are checked in for today.'],
  'timer-discarded': ['good', 'Timer discarded. No time was saved.'],
  'timer-already': ['info', 'A timer for this is already running.'],
  'timer-too-many': ['bad', 'You have 10 timers running. Please stop one first.'],
  'timer-gone': ['info', 'That timer is not there any more.'],
  'time-saved': ['good', 'Time saved.'],
  'time-saved-other-day': ['good', 'Time saved for the earlier day.'],
  'time-updated': ['good', 'Changes saved.'],
  'time-deleted': ['good', 'Time log deleted.'],
  'time-file-removed': ['good', 'File removed.'],
  'time-log-gone': ['info', 'That time log is not there any more.'],
  'time-no-project': ['bad', 'That project is not one of yours. Please choose one of your projects.'],
  'time-not-covering': ['bad', 'You can log time for a coverage project only on days you cover that client.'],
  'exception-added': ['good', 'Allowed. The VA can now add or change time for those days in this project.'],
  'time-check-saved': ['good', 'Saved. The daily time check uses this from its next run.'],
  'time-check-bad': ['bad', 'Please choose Off, Log only or Log and send Slack DMs.'],
  'missed-excused': ['good', 'Excused. This day no longer counts as missed.'],
  'missed-unexcused': ['good', 'Excuse taken back. This day counts as missed again.'],
  'missed-not-found': ['bad', 'That missed day was not found.'],
  'types-none': ['bad', 'Please tick at least one task type.'],
  'exception-bad': ['bad', 'Please choose a VA of this project, a first day and a last day (the last day not before the first, and not in the future).'],
  'sop-unreadable': ['bad', 'The SOP could not be saved. Please try again.'],
  'sop-empty': ['bad', 'Saved, but not marked complete yet: please fill in your steps first.'],
  'sop-draft': ['good', 'Saved. It is not marked complete yet; come back any time to finish it.'],
  'sop-complete': ['good', 'Saved and marked complete. Thank you!'],
  'sop-uploaded': ['good', 'File uploaded. The SOP for this project is done.'],
  'sop-no-file': ['bad', 'Please choose a file to upload.'],
  'sop-file-type': ['bad', "That kind of file can't be uploaded. Please use a PDF, Word, Excel or text file, or a picture."],
  'sop-file-big': ['bad', 'That file is too big. The limit is 15 MB.'],
  'sop-file-missing': ['bad', 'The file could not be found. Please upload it again.'],
  'record-created': ['good', 'Added.'],
  'record-created-no-email': ['bad', "Added. This VA is Active but has no email, so they can't log in. Add their email with Edit."],
  'saved-no-email': ['bad', "Saved. This VA is Active but has no email, so they can't log in. Add their email with Edit."],
  'client-saved': ['good', "Client saved for this project. The hourly sync won't change it."],
  'project-created': ['good', 'Project created. Check its time zone, billing day and package below.'],
  'project-missing': ['bad', 'Please choose the client of the new project.'],
  'project-closed': ['good', 'Project closed. It no longer shows on the Projects page or for its VAs.'],
  'project-reopened': ['good', 'Project reopened.'],
  'package-saved': ['good', 'Package saved.'],
  'package-bad': ['bad', 'Please enter the hours (0 or more) and the date the package starts.'],
  'package-deleted': ['good', 'Upcoming package change removed.'],
  'record-created-training-linked': ['good', 'Added. This applicant is already in an Onboarding Training (same email), so the two are now linked.'],
  'saved-training-linked': ['good', 'Saved. This applicant is in an Onboarding Training (same email), so the two are now linked.'],
  'record-deleted': ['good', 'Deleted.'],
  'no-changes': ['info', 'Nothing was changed.'],
  'tags-added': ['good', 'Tag added to the ticked records.'],
  'tags-removed': ['good', 'Tag removed from the ticked records.'],
  'tags-none-selected': ['bad', 'Please tick at least one record first.'],
  'tag-missing': ['bad', 'That tag is not there any more.'],
  'columns-saved': ['good', 'Columns saved. They are saved for you only.'],
  'export-none': ['bad', 'Nothing to export: no rows are shown.'],
  'tag-not-allowed': ['bad', "That tag can't be used on this kind of record. Change that on Settings > Tags."],
  'note-added': ['good', 'Note added.'],
  'note-saved': ['good', 'Note saved.'],
  'note-deleted': ['good', 'Note deleted.'],
  'note-empty': ['bad', 'Please type the note first.'],
  'file-uploaded': ['good', 'File added.'],
  'step-saved': ['good', 'Hiring step saved.'],
  'checklist-saved': ['good', 'Offer checklist saved.'],
  'va-made': ['good', 'VA record made. It is On Deck on the VAs page.'],
  'va-linked': ['info', 'A VA with the same email already exists, so this applicant was linked to that VA record.'],
  'training-started': ['good', 'Training started. If the trainee has no login yet, send them a login invite below.'],
  'training-started-applicant': ['good', 'Training started and linked to the applicant with the same email (see Hiring). If the trainee has no login yet, send them a login invite below.'],
  'training-exists': ['info', 'This person already has a training of that type in progress, so it was opened instead.'],
  'training-missing': ['bad', 'Please choose the type, the trainer and the first day.'],
  'training-no-trainee': ['bad', 'Please choose the trainee, or type their name and a valid email.'],
  'training-same-person': ['bad', 'The trainer and the trainee must be different people.'],
  'training-not-active': ['info', 'This training is paused or finished, so nothing was changed.'],
  'training-active': ['good', 'Training resumed.'],
  'training-paused': ['good', 'Training paused.'],
  'training-completed': ['good', 'Training marked complete.'],
  'training-completed-applicant': ['good', 'Training marked complete. On Hiring, the applicant moved to Training done.'],
  'training-no-email': ['bad', "This applicant has no valid email. Add one with Edit first: the trainee logs in with it."],
  'training-cancelled': ['good', 'Training cancelled.'],
  'training-name-needed': ['bad', 'Please type a name first.'],
  'training-day-not-empty': ['bad', 'Only a day with no items can be removed. Delete or move its items first.'],
  'day-signed': ['good', 'Day signed off.'],
  'module-finished': ['good', 'Module marked finished.'],
  'module-not-finished': ['good', 'Module marked not finished.'],
  'email-not-set-up': ['bad', 'Connect Gmail is not set up yet (a secret is missing in Cloudflare). See README, "Shared email (Connect Gmail)".'],
  'email-choose-share': ['bad', 'Please choose Shared with the team or Private first.'],
  'email-bad-state': ['bad', 'That Google sign-in did not match a Connect Gmail click on this page (it was too old, or came from somewhere else). Nothing was saved. Please click Connect Gmail again.'],
  'email-cancelled': ['info', 'Google sign-in was cancelled. Nothing was connected.'],
  'email-google-failed': ['bad', 'Google did not finish the sign-in, so nothing was connected. Please try again. If it keeps happening, see README, "Shared email (Connect Gmail)".'],
  'email-no-read': ['bad', 'Google did not give the app permission to read email, so nothing was connected. Click Connect Gmail again and tick the box that lets the app read your email.'],
  'email-wrong-domain': ['bad', 'Only @inovalocal.com Google accounts can be connected. Nothing was saved. Please sign in with your work account.'],
  'email-taken': ['bad', 'That mailbox is already connected by another admin.'],
  'email-connected': ['good', 'Gmail connected. The app now looks through the last 90 days, a little each minute. Emails show on client, contact and VA pages as they are found.'],
  'email-share-saved': ['good', 'Saved. This applies to every email saved from your inbox.'],
  'email-disconnected': ['good', 'Disconnected. The app no longer reads that mailbox. Its saved emails were kept.'],
  'email-disconnected-deleted': ['good', 'Done. The app no longer reads that mailbox, and the emails saved from it were deleted.'],
  'email-lookup-queued': ['good', "The app will look for emails to and from this record's addresses (last 90 days) in each connected inbox, a little each minute."],
  'email-lookup-none': ['info', 'No Gmail inbox is connected yet, so there is nothing to look through. See Settings > Email.'],
  'email-lookup-no-address': ['info', 'This record has no email address yet. Add one with Edit first.'],
  'email-gone': ['bad', "That email is not saved any more, or it is in someone's Private inbox."],
  'module-link-bad': ['bad', 'Please paste the full link to the module, starting with https:// (or http://).'],
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
  doc: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v4h16v-4"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
  va: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M8 4.5a6 6 0 0 1 8 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4M8 9h8M8 13h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  applicant: '<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>',
  training: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/>',
};

export const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

// First letters of the first two words, skipping words like "&" or "-" ("Rise & Shine" gives "RS").
const initials = (name) => (name || '?').split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// A round avatar with the person's initials, in a color that always matches their name.
export function avatar(name, size = '') {
  let hue = 0;
  for (const ch of name || '') hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="avatar ${size}" style="--h:${hue}" aria-hidden="true">${esc(initials(name))}</span>`;
}

export const chip = (label, tone = 'muted') => `<span class="chip ${tone}">${esc(label)}</span>`;

// A row of buttons at the top of pages that share one menu link (Calendar and History; Settings and Holidays).
const pageTabs = (tabs, on) => `<div class="chips proj-tabs">${tabs.map(([href, label]) =>
  `<a class="chip ${href === on ? 'on' : 'muted'}" href="${href}">${esc(label)}</a>`).join('')}</div>`;
const CALENDAR_TABS = [['/admin/calendar', 'Time off calendar'], ['/admin/history', 'Check-in history']];
const SETTINGS_TABS = [['/admin/settings', 'Settings'], ['/admin/email', 'Email'], ['/admin/holidays', 'Holidays'], ['/admin/settings/fields', 'Fields'], ['/admin/settings/tags', 'Tags'],
  ['/admin/settings/task-types', 'Task types'], ['/admin/settings/pay-periods', 'Pay periods']];
export const settingsTabs = (on) => pageTabs(SETTINGS_TABS, on);

const pill = (status) => {
  const [label, tone] = STATUS[status] || [status, 'muted'];
  return chip(label, tone);
};

const dateRange = (start, end, year = true) =>
  start === end ? formatDate(start, year) : `${formatDate(start, false)} – ${formatDate(end, year)}`;

// A collapsible section with a title, an optional count badge and an optional hint line.
export function section({ title, count, open = true, hint = '', body, tone = '', key = '' }) {
  return `<details class="section ${tone}" ${open ? 'open' : ''} ${key ? `data-key="${esc(key)}" id="${esc(key)}"` : ''}>
    <summary><span class="sec-title">${esc(title)}</span>${count !== undefined ? `<span class="count">${count}</span>` : ''}${icon('chevron', 'chev')}</summary>
    ${hint ? `<p class="hint">${hint}</p>` : ''}
    <div class="sec-body">${body}</div>
  </details>`;
}

// A clickable row: avatar, title, subtitle and a chip; clicking opens the extra content.
export function item({ name, title, sub = '', side = '', body = '', open = false, tone = '', key = '' }) {
  const head = `${name !== undefined ? avatar(name) : ''}<div class="grow"><div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${side}`;
  if (!body) return `<div class="item flat ${tone}"><div class="item-head">${head}</div></div>`;
  return `<details class="item ${tone}" ${open ? 'open' : ''} ${key ? `data-key="${esc(key)}"` : ''}><summary class="item-head">${head}${icon('chevron', 'chev')}</summary><div class="item-body">${body}</div></details>`;
}

export const empty = (text) => `<div class="empty">${text}</div>`;

// ---- Styles ----

const CSS = `
:root{--bg:#efeae2;--surface:#fff;--surface-2:#f6f5f3;--text:#111b21;--muted:#54656f;--line:#e6e2dc;
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
.sidebar{width:248px;flex:none;background:var(--side);color:var(--side-ink);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;height:100dvh;padding:14px 10px;overflow-y:auto}
/* The page links scroll on their own when the window is short, so Settings, Password and Log out stay in view. */
.side-brand,.side-user{flex:none}.side-nav{flex:1 1 auto;min-height:96px;overflow-y:auto;overscroll-behavior:contain;position:relative;scrollbar-width:thin;scrollbar-color:var(--side-hover) transparent}
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
main{padding:20px 24px 90px;max-width:1080px;width:100%;margin:0 auto}
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
.item .title{font-weight:700}.item .sub{color:var(--muted);font-size:14px;overflow-wrap:anywhere}
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
input[type=text],input[type=email],input[type=url],input[type=password],input[type=date],input[type=time],input[type=number],textarea,select{width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);font:inherit}
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
.side-search{flex:none;display:flex;align-items:center;gap:8px;background:var(--side-hover);border-radius:10px;padding:0 10px;margin:0 0 6px;color:var(--side-muted)}
.side-search input{flex:1;min-width:0;border:0;background:transparent;color:var(--side-ink);font:inherit;padding:9px 0;outline:none}.side-search input::placeholder{color:var(--side-muted)}
.side-search:focus-within{box-shadow:0 0 0 2px var(--accent)}
kbd{font-size:12px;line-height:1;font-family:inherit;border:1px solid currentColor;border-radius:5px;padding:2px 6px;opacity:.8}
.top-search{display:none;color:#fff}
.page-search input{flex:1;min-width:0}.page-search button{margin:0}
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
.search input{flex:1;min-width:0;border:0;box-shadow:none;background:transparent;padding:10px 0}.search input:focus{box-shadow:none}
.no-results{display:none}
.timerbar{display:flex;align-items:center;gap:10px;background:var(--accent-soft);color:var(--text);border-radius:14px;padding:8px 10px 8px 14px;margin-bottom:16px;box-shadow:var(--shadow);text-decoration:none}
.timerbar a{color:inherit;text-decoration:none}.timerbar form{margin:0}.timerbar button{margin:0}
.timerbar.stopped{background:var(--warn-bg);color:var(--warn);padding:12px 14px}.timerbar.slim{padding:8px 14px}
.attn-card h2{margin-bottom:4px}.attn{display:flex;align-items:center;gap:10px;padding:10px 6px;border-radius:10px;color:var(--text);text-decoration:none;font-weight:600}
.attn+.attn{border-top:1px solid var(--line)}.attn:hover{background:var(--surface-2)}.attn>.ic{color:var(--muted)}
.attn .dot{width:10px;height:10px;border-radius:50%;flex:none}.attn.bad .dot{background:var(--bad)}.attn.warn .dot{background:var(--warn)}.attn.muted .dot{background:var(--muted)}
.attn.bad,.attn.warn,.attn.muted{background:none;color:var(--text)}.attn-card.done{display:flex;align-items:center;gap:8px;color:var(--good)}
.loading{position:fixed;z-index:30;top:70px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;background:var(--surface);color:var(--text);
  font-weight:700;padding:10px 18px;border-radius:99px;box-shadow:0 6px 24px rgba(0,0,0,.18);white-space:nowrap}.loading[hidden]{display:none}.loading .ic{animation:spin 1s linear infinite}
#timer{scroll-margin-top:80px}
.pj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:0 0 16px}
.pj-btn{position:relative;display:flex;flex-direction:column;justify-content:center;min-height:64px;padding:10px 26px 10px 14px;border-radius:14px;background:var(--surface);box-shadow:var(--shadow);color:var(--text);text-decoration:none;overflow-wrap:anywhere;line-height:1.25}
.pj-btn small{color:var(--muted);font-weight:700;margin-top:2px}.pj-btn.on{background:var(--accent);color:#fff}.pj-btn.on small{color:#fff;opacity:.9}
.pj-btn .dot{position:absolute;top:10px;right:10px;width:11px;height:11px;border-radius:50%;background:#e53935;box-shadow:0 0 0 2px var(--surface)}
.tm-card{border-left:6px solid var(--accent)}.tm-card.stopped{border-left-color:var(--warn)}
.tm-row{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;justify-content:space-between}.tm-what{display:flex;flex-direction:column;min-width:0;overflow-wrap:anywhere}
.tm-buttons{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tm-buttons form{margin:0;flex:1 1 160px}.tm-buttons form:last-child{flex:0 0 auto}.tm-buttons button{margin-top:10px}
.big-btn{min-height:56px;font-size:17px;justify-content:center;width:100%;margin-top:12px}
.time-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0 0 16px}.time-actions .btn{margin:0}
.tt-list{display:grid;gap:8px;margin-top:10px}.tt-list button{margin:0;min-height:52px;justify-content:flex-start;background:var(--surface-2);color:var(--text);border-radius:14px;font-size:16px;box-shadow:inset 0 0 0 1.5px var(--line);text-align:left}
.hm{display:grid;grid-template-columns:1fr 1fr;gap:12px}.stamp{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:4px;margin:4px 0 0}.stamp .ic{width:14px;height:14px}
.log-row .log-desc{white-space:pre-line;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.log-row .sub .ic{width:14px;height:14px;vertical-align:-2px}.tl-mins{flex:none}
.tl-file{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0}.tl-file a{display:inline-flex;align-items:center;gap:6px;overflow-wrap:anywhere;min-height:44px}.tl-file form{margin:0 0 0 auto}.tl-file button{margin:0}[data-since],.bigtime{font-variant-numeric:tabular-nums}.bigtime{font-size:36px;font-weight:800;line-height:1.2}
.hr-row{display:flex;gap:8px;align-items:center}.hr-dates>div{min-width:0}.hr-dates input{min-width:0;padding:10px 8px}.hr-row select{flex:1;min-height:48px}.hr-row button{margin:0;min-height:48px}
.hr-ranges .pj-btn{min-height:52px;padding:8px 12px;text-align:center}.hr-big{font-size:40px;font-weight:800;line-height:1.15;margin:6px 0 2px;font-variant-numeric:tabular-nums}
.hb-row{padding:6px 0}.hb-text{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.hb-name{font-weight:700;overflow-wrap:anywhere;min-width:0}.hb-name small{display:block;color:var(--muted);font-weight:600}
.hb-val{flex:none;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}.hb-track{height:10px;border-radius:99px;background:var(--muted-bg);overflow:hidden;margin-top:4px}.hb-fill{height:100%;border-radius:99px;background:var(--accent)}
.hc{display:flex;align-items:stretch;gap:2px;height:150px;padding-bottom:20px;border-bottom:1px solid var(--line);position:relative}
.hc-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;position:relative}.hc-bar{background:var(--accent);border-radius:4px 4px 0 0;min-height:0}
.hc-tick{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--muted);white-space:nowrap}
.hc-list{margin-top:10px}.hc-list summary{cursor:pointer;color:var(--brand);font-weight:700;min-height:44px;display:flex;align-items:center}.hc-list ul{list-style:none;margin:0;padding:0}
.hc-list li{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--line)}
.hs-day{display:flex;justify-content:space-between;gap:10px;font-size:15px;margin:14px 0 2px;padding:6px 8px;background:var(--surface-2);border-radius:10px}
.hs-row .title{color:var(--text);text-decoration:underline;text-decoration-color:var(--line);display:inline-block;min-height:32px}.hs-files{display:flex;flex-wrap:wrap;gap:4px 12px}
.hs-files a{display:inline-flex;align-items:center;gap:4px;min-height:36px;overflow-wrap:anywhere;font-size:14px}.hs-files .ic,.hs-row .stamp .ic{width:14px;height:14px}
.hb-fill.u-warn{background:var(--warn)}.hb-fill.u-bad{background:var(--bad)}.bad-text{color:var(--bad)}.warn-text{color:var(--warn)}.usage{margin-top:6px}
.ta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:0 16px}.ta-grid>.card{min-width:0}.ta-ranges{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}.pk-pct{flex:none;font-weight:800}
a.item.pick{display:block;color:inherit;text-decoration:none;border-radius:12px}a.item.pick:hover{background:var(--surface-2)}a.item.pick .item-head{cursor:pointer}
.proj-tabs{margin:0 0 12px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:2px 2px 8px}.proj-tabs::-webkit-scrollbar{display:none}.proj-tabs .chip{flex:none}.proj-tabs .chip{text-decoration:none;font-size:14px;padding:7px 14px;box-shadow:var(--shadow)}.proj-tabs .chip.on{background:var(--accent);color:#fff}
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
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px 24px;padding:4px 8px 8px;margin:0}
.fields>div{min-width:0}.fields dt{font-size:13px;color:var(--muted);font-weight:700}.fields dd{margin:2px 0 0;overflow-wrap:anywhere}
.fields .wide{grid-column:1/-1}.fields .wide dd{white-space:pre-line}.fields a{display:inline-flex;align-items:center;gap:4px}
.fe dd{cursor:pointer;border-radius:8px;margin:2px -6px 0;padding:2px 6px;min-height:28px}.fe dd:hover{background:var(--surface-2)}.fe-none{color:var(--muted)}
.fe-pen{background:transparent;color:var(--muted);padding:2px 6px;margin:0 0 0 2px;border-radius:8px;vertical-align:middle;opacity:0;white-space:normal}
.fe-pen svg{width:16px;height:16px}.fe:hover .fe-pen,.fe-pen:focus-visible{opacity:1}.fe-pen:focus-visible{outline:2px solid var(--accent)}
@media (hover:none){.fe-pen{opacity:.6;padding:6px 8px}}
.fe dt .fe-saved{margin-left:6px;font-size:12px;padding:1px 8px}
.fields .fe-editing{grid-column:1/-1}.fe-form{margin-top:4px}.fe-form .actions{margin-top:8px}.fe-auto .fe-save{display:none}
.fe-form label[for],.fe-form legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.fe-form .check{margin-top:4px!important}.fe-form .picks{margin:0}.fe-form .toast{display:block;margin:8px 0 0;padding:8px 12px}.fe-form .fe-error[hidden]{display:none}
body:not(.show-empty) .fe-empty,body:not(.show-empty) .sec-empty{display:none}.show-empty #rec-nothing{display:none}
.show-empty .fe-toggle .when-hidden,body:not(.show-empty) .fe-toggle .when-shown{display:none}.fe-toggle{margin:0 0 0 6px}
.chip.tg-grey{background:var(--muted-bg);color:var(--text)}.chip.tg-blue{background:var(--info-bg);color:var(--info)}.chip.tg-green{background:var(--good-bg);color:var(--good)}
.chip.tg-yellow{background:#fef7c3;color:#854a0e}.chip.tg-orange{background:#ffead5;color:#b93815}.chip.tg-red{background:var(--bad-bg);color:var(--bad)}
.chip.tg-purple{background:#ebe9fe;color:#5925dc}.chip.tg-pink{background:#fce7f6;color:#c11574}
@media (prefers-color-scheme:dark){.chip.tg-yellow{background:#3b3207;color:#fde272}.chip.tg-orange{background:#3d1d0b;color:#feb273}.chip.tg-purple{background:#27184d;color:#bdb4fe}.chip.tg-pink{background:#3d0f2c;color:#faa7e0}}
.tag-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:10px 0 0}.tag-row .tag-chips{margin:0}.tag-row .chip{white-space:normal}.tag-row .tag-open{margin:0}
.tag-picker{position:fixed;inset:0;z-index:50;background:rgba(17,27,33,.45);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px}.tag-picker[hidden]{display:none}
.tp-box{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);width:100%;max-width:560px;max-height:88vh;overflow-y:auto;padding:16px}
.tp-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.tp-head h3{margin:0}.tp-head button{margin:0}.tp-box .search{margin:12px 0}
.tp-group{border:0;padding:0;margin:0 0 10px;min-width:0}.tp-group legend{font-weight:700;font-size:13px;color:var(--muted);padding:0;margin-bottom:2px}
.tp-tag{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin:0 12px 0 0;cursor:pointer}.tp-tag input{width:20px;height:20px;accent-color:var(--accent)}.tp-tag[hidden],.tp-group[hidden],.tp-error[hidden],.tp-nomatch[hidden]{display:none}
.tp-new{margin-top:8px;border-top:1px solid var(--line);padding-top:8px}.tp-new>summary{cursor:pointer;font-weight:700;list-style:none;display:flex;align-items:center;gap:6px;min-height:44px}.tp-error{display:block}
body.tp-open{overflow:hidden}
.list-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;margin:-6px 0 12px}.list-tools button,.list-tools .btn{margin:0}
.tag-filter>summary{list-style:none}.tag-filter>summary::-webkit-details-marker{display:none}.tag-filter.on>summary{background:var(--accent);color:var(--accent-ink)}
.tag-filter[open]{flex:1 1 100%}.tf-box{background:var(--surface);border-radius:14px;box-shadow:var(--shadow);padding:6px 14px 12px;margin-top:8px}.tf-mode{display:flex;flex-wrap:wrap;gap:4px 16px;margin-bottom:8px}.tf-mode .check{min-height:44px;margin:0}
.contact-row>a.item-head{padding-left:8px}.contact-client{flex:0 1 auto;max-width:42%;display:inline-flex;align-items:center;gap:6px;padding:10px 8px;border-radius:10px;font-weight:600;font-size:14px;overflow-wrap:anywhere;text-decoration:none}.contact-client:hover{background:var(--surface-2)}.contact-client .ic{width:16px;height:16px}.contact-row>.chip{margin:0 8px}
.sel-item{display:flex;align-items:center}.sel-item[hidden]{display:none}.sel-item>a.item-head{flex:1;min-width:0;color:inherit;text-decoration:none;border-radius:12px;cursor:pointer;padding-left:0}.sel-item>a.item-head:hover{background:var(--surface-2)}
.sel{display:flex;align-items:center;justify-content:center;width:44px;min-height:44px;flex:none;cursor:pointer;margin:0}.sel input{width:20px;height:20px;accent-color:var(--accent);margin:0}
.row-tags{margin:4px 0 0}.row-tags .chip{font-size:12px;padding:2px 8px;white-space:normal}
.bulk-bar{position:sticky;bottom:12px;z-index:20;display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:var(--surface);border-radius:var(--radius);box-shadow:0 4px 18px rgba(17,27,33,.18);padding:10px 14px;margin:12px 0}
.bulk-bar[hidden]{display:none}.bulk-bar button{margin:0}.bulk-bar select{width:auto;max-width:100%;flex:1 1 140px}.bulk-count{font-weight:800}
.bulk-tags{display:contents}.bf>summary,.lt-pop>summary{list-style:none}.bf>summary::-webkit-details-marker,.lt-pop>summary::-webkit-details-marker{display:none}
.bf[open]{flex:1 1 100%;order:5;min-width:0}.bulk-bar select{min-width:0}.bf-box .bf-field{flex:1 1 100%;width:100%}.bf-box{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0 0}.bf-box input:not([type=checkbox]){width:auto;flex:1 1 140px;margin:0}.bf-multi .check{min-height:40px;margin:0}.bf-val{display:contents}.bf-multi{display:flex;flex-wrap:wrap;gap:0 12px;flex:1 1 100%}.bf-note{flex:1 1 100%;margin:0}
.bulk-bar{gap:6px;padding:6px 10px;margin:8px 0;font-size:14px}.bulk-count{font-size:13px}.bulk-bar button.sm,.bulk-bar summary.btn.sm{padding:4px 11px;font-size:13px;gap:4px}.bulk-bar select,.bulk-bar .bf-box input:not([type=checkbox]){padding:4px 9px;font-size:13px;border-radius:10px;flex:1 1 110px}.bulk-bar .bf-box{gap:6px;padding-top:6px}.bulk-bar .bf-note{font-size:12px}.bulk-bar svg{width:14px;height:14px}
.lt-pop[open]{flex:1 1 100%}.lt-pop.on>summary{background:var(--accent);color:var(--accent-ink)}.lt-picks{display:flex;flex-wrap:wrap;gap:0 16px}.lt-picks .check{min-height:40px;margin:0}
.ff-row{border-top:1px solid var(--line);padding:8px 0}.ff-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.ff-head select{width:auto;flex:1 1 140px;margin:0}.ff-head button{margin:0}
.ff-vals{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:6px}.ff-vals:empty{display:none}.ff-vals input[type=text],.ff-vals input[type=number],.ff-vals input[type=date]{width:auto;flex:1 1 120px;margin:0}.ff-vals .check{min-height:40px;margin:0}
.lwrap{overflow-x:auto}.lwrap .section{min-width:min-content}.lrow{display:grid;grid-template-columns:44px minmax(150px,1.6fr) repeat(var(--n),minmax(80px,1fr));min-width:calc(194px + var(--n)*80px + (var(--n) + 1)*10px);align-items:center;column-gap:10px;position:relative}
.lrow>.lr-name{display:flex;align-items:center;gap:10px;min-width:0;padding:8px 0;color:inherit;text-decoration:none;font-weight:700}.lrow>.lr-name::after{content:"";position:absolute;inset:0;border-radius:12px}
.lrow:hover{background:var(--surface-2);border-radius:12px}.lrow .sel,.lrow .lr-cell a{position:relative;z-index:1}.lr-cell{min-width:0;font-size:14px;color:var(--muted);overflow-wrap:anywhere;padding:6px 0}.lr-cell .chip{margin:0}.lr-cell .chips{margin:0}
.lhead{font-size:13px;font-weight:700;padding:0 0 4px;margin:0 18px}.lhead .lh{color:var(--muted);text-decoration:none;padding:6px 0;min-height:32px;display:flex;align-items:center}.lhead .lh.on{color:var(--text)}.lh-sort{visibility:hidden}
.sec-body>.lrow{margin:0 8px}
@media (max-width:600px){.lwrap{overflow:visible}.lwrap .section{min-width:0}.lrow{grid-template-columns:44px minmax(0,1fr);min-width:0;column-gap:4px}.lr-cell{grid-column:2;padding:0 0 4px}.lr-cell:not(.lr-top),.lr-top:empty{display:none}.lrow>.lr-name{padding-bottom:4px}
  .lhead{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 6px}.lhead .lh:nth-of-type(n+4){display:none}.lh-sort{visibility:visible;align-self:center}}
@media (max-width:600px){.tag-picker{padding:0}.tp-box{max-width:none;max-height:none;height:100%;border-radius:0}.bulk-bar{bottom:76px}}
.rec-head{display:flex;gap:14px;align-items:center}.rec-actions .btn{max-width:100%;overflow-wrap:anywhere}.rec-head h2{margin:0;font-size:22px}.rec-head .chips{margin:4px 0 0}
.record-form .section,#offer,#step,#notes,#files{scroll-margin-top:80px}.steps .chip{font-weight:600}.step-count{display:none}@media (max-width:600px){.steps{display:none}.step-count{display:block}
  #applicants-list .item-head{flex-wrap:wrap}#applicants-list .item-head>.grow{flex:1 1 calc(100% - 100px)}
  #applicants-list .side-chips{order:3;flex:1 1 100%;justify-content:flex-start;padding-left:52px}#applicants-list .side-chips:empty{display:none}.side-chips.stack{flex-direction:column;align-items:flex-end}}.side-chips{margin:0;justify-content:flex-end}.score-line{margin:4px 8px 10px}
.inline-opts{margin:0}.inline-opts>summary.btn{color:var(--text);font-size:14px;padding:6px 14px}.inline-opts[open]{flex:1 1 100%}
.inline-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.inline-form select{width:auto;flex:1 1 200px}.inline-form button{margin:0}
.form-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:0 18px;padding:0 8px 10px}.form-grid>*{min-width:0}.form-grid .wide{grid-column:1/-1}
.form-grid .small{margin-top:4px}.picks{border:0;padding:0;margin:12px 0 0;min-width:0}.picks legend{font-weight:700;font-size:14px;padding:0;margin-bottom:2px}
.picks .check{display:inline-flex;margin:6px 16px 0 0;font-weight:600}.picks.scroll{max-height:240px;overflow-y:auto;border:1.5px solid var(--line);border-radius:12px;padding:6px 12px 10px}
.picks.scroll legend{float:left;width:100%;margin:0}.picks.scroll .check{display:flex}
.save-bar{position:sticky;bottom:12px;z-index:4;display:flex;gap:8px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:99px;padding:8px;box-shadow:0 6px 24px rgba(0,0,0,.12);width:max-content;max-width:100%}
.save-bar button,.save-bar .btn{margin:0}
.mail-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.5;border-top:1px solid var(--line);margin-top:12px;padding-top:12px}
.mail-snippet{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mail-msgs{padding:0 4px 8px 12px}.mail-subject,.mail-head dd{overflow-wrap:anywhere}
.mail-files{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.mail-files .btn{max-width:100%;overflow-wrap:anywhere;white-space:normal}
.mail-person-body{padding:0 8px 10px 60px}.mail-disconnect .check{margin:6px 0}
@media (max-width:860px){.mail-person-body{padding-left:8px}}
.note{display:flex;gap:12px;padding:10px 8px;align-items:flex-start}.note+.note{border-top:1px solid var(--line)}.note .bubble{overflow-wrap:anywhere}
.note-add,.file-add{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:4px 8px 8px}.note-add textarea{flex:1 1 100%;min-height:70px}.note-add button,.file-add button{margin:0}
.file-add input[type=file]{flex:1 1 14em;min-width:0}.file-add select{width:auto;flex:0 1 auto}.file-ic{width:40px;display:grid;place-items:center;color:var(--muted)}
.changes{margin:6px 0 0;padding-left:18px;font-size:14px;color:var(--muted)}.changes li{overflow-wrap:anywhere}.changes b{color:var(--text)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after,::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important;transition:none!important}}
@media (max-width:860px){
  .sidebar{position:fixed;z-index:20;left:0;top:0;transform:translateX(-100%);transition:transform .2s;box-shadow:0 0 40px rgba(0,0,0,.3)}
  #nav-toggle:checked~.app .sidebar{transform:none}
  #nav-toggle:checked~.app .scrim{display:block;position:fixed;inset:0;z-index:15;background:rgba(0,0,0,.35)}
  .topbar{background:var(--brand);color:#fff;border:0;padding:12px 16px}.topbar .menu{display:inline-flex;color:#fff}
  main{padding:16px 16px 96px}.item-body{padding-left:12px}
  .row{flex-direction:column;align-items:stretch;gap:0}.row>*{min-width:0;width:100%}
  input,select,textarea{font-size:16px}
  button.sm,.btn.sm{min-height:44px}.days span{padding:9px 12px}
  .inline-add{flex-wrap:wrap}.inline-add input{flex:1 1 12em;min-width:0}
  .item-head .chip{white-space:normal;text-align:center}
  .save-bar{bottom:calc(78px + env(safe-area-inset-bottom))}
  .item.stack>.item-head{flex-wrap:wrap;row-gap:8px}.item.stack>.item-head>.grow{flex:1 1 100%}.item.stack>.item-head>.grow+*{margin-left:auto}
  .sec-title{min-width:0;hyphens:auto;-webkit-hyphens:auto;overflow-wrap:break-word}
  .top-search{display:inline-flex;padding:4px}.side-search kbd{display:none}
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
        // Rows hidden by another filter (the tag filter on list pages) have data-out.
        var match = (!q || row.textContent.toLowerCase().indexOf(q) !== -1) && !row.hasAttribute('data-out');
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
  // Pages with data-remember start with everything closed, but keep the sections
  // a person opened during this visit open after a save reloads the page.
  document.querySelectorAll('[data-remember]').forEach(function (box) {
    var key = 'open:' + box.dataset.remember, open = {};
    try { open = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch (e) {}
    box.querySelectorAll('details[data-key]').forEach(function (d) {
      if (open[d.dataset.key]) d.open = true;
      d.addEventListener('toggle', function () {
        if (d.open) open[d.dataset.key] = 1; else delete open[d.dataset.key];
        try { sessionStorage.setItem(key, JSON.stringify(open)); } catch (e) {}
      });
    });
  });
  // The project buttons scroll sideways on phones: keep the chosen one in view.
  var onTab = document.querySelector('.proj-tabs .on');
  if (onTab) {
    var row = onTab.parentNode, over = onTab.getBoundingClientRect().right - row.getBoundingClientRect().right;
    if (over > 0) row.scrollLeft += over + 16;
  }
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
  // "/" jumps to the search box (admins, not while typing in a field).
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var box = document.getElementById('page-search') || (window.matchMedia('(max-width:860px)').matches ? null : document.querySelector('.side-search input'));
    if (!box) return;
    e.preventDefault(); box.focus(); if (box.select) box.select();
  });
  // Short window: scroll the menu so the current page's link is in view.
  var sideNav = document.querySelector('.side-nav'), sideOn = sideNav && sideNav.querySelector('.on');
  if (sideOn && sideOn.offsetTop + sideOn.offsetHeight > sideNav.clientHeight) sideNav.scrollTop = sideOn.offsetTop - 8;
})();
</script>`;

export function layout({ title, user, active, message, body }) {
  // A message is a name from MESSAGES, or [tone, text] made by the page (for example "changed 5 records").
  const msg = Array.isArray(message) ? message : MESSAGES[message];
  const toast = msg ? `<div class="toast ${msg[0]}" role="status">${msg[0] === 'good' ? icon('check') : ''}${esc(msg[1])}</div>` : '';
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#008069"><link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="InoVA"><meta name="apple-mobile-web-app-status-bar-style" content="default"><title>${esc(title)} · InoVA Local</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>`;

  // Log-in and set-up pages: a simple centered card.
  if (!user) return `${head}<div class="auth"><div>${toast}${body}</div></div>${SCRIPT}</body></html>`;

  const pending = user.pending_requests || 0;
  const groups = [];
  const sopsToDo = user.sops_todo?.length || 0;
  // Trainers and trainees get a Training link while their training runs; new hires in training see only that.
  const training = user.trainings?.length ? ['/training', user.in_training ? 'My training' : 'Training', 'training'] : null;
  if (user.in_training) groups.push(['Me', [training]]);
  else if (user.is_va) groups.push(['Me', [['/va', 'My day', 'sun'], ['/va/time', 'Time', 'timer'], ['/va/sops', 'Coverage SOPs', 'doc', sopsToDo], training].filter(Boolean)]);
  else if (training && !user.is_admin) groups.push(['Me', [training]]);
  if (user.is_admin) {
    groups.push(['Daily', [['/admin', 'Today', 'today'], ['/admin/time-off', 'Time off', 'timeoff', pending], ['/admin/calendar', 'Calendar', 'calendar']]]);
    groups.push(['Team', [['/admin/vas', 'VAs', 'va'], ['/admin/training', 'Training', 'training'], ['/admin/applicants', 'Applicants', 'applicant'], ['/admin/people', 'People', 'people']]]);
    groups.push(['Clients', [['/admin/clients', 'Clients', 'building'], ['/admin/contacts', 'Contacts', 'people'], ['/admin/projects', 'Projects', 'projects'], ['/admin/time', 'Time', 'timer'], ['/admin/sops', 'Coverage SOPs', 'doc']]]);
  }
  const link = ([href, label, ic, badge]) =>
    `<a class="side-link ${href === active ? 'on' : ''}" href="${href}">${icon(ic)}<span>${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
  const sidebar = `<aside class="sidebar" aria-label="Menu">
    <div class="side-brand"><div class="logo">IV</div><div><strong>InoVA Local</strong><small>VA App</small></div></div>
    ${user.is_admin ? `<form class="side-search" action="/admin/search" method="get" role="search">${icon('search')}<input type="search" name="q" placeholder="Search everything" aria-label="Search everything" autocomplete="off"><kbd title="Press / to search">/</kbd></form>` : ''}
    <nav class="side-nav" aria-label="Pages">${groups.map(([label, links]) => `<div class="side-group"><div class="side-label">${label}</div>${links.map(link).join('')}</div>`).join('')}</nav>
    <div class="side-user">
      <div class="me">${avatar(user.name)}<div><strong>${esc(user.name)}</strong><small>${user.is_admin ? 'Admin' : user.is_va && !user.in_training ? 'VA' : 'In training'}</small></div></div>
      ${user.is_admin ? `<a class="side-link ${active === '/admin/settings' ? 'on' : ''}" href="/admin/settings">${icon('settings')}<span>Settings</span></a>` : ''}
      <a class="side-link ${active === '/account' ? 'on' : ''}" href="/account">${icon('key')}<span>Password</span></a>
      <form method="post" action="/logout"><button>${icon('logout')}<span>Log out</span></button></form>
    </div>
  </aside>`;

  // Phone bottom bar: the most-used pages, plus "Menu" for the rest.
  const tabs = user.is_admin
    ? [['/admin', 'Today', 'today'], ['/admin/time-off', 'Time off', 'timeoff', pending], ['/admin/projects', 'Projects', 'projects'], ['/admin/sops', 'SOPs', 'doc'], ['/admin/people', 'People', 'people']]
    : user.in_training || !user.is_va ? [training || ['/training', 'Training', 'training']]
    : [['/va', 'My day', 'sun'], ['/va/time', 'Time', 'timer'], ['/va/sops', 'SOPs', 'doc', sopsToDo], training].filter(Boolean);
  const tabbar = `<nav class="tabbar" aria-label="Main pages">${tabs.map(([href, label, ic, badge]) =>
    `<a href="${href}" class="${href === active ? 'on' : ''}">${icon(ic)}${label}${badge ? `<span class="badge">${badge}</span>` : ''}</a>`).join('')}
    <label for="nav-toggle">${icon('menu')}Menu</label></nav>`;

  return `${head}<input type="checkbox" id="nav-toggle" aria-hidden="true">
<div class="app">${sidebar}<label for="nav-toggle" class="scrim" aria-hidden="true"></label>
  <div class="main-col">
    <header class="topbar"><label for="nav-toggle" class="menu" aria-label="Open menu">${icon('menu')}</label><h1>${esc(title)}</h1>${user.is_admin ? `<a class="top-search" href="/admin/search" aria-label="Search everything">${icon('search')}</a>` : ''}</header>
    <main>${toast}${active === '/va/time' ? '' : timerBar(user)}${active === '/va/sops' ? '' : sopBanner(user, active)}${body}</main>
  </div>
</div>${tabbar}${SCRIPT}</body></html>`;
}

// A bar at the top of every VA page while timers run (or wait to be saved). One running timer shows its time and a
// Stop button; several show "2 timers running". Both open the Time page.
function timerBar(user) {
  const timers = user.timers || [];
  const stopped = timers.filter((t) => t.stopped_at), running = timers.filter((t) => !t.stopped_at);
  let html = '';
  if (stopped.length) {
    html += `<a class="timerbar stopped" href="/va/time">${icon('timer')}<span class="grow"><b>${stopped.length > 1 ? `${stopped.length} timers to finish saving` : 'Finish saving your timer'}</b>${stopped.length === 1 ? ` · ${esc(stopped[0].client || '')}` : ''}</span>${icon('chevron')}</a>`;
  }
  if (running.length === 1) {
    const t = running[0];
    html += `<div class="timerbar">${icon('timer')}<a class="grow" href="/va/time?project=${esc(encodeURIComponent(t.project_id))}"><b data-since="${esc(t.started_at)}">0:00:00</b> · ${esc(t.type_name || t.task_name || 'General')}${t.client ? ` · ${esc(t.client)}` : ''}</a>
    <form method="post" action="/va/time/timer/${t.id}/stop"><button class="sm">${icon('stop')} Stop</button></form></div>`;
  } else if (running.length > 1) {
    html += `<a class="timerbar slim" href="/va/time">${icon('timer')}<span class="grow"><b>${running.length} timers running</b></span>${icon('chevron')}</a>`;
  }
  return html;
}

// A reminder on every VA page while any of their projects has no Coverage SOP yet.
// The full message on My day; one short line on the other pages.
function sopBanner(user, active) {
  const todo = user.sops_todo || [];
  if (!todo.length) return '';
  if (active !== '/va') {
    return `<a class="timerbar stopped slim" href="/va/sops">${icon('doc')}<span class="grow"><b>${todo.length} Coverage SOP${todo.length > 1 ? 's' : ''} to do</b></span>${icon('chevron')}</a>`;
  }
  const names = todo.map((s) => s.client).join(', ');
  return `<a class="timerbar stopped" href="/va/sops">${icon('doc')}<span class="grow"><b>Please complete your Coverage SOP${todo.length > 1 ? 's' : ''}</b> for ${esc(names)}.
    A backup VA follows it when you are off. Fill in the template or upload your own.</span>${icon('chevron')}</a>`;
}

// ---- Login pages ----

export function loginPage(error, email = '') {
  const errors = { wrong: 'That email and password do not match.', locked: 'Too many tries. Please wait 15 minutes and try again.', inactive: 'This account is not active. Please contact an admin.' };
  return layout({
    title: 'Log in',
    body: `<div class="card">
      <div class="logo">IV</div>
      <h2 style="font-size:22px">Welcome back</h2>
      <p class="lead">Log in to the InoVA Local app.</p>
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
    ? `<div class="chips" style="justify-content:center">${day.projects.map((p) => chip(`${p.client}${p.startLabel ? ` · ${p.startLabel}` : ''}`, 'muted')).join('')}</div>
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
      ${day.projects.length ? `<a class="btn plain" href="/va/time">${icon('timer')} Log my time</a><p class="small">Starting a timer there also checks you in.</p>` : ''}
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
const NEEDS_BACKUP = '<span style="color:var(--warn);font-weight:700">needs a backup</span>';

// A request's status as [label, tone]. Approved time off with coverage reads "Coverage requested"
// until every covered project has a backup, then "Coverage confirmed" ("Backup is off" when a chosen backup
// has time off of their own during it).
export function requestStatus(r) {
  const covered = r.kind !== 'emergency' ? r.coverage || [] : [];
  if (r.status === 'approved' && covered.length) {
    if (covered.some((c) => c.backup_name && c.backup_off?.length)) return ['Backup is off', 'bad'];
    return covered.every((c) => c.backup_name) ? ['Coverage confirmed', 'good'] : ['Coverage requested', 'warn'];
  }
  return [r.status[0].toUpperCase() + r.status.slice(1), REQUEST_TONE[r.status]];
}

// A backup's own time off during a request, for example "Mon, Oct 5 – Tue, Oct 6 (waiting for a decision)".
const offText = (list) => list.map((o) => `${dateRange(o.start_date, o.end_date, false)}${o.status === 'pending' ? ' (waiting for a decision)' : ''}`).join(', ');

// Who covers each project, for example "Pool Partners: covered by Ana Diaz · Rise & Shine: needs a backup".
// A backup who is off during the request is flagged: "covered by Ana Diaz (also off Oct 5)".
function coverageText(r) {
  const rows = r.coverage || [];
  if (r.kind === 'emergency' || !rows.length) return 'No coverage';
  return rows.map((c) => `${c.project_id ? `${esc(c.client)}: ` : ''}${c.backup_name ? `covered by ${esc(c.backup_name)}${c.backup_off?.length
    ? ` <span style="color:var(--bad);font-weight:700">(also off ${esc(offText(c.backup_off))})</span>` : ''}` : NEEDS_BACKUP}`).join(' · ');
}

// The projects a request can need coverage for (the same rule as coverableProjects in index.js).
// vaProjects: [{ user_id, id, client }] of active projects.
function coverableProjects(r, vaProjects) {
  const only = r.project_ids ? r.project_ids.split(',') : null;
  const list = vaProjects.filter((p) => p.user_id === r.user_id && (!only || only.includes(p.id))).map((p) => ({ id: p.id, client: p.client }));
  for (const c of r.coverage || []) if (!list.some((p) => p.id === c.project_id)) list.push({ id: c.project_id, client: c.client });
  return list.length ? list : [{ id: '', client: 'All work' }];
}

// How often a backup has covered a project before, leaving out the request being looked at:
// "never covered this client" or "covered this client 2 times, last Fri, Oct 2". '' for "All work".
// history: Map "<backup Zoho id>|<project id>" -> [{ request_id, end_date }] (coverageHistory in index.js).
function historyText(history, zohoId, projectId, requestId) {
  if (!history || !projectId || !zohoId) return '';
  const past = (history.get(`${zohoId}|${projectId}`) || []).filter((h) => h.request_id !== requestId);
  if (!past.length) return 'never covered this client';
  return `covered this client ${past.length === 1 ? 'once' : `${past.length} times`}, last ${formatDate(past[past.length - 1].end_date)}`;
}

// One "who covers" list per project, named cover_<va id>_<project id>. The VA taking time off is left out.
// A backup already chosen stays in the list even if an admin has since hidden them. Each name shows
// how often that VA has covered the project before.
// offBy: { "<Zoho id>": [time off] } of backups who are off during the request; their names say so.
function coverageSelects(va, projects, backups, coverage = [], history = null, requestId = 0, offBy = {}) {
  const choices = backups.filter((b) => !va || (b.zoho_id !== va.zoho_id && b.name !== va.name));
  return projects.map((p) => {
    const c = coverage.find((x) => x.project_id === p.id);
    const chosen = c ? c.backup_zoho_id || 'open' : '';
    const past = (zohoId) => {
      const text = historyText(history, zohoId, p.id, requestId);
      return `${offBy[zohoId] ? ` · ⚠ also off ${offText(offBy[zohoId])}` : ''}${text ? ` · ${text}` : ''}`;
    };
    const kept = chosen && chosen !== 'open' && !choices.some((b) => b.zoho_id === chosen)
      ? `<option value="${esc(chosen)}" selected>${esc(c.backup_name || 'Chosen backup')}${esc(past(chosen))}</option>` : '';
    return `<label>${esc(p.client)}</label>
      <select name="cover_${va.id}_${esc(p.id || 'all')}" aria-label="${esc(`Who covers ${p.client}`)}">
        <option value="">No coverage needed</option>
        <option value="open" ${chosen === 'open' ? 'selected' : ''}>Needs coverage, backup not chosen yet</option>
        ${kept}${choices.map((b) => `<option value="${esc(b.zoho_id)}" ${b.zoho_id === chosen ? 'selected' : ''}>${esc(b.name)} (${esc(b.status)})${esc(past(b.zoho_id))}</option>`).join('')}
      </select>`;
  }).join('');
}

// Requests as clickable rows. Admins (ctx.vas set) also get actions and the edit form.
// ctx.back: set on a request's own page, so its forms return there; ctx.open opens the card.
function requestCards(requests, forAdmin, ctx = {}) {
  if (!requests.length) return empty('No requests.');
  return requests.map((r) => {
    const [label, tone] = requestStatus(r);
    const shortNotice = !r.added_by_admin && r.created_at && r.start_date < addDays(r.created_at.slice(0, 10), 14);
    const warn = (text) => ` · <span style="color:var(--warn);font-weight:700">${text}</span>`;
    const sub = `${esc(dateRange(r.start_date, r.end_date))} · ${coverageText(r)}${shortNotice ? warn("Less than 2 weeks' notice") : ''}`
      + (forAdmin && r.nearby?.length ? warn(`Also off within a week: ${esc(r.nearby.join('; '))}`) : '');
    // For example "Shianne Catalano has never covered this client (Cleaning Ninjas)".
    const histories = forAdmin && ctx.history && r.kind !== 'emergency' ? (r.coverage || []).filter((c) => c.backup_zoho_id && c.project_id).map((c) =>
      `${esc(c.backup_name)} has ${esc(historyText(ctx.history, c.backup_zoho_id, c.project_id, r.id))} (${esc(c.client)})`) : [];
    const checklists = forAdmin ? (r.coverage || []).map((c) => {
      const name = c.project_id ? ` (${esc(c.client)})` : '';
      return [
        c.clickup_list_url && `<p class="meta"><a href="${esc(c.clickup_list_url)}" target="_blank" rel="noopener">${icon('external')} Open the ClickUp checklist${name}</a></p>`,
        c.clickup_error && r.status !== 'pending' && `<p class="meta" style="color:var(--bad)">ClickUp${name}: ${esc(c.clickup_error)}</p>`,
      ].filter(Boolean).join('');
    }).join('') : '';
    // Each covered project's Coverage SOP, so the backup knows what to do. For example "Pool Partners: Uploaded".
    const sops = forAdmin && r.kind !== 'emergency' ? (r.coverage || []).filter((c) => c.sop).map((c) =>
      `<a href="/sops/${esc(encodeURIComponent(c.project_id))}">${esc(c.client)}</a>: ${c.sop.done ? esc(c.sop.label) : `<span style="color:var(--warn);font-weight:700">${esc(c.sop.label)}</span>`}`) : [];
    const body = `
      ${r.details || r.note ? `<div class="bubble">${esc([r.details, r.note].filter(Boolean).join('\n'))}</div>` : ''}
      <p class="meta">${r.added_by_admin ? 'Added by an admin' : r.source === 'form' ? 'From the request form' : 'Request'}
        · ${r.project_names ? `Only these projects: <b>${esc(r.project_names)}</b>` : 'All projects'}
        ${r.decided_by_name ? ` · ${esc(r.status)} by <b>${esc(r.decided_by_name)}</b>` : ''}
        ${forAdmin && !ctx.back ? ` · <a href="/admin/time-off/${r.id}">Details and next steps</a>` : ''}</p>
      ${histories.length ? `<p class="meta">Coverage history: ${histories.join(' · ')}</p>` : ''}
      ${sops.length ? `<p class="meta">Coverage SOP: ${sops.join(' · ')}</p>` : ''}
      ${checklists}
      ${forAdmin ? requestActions(r, ctx) : ''}`;
    return item({
      name: forAdmin ? r.name : undefined,
      title: `${forAdmin ? `${esc(r.name)} · ` : ''}${KIND_LABEL[r.kind] || 'Time off'}`,
      sub, side: chip(label, tone), body, open: ctx.open || (forAdmin && r.status === 'pending'),
    });
  }).join('');
}

function requestActions(r, ctx) {
  const buttons = [];
  const covered = r.kind !== 'emergency' ? r.coverage || [] : [];
  const back = ctx.back ? `<input type="hidden" name="back" value="${esc(ctx.back)}">` : '';
  if (r.status === 'pending') {
    buttons.push(`<span class="small">${covered.length
      ? `Approving requests coverage and creates ${covered.length === 1 ? 'a ClickUp checklist' : `${covered.length} ClickUp checklists, one per project`}.`
      : 'No coverage chosen, so no ClickUp checklist. If it needs coverage, choose the projects in Edit first.'}</span>`);
    buttons.push(`<form method="post" action="/admin/time-off/${r.id}/approve">${back}<button class="sm">${icon('check')} ${covered.length ? 'Approve and request coverage' : 'Approve'}</button></form>`);
    buttons.push(`<form method="post" action="/admin/time-off/${r.id}/deny" data-confirm="Deny this request?">${back}<button class="sm danger">Deny</button></form>`);
  }
  if (r.status === 'approved' && covered.some((c) => !c.clickup_list_url)) {
    buttons.push(`<form method="post" action="/admin/time-off/${r.id}/clickup">${back}<button class="sm plain">Create missing ClickUp checklists</button></form>`);
  }
  if (r.status === 'approved' && r.cancellable) {
    const lists = covered.filter((c) => c.clickup_list_url).length;
    const confirm = `Cancel this time off? Check-ins will be expected again from today.${lists ? ` Its ClickUp checklist${lists === 1 ? ' is' : 's are'} deleted.` : ''}`;
    buttons.push(`<form method="post" action="/admin/time-off/${r.id}/cancel" data-confirm="${esc(confirm)}">${back}<button class="sm danger">Cancel time off</button></form>`);
  }
  const edit = ['pending', 'approved'].includes(r.status) && ctx.vas ? editForm(r, ctx) : '';
  return `<div class="actions">${buttons.join('')}</div>${edit}`;
}

// The admin form to change a request's VA, type, dates, and who covers each project.
function editForm(r, { vas, backups, vaProjects, back, history }) {
  const requester = vas.find((v) => v.id === r.user_id) || { id: r.user_id };
  return `<details class="section" style="margin:12px 0 0;box-shadow:none;background:var(--surface-2)"><summary>Edit${icon('chevron', 'chev')}</summary>
    <form method="post" action="/admin/time-off/${r.id}/edit" style="padding:0 16px 14px">
      ${back ? `<input type="hidden" name="back" value="${esc(back)}">` : ''}
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
      <p class="small" style="margin:12px 0 0"><b>Coverage, per project.</b> Each project that needs coverage gets its own ClickUp checklist when approved.
        Emergencies have no coverage. After changing the VA, save, then choose coverage for the new VA's projects.</p>
      ${coverageSelects(requester, coverableProjects(r, vaProjects), backups, r.coverage, history, r.id, r.backups_off || {})}
      <button>Save changes</button>
    </form></details>`;
}

// What still needs doing for a request, as short HTML lines.
function nextSteps(r) {
  const covered = r.kind !== 'emergency' ? r.coverage || [] : [];
  const where = (c) => (c.project_id ? ` for <b>${esc(c.client)}</b>` : '');
  if (r.status === 'pending') {
    return [
      'Approve or deny this request.',
      covered.length
        ? `Approving requests coverage and creates ${covered.length === 1 ? 'its ClickUp checklist' : `${covered.length} ClickUp checklists, one per project`}.`
        : `If ${esc(r.name)} needs coverage, choose it for each project under <b>Edit</b> before approving.`,
    ];
  }
  if (r.status !== 'approved') return [`Nothing to do: this request was ${esc(r.status)}.`];
  if (!covered.length) return ['Nothing to do. No coverage is needed.'];
  const steps = [];
  for (const c of covered) {
    if (!c.backup_name) steps.push(`Find a backup VA${where(c)}, then choose them under <b>Edit</b>.`);
    if (!c.clickup_list_url) steps.push(`Create the ClickUp checklist${where(c)} (it could not be created yet).`);
    else steps.push(`Work through the <a href="${esc(c.clickup_list_url)}" target="_blank" rel="noopener">ClickUp checklist</a>${where(c)}.`);
    if (c.sop && !c.sop.done) steps.push(`Ask ${esc(r.name)} to finish the <a href="/sops/${esc(encodeURIComponent(c.project_id))}">Coverage SOP</a>${where(c)} before the time off (now: ${esc(c.sop.label.toLowerCase())}).`);
    else if (c.sop && c.sop.key !== 'not_needed' && c.backup_name) steps.push(`Make sure ${esc(c.backup_name)} reads the <a href="/sops/${esc(encodeURIComponent(c.project_id))}">Coverage SOP</a>${where(c)}. If they log in to this app, it is on their Coverage SOPs page.`);
  }
  if (covered.every((c) => c.backup_name && !c.backup_off?.length)) steps.unshift('Coverage is confirmed: every project has a backup VA.');
  // A backup who is off during this time off can't cover it.
  for (const c of covered.filter((x) => x.backup_name && x.backup_off?.length).reverse()) {
    steps.unshift(`<b style="color:var(--bad)">${esc(c.backup_name)} is also off ${esc(offText(c.backup_off))}.</b> Choose another backup${where(c)} under <b>Edit</b>.`);
  }
  return steps;
}

// One request on its own page, with its next steps. The calendar links here.
export function requestPage({ user, request: r, vas, backups, vaProjects, history, message }) {
  const back = `/admin/time-off/${r.id}`;
  return layout({
    title: `${r.name} · ${KIND_LABEL[r.kind] || 'Time off'}`, user, active: '/admin/time-off', message,
    body: `<p class="lead"><a href="/admin/time-off">← All time off</a> · <a href="/admin/calendar?month=${esc(r.start_date.slice(0, 7))}">Calendar</a></p>
    ${section({ title: 'Next steps', open: true, tone: ['warn', 'bad'].includes(requestStatus(r)[1]) ? 'attention' : '',
      body: `<ul style="margin:0 8px 8px;padding-left:20px;line-height:1.7">${nextSteps(r).map((s) => `<li>${s}</li>`).join('')}</ul>` })}
    ${section({ title: 'Request', open: true, body: requestCards([r], true, { vas, backups, vaProjects, history, back, open: true }) })}`,
  });
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

// What's waiting for an admin across the app, as links. todo: counts from the /admin route.
function attentionCard(rows, todo) {
  if (!todo) return '';
  const late = rows.filter((r) => r.status.group === 'attention').length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const lines = [
    late && [`#group-attention`, plural(late, 'VA is late or not checked in', 'VAs are late or not checked in'), 'bad'],
    todo.pending && ['/admin/time-off', plural(todo.pending, 'time-off request is waiting for a decision', 'time-off requests are waiting for a decision'), 'warn'],
    todo.noBackup && ['/admin/time-off', plural(todo.noBackup, 'approved coverage still needs a backup VA', 'approved coverages still need a backup VA'), 'warn'],
    todo.noVa && ['/admin/projects', plural(todo.noVa, 'project has no VA', 'projects have no VA'), 'warn'],
    todo.lateTrainings && ['/admin/training', plural(todo.lateTrainings, 'training is past 7 workdays', 'trainings are past 7 workdays'), 'warn'],
    todo.sopsMissing && ['/admin/sops', plural(todo.sopsMissing, 'project has no Coverage SOP yet', 'projects have no Coverage SOP yet'), 'muted'],
  ].filter(Boolean);
  if (!lines.length) return `<div class="card attn-card done">${icon('check')} <b>All caught up.</b> Nothing is waiting for you.</div>`;
  return `<div class="card attn-card"><h2>Needs your attention</h2>${lines.map(([href, text, tone]) =>
    `<a class="attn ${tone}" href="${href}"><span class="dot"></span><span class="grow">${esc(text)}</span>${icon('chevron')}</a>`).join('')}</div>`;
}

export function adminTodayPage({ user, rows, week, todo, message, paused = false }) {
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
    body: `${paused ? pauseCard(true, '/admin') : ''}<div data-autorefresh>
      <p class="updated">Updates by itself every minute · last updated <span data-updated></span></p>
      ${attentionCard(rows, todo)}
      ${week ? weekCard(week) : ''}
      ${rows.length ? `<div class="summary-chips">${summary}</div>
      ${groups.filter(([g]) => by(g).length).map(([g, title, tone, open]) =>
        section({ title, count: by(g).length, open, tone, key: `group-${g}`, body: by(g).map(rowHtml).join('') })).join('')}`
      : `<div class="card">${empty('No active VAs yet. Add them on Team → VAs (VA Status Active, with an email).')}</div>`}
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
    title: 'History', user, active: '/admin/calendar',
    body: `${pageTabs(CALENDAR_TABS, '/admin/history')}<div class="card">
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

export function timeOffPage({ user, pending, current, recent, vas, unmatched, vaProjects, backups, allBackups = backups, history, clickupReady, formUrl, message }) {
  const ctx = { vas, backups, vaProjects, history };
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
      hint: 'It applies right away, without approval. Each project that needs coverage gets its own ClickUp checklist.',
      body: `<form method="post" action="/admin/time-off/add" style="padding:0 8px">
        <div class="row">
          <div><label for="pv">VA</label><select id="pv" name="user_id" required
            onchange="var va = this.value; this.form.querySelectorAll('[data-va]').forEach(function (g) { g.hidden = g.dataset.va !== va; })">
            <option value="">Choose a VA</option>${vas.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
          <div><label for="pk">Type</label><select id="pk" name="kind"><option value="time_off">Time off</option><option value="emergency">Emergency</option></select></div>
        </div>
        <div class="row">
          <div><label for="ps">First day</label><input id="ps" name="start_date" type="date" required></div>
          <div><label for="pe">Last day</label><input id="pe" name="end_date" type="date" required></div>
        </div>
        ${vas.map((v) => `<div data-va="${v.id}" hidden>
          <p class="small" style="margin:12px 0 0"><b>Coverage, per project</b> (not used for emergencies)</p>
          ${coverageSelects(v, coverableProjects({ user_id: v.id }, vaProjects), backups, [], history)}
        </div>`).join('')}
        <label for="pn">Note (optional)</label><input id="pn" name="note" type="text" maxlength="1000">
        <button>${icon('plus')} Add</button>
      </form>`,
    })}
    ${section({ title: 'Current and upcoming', count: current.length, open: true, body: requestCards(current.map((r) => ({ ...r, cancellable: true })), true, ctx) })}
    ${section({ title: 'Past, denied and cancelled', count: recent.length, open: false, body: requestCards(recent, true) })}
    ${section({
      title: 'Who can cover', count: backups.length, open: false,
      hint: 'Only ticked VAs appear in the "who covers" lists. Untick anyone who is not able or willing to cover. The list is every VA on Team → VAs with VA Status Active or On Deck; new VAs start ticked.',
      body: `<form method="post" action="/admin/time-off/backups" style="padding:0 8px">
        ${allBackups.map((b) => `<label class="check" style="margin-top:6px"><input type="checkbox" name="can_cover" value="${esc(b.zoho_id)}" ${b.hidden ? '' : 'checked'}> ${esc(b.name)} <span class="small">(${esc(b.status)})</span></label>`).join('') || empty('Nobody yet. VAs with VA Status Active or On Deck on Team → VAs appear here.')}
        <button>Save</button>
      </form>`,
    })}`,
  });
}

// ---- Logins (People page, and the Login box on a VA's record) ----

// The box shown once after a login invite or a temporary password (the password is never put in the address).
export function loginResult(tempPassword) {
  if (tempPassword && 'emailed' in tempPassword) {
    const where = [tempPassword.emailed && `email (${esc(tempPassword.email)})`, tempPassword.slacked && 'Slack'].filter(Boolean).join(' and ');
    return `<div class="toast ${where ? 'good' : 'bad'}" style="display:block">
      ${where ? `${icon('send')} Login invite sent to <strong>${esc(tempPassword.name)}</strong> by ${where}.` : `The invite for <strong>${esc(tempPassword.name)}</strong> could not be sent (see Settings, "Last email problem").`}<br>
      <span class="small">If they can't find it, their temporary password is <code style="font-size:15px">${esc(tempPassword.password)}</code>. It is not shown again.</span></div>`;
  }
  if (tempPassword) {
    return `<div class="toast info" style="display:block">Temporary password for <strong>${esc(tempPassword.name)}</strong>: <code style="font-size:16px">${esc(tempPassword.password)}</code><br>
       <span class="small">Share it with them privately. They choose their own password when they log in. It is not shown again.</span></div>`;
  }
  return '';
}

// "Has logged in", "Invited Oct 13", "Not invited yet" or "Temporary password". p.has_password or p.password_hash.
export const loginText = (p) => (!(p.password_hash || p.has_password) ? 'Not invited yet'
  : !p.must_change_password ? 'Has logged in'
  : p.invited_at ? `Invited ${formatDate(p.invited_at.slice(0, 10))}` : 'Temporary password');

// "Last login: Oct 13, 2026", from the last time they logged in with their password (recorded since 2026-10-13).
export const lastLoginText = (p) => (p.last_login_at ? `Last login: ${formatDate(p.last_login_at.slice(0, 10), true)}` : 'Last login: not recorded yet');

// The login buttons: send an invite, or just show a temporary password. base: "/admin/people/<id>" or
// "/admin/vas/<record id>/login".
export const loginButtons = (p, base) => `<form method="post" action="${base}/invite" data-confirm="${esc(`Send ${p.name} a login invite${p.slack_user_id ? ' by email and Slack' : ' by email'}? It includes a new temporary password, so any current password stops working.`)}"><button class="sm">${icon('send')} ${(p.password_hash || p.has_password) && !p.must_change_password ? 'Send new login invite' : 'Send login invite'}</button></form>
    <form method="post" action="${base}/temp-password" data-confirm="${esc(`Show a new temporary password for ${p.name} here, without sending it? Their current password stops working.`)}"><button class="sm plain">${icon('key')} Just show a temporary password</button></form>`;

// Whether the app checks this VA, why, and a button to exempt them or remove the exemption (form at base + "/exempt").
export function checkedInfo(p, base) {
  const affiliation = (p.affiliation || '').trim();
  const exempt = isExempt(p);
  const why = p.exempt ? 'Exempted by an admin'
    : !affiliation ? 'VA Company Affiliation is empty on their VA record'
    : affiliation !== 'InoVA Local' ? `VA Company Affiliation: ${affiliation}` : 'VA Company Affiliation: InoVA Local';
  const byAffiliation = affiliation !== 'InoVA Local';
  // VAs exempt because of their affiliation are changed on their VA record; the button only exempts (or un-exempts)
  // InoVA Local VAs.
  const button = byAffiliation && !p.exempt ? '<span class="small">To check this VA, change the VA Company Affiliation on their VA record (Team → VAs).</span>' : `
    <form method="post" action="${base}/exempt" data-confirm="${esc(p.exempt ? `Start checking ${p.name} again?` : `Stop checking ${p.name}? They won't get late alerts or appear in reports.`)}">
      <input type="hidden" name="exempt" value="${p.exempt ? 0 : 1}">
      <button class="sm plain">${p.exempt ? 'Remove exemption' : 'Exempt this VA'}</button>
    </form>`;
  return { chip: exempt ? chip('Exempt', !p.exempt && !affiliation ? 'warn' : 'muted') : chip('Checked', 'good'), why, button };
}

export function peoplePage({ user, people, onDeck = [], message, tempPassword }) {
  const vas = people.filter((p) => p.is_va);
  const admins = people.filter((p) => p.is_admin);
  const tempBox = loginResult(tempPassword);
  const resetBtn = (p) => loginButtons(p, `/admin/people/${p.id}`);
  const checked = (p) => checkedInfo(p, `/admin/people/${p.id}`);
  const recordLink = (id) => (id ? `<a class="btn sm plain" href="/admin/vas/${esc(id)}">${icon('va')} Open VA record</a>` : '');

  const vaRow = (p) => {
    const c = checked(p);
    const warnings = [
      !zoneFor(p.time_zone) && 'Time zone missing on their VA record (using EST)',
      !p.slack_channel_id && 'Slack Management ID missing on their VA record',
    ].filter(Boolean);
    return item({
      name: p.name, title: esc(p.name), sub: esc(p.project_list || 'No projects'), side: c.chip,
      body: `<p class="meta">${esc(p.email)} · ${esc(lastLoginText(p))}</p>
        <div class="chips">${chip(p.time_zone || 'No time zone', zoneFor(p.time_zone) ? 'muted' : 'warn')}${chip(p.availability || 'No availability', 'muted')}${chip(loginText(p), p.password_hash ? 'good' : 'muted')}</div>
        <p class="meta">${esc(c.why)}${p.slack_channel_id ? ` · Slack channel <code>${esc(p.slack_channel_id)}</code>` : ''}</p>
        ${warnings.map((w) => `<p class="meta" style="color:var(--warn)">${esc(w)}</p>`).join('')}
        ${p.record_id ? '' : '<p class="meta" style="color:var(--warn)">Not linked to a VA record</p>'}
        <div class="actions">${recordLink(p.record_id)}${c.button}${resetBtn(p)}</div>`,
    });
  };

  const onDeckRow = (p) => item({
    name: p.name, title: esc(p.name), sub: esc(p.email || 'No email on their VA record'), side: chip('On Deck', 'info'),
    body: `<div class="chips">${chip(p.time_zone || 'No time zone', 'muted')}${chip(p.availability || 'No availability', 'muted')}</div>
      <p class="meta">On Deck VAs don't check in. They can be chosen to cover when someone takes time off. To make them Active, change their VA Status on their VA record.</p>
      ${p.record_id ? `<div class="actions">${recordLink(p.record_id)}</div>` : ''}`,
  });

  const adminRow = (p) => item({
    name: p.name, title: esc(p.name), sub: esc(p.email), side: chip(loginText(p), p.password_hash ? 'good' : 'muted'),
    body: `<div class="actions">${resetBtn(p)}${p.id !== user.id ? `<form method="post" action="/admin/people/${p.id}/remove-admin" data-confirm="${esc(`Remove ${p.name} as an admin?`)}"><button class="sm danger">Remove admin</button></form>` : ''}</div>`,
  });

  return layout({
    title: 'People', user, active: '/admin/people', message,
    body: `${tempBox}
    <div class="card" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
      <p class="lead" style="margin:0;flex:1;min-width:240px">Everyone who can log in. VAs come from the VA records on Team → VAs: Active VAs with an email can log in, and On Deck VAs can cover. Open a VA's record to change their details or manage their login; admins are managed here.</p>
      <a class="btn" style="margin:0" href="/admin/vas">${icon('va')} Open VA records</a>
    </div>
    <label class="search" for="find-person">${icon('people')}<input id="find-person" type="search" placeholder="Search people" autocomplete="off" data-filter="#people .item" data-empty="#people-none"></label>
    <div id="people">
    ${section({ title: 'Active VAs', count: vas.length, open: true, body: vas.length ? vas.map(vaRow).join('') : empty('No active VAs yet.') })}
    ${section({ title: 'On Deck VAs', count: onDeck.length, open: true, body: onDeck.length ? onDeck.map(onDeckRow).join('') : empty('No On Deck VAs.') })}
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
    title: 'Holidays', user, active: '/admin/settings', message,
    body: `${pageTabs(SETTINGS_TABS, '/admin/holidays')}<p class="lead">No check-in is expected on these dates, so nobody gets late alerts.</p>
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

function pauseCard(paused, back) {
  return paused
    ? `<div class="card" style="border:2px solid var(--warn)"><h2>${icon('stop')} Check-ins are paused</h2>
        <p class="meta">No check-ins are expected, no late alerts are sent, no days count as missed, and the automatic weekly and monthly reports are not sent. VAs can still check in and log their time.</p>
        <form method="post" action="/admin/settings/pause" data-confirm="Resume check-ins? Late alerts start with the next shift that begins after now.">
          <input type="hidden" name="paused" value="0"><input type="hidden" name="back" value="${back}">
          <button>${icon('play')} Resume check-ins</button></form></div>`
    : `<form method="post" action="/admin/settings/pause" data-confirm="Pause all check-ins? No late alerts or reports will be sent until you resume.">
        <input type="hidden" name="paused" value="1"><input type="hidden" name="back" value="${back}">
        <button class="plain sm">${icon('stop')} Pause all check-ins</button></form>`;
}

export function settingsPage({ user, grace, emailError, admins, recipients, message, paused = false, timeCheck = 'Off' }) {
  return layout({
    title: 'Settings', user, active: '/admin/settings', message,
    body: `${pageTabs(SETTINGS_TABS, '/admin/settings')}${paused ? pauseCard(true, '/admin/settings') : ''}${section({
      title: 'Check-ins', open: false,
      hint: 'Pause everything while VAs are not using the app yet, or during a company break.',
      body: `<div style="padding:0 8px 8px">${paused ? '<p class="meta">Check-ins are paused (see above).</p>' : pauseCard(false, '/admin/settings')}
        <p class="meta">Daily time check (1 hour per project per workday): <b>${esc(timeCheck)}</b>. <a href="/admin/time/missed#time-check">Change it on Time → Missed time</a></p></div>`,
    })}
    ${section({
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

// Projects made in the app have ids "p-1", "p-2" ...; Zoho Projects ids are long numbers.
export const isAppProject = (p) => String(p?.id || '').startsWith('p-');

// Work-day toggles, Monday first. Each looks like a small pill that turns green when on.
export function dayBoxes(days) {
  const on = new Set((days ?? '1,2,3,4,5').split(','));
  return `<span class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) =>
    `<label><input type="checkbox" name="days" value="${d}" ${on.has(String(d)) ? 'checked' : ''}><span>${DAY_NAMES[d].slice(0, 2)}</span></label>`).join('')}</span>`;
}

export function projectsPage({ user, projects, assignments, vas, clients = [], message }) {
  const byProject = new Map(projects.map((p) => [p.id, []]));
  for (const a of assignments) byProject.get(a.project_id)?.push(a);
  // Coverage projects get their own section, with or without a VA (the backup may not use this app).
  const unassigned = projects.filter((p) => !byProject.get(p.id).length && !p.is_coverage);
  const assigned = projects.filter((p) => byProject.get(p.id).length && !p.is_coverage);
  const coverage = projects.filter((p) => p.is_coverage);
  const coverageIds = new Set(projects.filter((p) => p.is_coverage).map((p) => p.id));
  // Projects with no client that no admin has looked at yet ("No client" chosen on purpose doesn't count).
  const noClient = projects.filter((p) => !p.client_record_id && !p.client_set);

  // The client record of a project: matched by name while empty, or chosen here (then the sync leaves it alone).
  const clientForm = (p, prefix = 'cl') => {
    // A project made in the app keeps the client it was made with.
    if (isAppProject(p)) return `<p class="meta">Client: <b>${esc(p.client_name || p.client)}</b> (made in the app; the client can't change)</p>`;
    const note = p.client_set ? (p.client_record_id ? 'Chosen by an admin. The hourly sync won\'t change it.' : 'Set to "No client" by an admin. The hourly sync won\'t change it.')
      : p.client_record_id ? `Matched by name ("${p.client}"). Choose another client if this is wrong.`
      : `No client record is named "${p.client}". Choose the client, or "No client".`;
    return `<form method="post" action="/admin/projects/${esc(p.id)}/client" class="inline-form" style="padding:6px 0 10px">
       <label for="${prefix}-${esc(p.id)}" style="margin:0">Client</label>
      <select id="${prefix}-${esc(p.id)}" name="client_id"><option value="">No client</option>${clients.map((c) =>
        `<option value="${c.id}" ${c.id === p.client_record_id ? 'selected' : ''}>${esc(c.name)}${c.status && c.status !== 'Current' ? ` (${esc(c.status)})` : ''}</option>`).join('')}</select>
      <button class="sm plain">Save client</button>
      <span class="small" style="width:100%">${esc(note)}</span></form>`;
  };
  const clientChip = (p) => (p.client_record_id ? '' : chip('No client', p.client_set ? 'muted' : 'warn'));

  // The time zone for a start time. "" means the VA's own zone (from their VA record).
  const zoneSelect = (selected, vaZone) => `<select name="time_zone" aria-label="Time zone">
    <option value="">${vaZone ? `VA's zone (${esc(vaZone)})` : "VA's zone"}</option>
    ${['PST', 'MST', 'CST', 'EST'].map((z) => `<option value="${z}" ${z === selected ? 'selected' : ''}>${z}</option>`).join('')}</select>`;
  const vaZoneOf = (a) => (zoneFor(a.va_zone) ? a.va_zone : 'EST');
  const zoneOf = (a) => (zoneFor(a.time_zone) ? a.time_zone : vaZoneOf(a));

  const assignmentRow = (a) => `
    <div class="assign">
      <form method="post" action="/admin/assignments/${a.id}" class="assign" style="border:0;padding:0;flex:1">
        <span class="who">${avatar(a.va_name)}${esc(a.va_name)}</span>
        <input type="time" name="start_time" value="${esc(a.start_time || '')}" aria-label="Start time">
        ${zoneSelect(zoneFor(a.time_zone) ? a.time_zone : '', vaZoneOf(a))}
        ${coverageIds.has(a.project_id)
          ? `${a.days.split(',').map((d) => `<input type="hidden" name="days" value="${esc(d)}">`).join('')}<span class="small">Only on days they cover this client</span>`
          : dayBoxes(a.days)}
        <button class="sm" style="margin:0">Save</button>
      </form>
      <form method="post" action="/admin/assignments/${a.id}/delete" data-confirm="${esc(`Take ${a.va_name} off this project?`)}"><button class="sm danger" style="margin:0">Remove</button></form>
      ${parseHHMM(a.start_time) ? '' : `<div style="width:100%">${chip('No start time: no check-in or late alerts for this project', 'warn')}</div>`}
    </div>`;

  const addForm = (p) => `
    <details class="section" style="margin:10px 0 0;box-shadow:none;background:var(--surface-2)"><summary>${icon('plus')} Add a VA${icon('chevron', 'chev')}</summary>
      <form method="post" action="/admin/projects/${esc(p.id)}/assign" class="assign" style="border:0;padding:0 16px 14px">
        <select name="user_id" required aria-label="VA"><option value="">Choose a VA</option>${vas.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
        <input type="time" name="start_time" aria-label="Start time">
        ${zoneSelect('', '')}
        ${dayBoxes()}
        <button class="sm" style="margin:0">Add</button>
      </form>
    </details>`;

  const projectRow = (p, open = false) => {
    const list = byProject.get(p.id);
    const missingTime = list.some((a) => !parseHHMM(a.start_time));
    const who = list.map((a) => `${esc(a.va_name)}${parseHHMM(a.start_time) ? ` · ${esc(formatHM(parseHHMM(a.start_time)))} ${esc(zoneOf(a))}` : ''}`).join(', ');
    return item({
      name: p.client_name || p.client, title: `${esc(p.client_name || p.client)}${p.is_coverage ? ` ${chip('Coverage', 'info')}` : ''}`, sub: esc(who || 'No VA assigned'),
      side: `<span class="chips side-chips stack">${clientChip(p)}${!list.length ? chip('No VA', 'warn') : missingTime ? chip('Needs a start time', 'warn') : chip(`${list.length} VA${list.length > 1 ? 's' : ''}`, 'good')}</span>`,
      open,
      body: `<p class="meta">${esc(p.name)}${isAppProject(p) ? ` ${chip('Made in the app', 'info')}` : ''}</p>
        <p style="margin:0 0 6px"><a class="btn plain sm" style="margin:0" href="/admin/projects/${esc(p.id)}">${icon('edit')} Project settings: time zone, package, billing day</a></p>
        ${clientForm(p)}${list.map(assignmentRow).join('')}${addForm(p)}`,
    });
  };

  return layout({
    title: 'Projects', user, active: '/admin/projects', message,
    body: `<div class="card" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
      <p class="lead" style="margin:0;flex:1;min-width:240px">Projects are made here (<b>New project</b>), or come from Zoho Projects every hour and go to the VA named after the " - " in the project name. Each Zoho project belongs to the client record with the name before the " - ", or the client chosen here. A VA with several projects checks in once a day, by the earliest start.</p>
      <form method="post" action="/admin/sync"><input type="hidden" name="back" value="/admin/projects"><button style="margin:0">${icon('sync')} Sync with Zoho now</button></form>
    </div>
    ${section({
      title: 'New project', open: message === 'project-missing', key: 'new-project',
      hint: "The client can't be changed later. The time zone, billing day and package are set on the project's page next.",
      body: `<form method="post" action="/admin/projects/new" style="padding:0 8px 8px">
        <div class="row">
          <div><label for="np-client">Client</label><select id="np-client" name="client_id" required><option value="">Choose a client</option>${clients.filter((c) => c.status !== 'Offboarded').map((c) =>
            `<option value="${c.id}">${esc(c.name)}${c.status && c.status !== 'Current' ? ` (${esc(c.status)})` : ''}</option>`).join('')}</select></div>
          <div><label for="np-va">VA</label><select id="np-va" name="user_id"><option value="">No VA yet</option>${vas.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
        </div>
        <label for="np-name">Project name</label><input type="text" id="np-name" name="name" maxlength="120" placeholder="Empty = &quot;Client - VA&quot;">
        <label class="check"><input type="checkbox" name="coverage" value="1"> Coverage project (a backup VA covers this client; the name ends in " - Coverage")</label>
        <label>Start time and work days of the VA</label>
        <div class="assign" style="border:0;padding:0"><input type="time" name="start_time" aria-label="Start time">${zoneSelect('', '')}${dayBoxes()}</div>
        <button>${icon('plus')} Create project</button></form>`,
    })}
    <label class="search" for="find-project">${icon('projects')}<input id="find-project" type="search" placeholder="Search projects or VAs" autocomplete="off" data-filter="#projects-list .item" data-empty="#projects-none"></label>
    <div id="projects-list">
    ${noClient.length ? section({
      title: 'Projects with no client', count: noClient.length, open: true, tone: 'attention', key: 'no-client',
      hint: 'No client record matched the name of these projects, so they don\'t show on a client\'s page. Choose the client of each one (or "No client" if it has none).',
      body: noClient.map((p) => item({ name: p.client, title: esc(p.client), sub: esc(p.name), side: chip('No client', 'warn'), body: clientForm(p, 'nc') })).join(''),
    }) : ''}
    ${unassigned.length ? section({
      title: 'Projects with no VA', count: unassigned.length, open: true, tone: 'attention',
      hint: 'No active VA matched the name in these projects. Open one to add a VA if someone should check in for it.',
      body: unassigned.map((p) => projectRow(p)).join(''),
    }) : ''}
    ${section({ title: 'Projects', count: assigned.length, open: true, body: assigned.length ? assigned.map((p) => projectRow(p)).join('') : empty('No projects yet. Click "Sync with Zoho now".') })}
    ${coverage.length ? section({
      title: 'Coverage projects', count: coverage.length, open: false, key: 'coverage-projects',
      hint: 'Named "Client - VA - Coverage" in Zoho Projects. The backup VA logs coverage time there. They need no Coverage SOP, and count for check-ins only on days that VA is the approved backup for the client. Their start time is copied from the regular VA of the client when the project first appears.',
      body: coverage.map((p) => projectRow(p)).join(''),
    }) : ''}
    </div><div id="projects-none" class="card empty no-results">No project matches your search.</div>`,
  });
}

// ---- Calendar page ----

// events: [{ date, name, kind, status, coverage, backup, id }] (click one to open its request); holidays: [{ date, name }].
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
  // For example "Maria Cabatas: Time off (Coverage requested), coverage: Rise & Shine: needs a backup".
  const label = (e) => {
    const status = e.status === 'pending' ? 'waiting for a decision' : requestStatus(e)[0];
    return `${e.name}: ${e.kind === 'emergency' ? 'Emergency' : 'Time off'}${status === 'Approved' ? '' : ` (${status})`}${e.backup ? `, coverage: ${e.backup}` : ''}`;
  };
  const needsBackup = (e) => e.coverage.some((c) => !c.backup_name);
  const evHtml = (e) => `<a class="ev ${e.status === 'pending' ? 'pending' : e.kind}" href="/admin/time-off/${e.id}" title="${esc(label(e))}">${esc(short(e.name))}${e.backup ? (needsBackup(e) ? ' ⚠' : ' ⇄') : ''}</a>`;

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
    sub: [holidayOn.has(d) && `🎉 ${esc(holidayOn.get(d))}`, ...(byDate.get(d) || []).map((e) => `<a href="/admin/time-off/${e.id}">${esc(label(e))}</a>`)].filter(Boolean).join('<br>'),
  })).join('') : empty('Nobody is off this month.')}</div>`;

  const legend = `<div class="legend"><span><span class="ev time_off" style="display:inline-block">Name</span> Time off</span>
    <span><span class="ev emergency" style="display:inline-block">Name</span> Emergency</span>
    <span><span class="ev pending" style="display:inline-block">Name</span> Waiting for a decision</span>
    <span>⇄ coverage confirmed</span><span>⚠ needs a backup</span><span><span class="ev holiday" style="display:inline-block">Holiday</span></span></div>`;

  return layout({
    title: 'Calendar', user, active: '/admin/calendar', message,
    body: `${pageTabs(CALENDAR_TABS, '/admin/calendar')}<div class="card">
      <div class="row" style="align-items:center">
        <div><a class="btn plain" href="/admin/calendar?month=${prev}" style="margin:0">← Earlier</a></div>
        <div style="text-align:center;font-weight:800;font-size:18px">${esc(monthName)}</div>
        <div style="text-align:right"><a class="btn plain" href="/admin/calendar?month=${next}" style="margin:0">Later →</a></div>
      </div>
      ${legend}${grid}${list}
      <p class="small">Click a name to see all the details and next steps. Point at a name for a quick summary.</p>
    </div>`,
  });
}

// ---- Coverage SOPs ----

const sopHref = (id) => `/sops/${esc(encodeURIComponent(id))}`;
const FILE_ACCEPT = '.pdf,.doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.ods,.png,.jpg,.jpeg';
const fileSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const savedOn = (iso) => (iso ? `last saved ${formatDate(iso.slice(0, 10))}` : '');

// The VA's projects and whether each has its Coverage SOP, plus the SOPs of clients they are covering.
export function vaSopsPage({ user, sops, covering = [], message }) {
  const todo = sops.filter((s) => !s.status.done);
  const done = sops.filter((s) => s.status.done);
  const row = (s) => item({
    title: esc(s.client),
    sub: s.status.key === 'not_needed' ? 'An admin decided this project does not need one.'
      : esc([s.file_name ? `File: ${s.file_name}` : '', savedOn(s.updated_at)].filter(Boolean).join(' · ')),
    side: chip(s.status.label, s.status.tone),
    tone: 'stack',
    open: !s.status.done,
    body: `<div class="actions">
      <a class="btn sm" href="${sopHref(s.id)}">${icon('doc')} ${s.has_content ? 'Open my SOP' : 'Fill in the template'}</a>
      <a class="btn sm plain" href="${sopHref(s.id)}#upload">${icon('upload')} ${s.file_key ? 'Replace my file' : 'Upload my own'}</a>
      ${s.file_key ? `<a class="btn sm plain" href="${sopHref(s.id)}/file" target="_blank" rel="noopener">${icon('external')} Open my file</a>` : ''}
    </div>`,
  });
  const coverRow = (c) => {
    const readable = c.has_content || c.file_key;
    return item({
      title: `${esc(c.client)} · for ${esc(c.va_name)}`,
      sub: esc(dateRange(c.start_date, c.end_date)),
      side: chip(readable ? 'SOP ready' : 'No SOP yet', readable ? 'good' : 'warn'),
      tone: 'stack',
      open: true,
      body: readable
        ? `<div class="actions">${c.has_content ? `<a class="btn sm" href="${sopHref(c.id)}">${icon('doc')} Read the SOP</a>` : ''}
            ${c.file_key ? `<a class="btn sm plain" href="${sopHref(c.id)}/file" target="_blank" rel="noopener">${icon('external')} Open the file</a>` : ''}</div>`
        : `<p class="meta">${esc(c.va_name)} has not written it yet. Ask them or the VA lead for the steps.</p>`,
    });
  };
  return layout({
    title: 'Coverage SOPs', user, active: '/va/sops', message,
    body: `<p class="lead">For each client, fill in the template or upload your own file. A backup VA follows it when you are off.</p>
    ${!sops.length ? section({ title: 'My clients', body: empty('You have no projects yet, so there is nothing to do.') }) : ''}
    ${todo.length ? section({ title: 'Still to do', count: todo.length, tone: 'attention', body: todo.map(row).join('') }) : ''}
    ${sops.length && !todo.length ? `<div class="toast good" style="animation:none">${icon('check')} All your Coverage SOPs are done. Thank you! You can update them any time.</div>` : ''}
    ${done.length ? section({ title: 'Done', count: done.length, open: !todo.length, body: done.map(row).join('') }) : ''}
    ${covering.length ? section({
      title: 'Clients you are covering', count: covering.length,
      hint: 'You are the backup for these. Read their SOP before the time off starts.',
      body: covering.map(coverRow).join(''),
    }) : ''}`,
  });
}

// The page for one project's SOP: upload a file, or fill in the template (sections of tables).
// kinds: KINDS from sops.js. readOnly: a backup VA reading it.
export function sopEditPage({ user, project, sop, status, content, kinds, readOnly = false, vas, message }) {
  const here = sopHref(project.id);
  const vaOnly = user.is_va && !user.is_admin;
  const done = Boolean(sop?.completed_at);
  // The SOP as JSON for the script. "<" is escaped so the text can't end the script early.
  const data = JSON.stringify({ content, kinds, readOnly }).replace(/</g, '\\u003c');
  const fileLine = sop?.file_key
    ? `<p class="meta"><a href="${here}/file" target="_blank" rel="noopener">${icon('external')} ${esc(sop.file_name)}</a>
        · ${esc(fileSize(sop.file_size || 0))} · uploaded ${esc(formatDate(sop.uploaded_at.slice(0, 10)))}</p>`
    : '';
  const upload = readOnly ? fileLine || empty('No file uploaded.') : `${fileLine}
    <form method="post" action="${here}/upload" enctype="multipart/form-data">
      <label for="sop-file">${sop?.file_key ? 'Replace it with another file' : 'Choose your file'}</label>
      <input id="sop-file" type="file" name="file" accept="${FILE_ACCEPT}" required>
      <p class="small">PDF, Word, Excel, text or a picture, up to 15 MB. Uploading a file marks this SOP as done.</p>
      <div class="actions"><button class="sm">${icon('upload')} Upload</button></div>
    </form>
    ${sop?.file_key ? `<form method="post" action="${here}/remove-file" class="actions" data-confirm="Remove this file? It can't be brought back."><button class="sm danger">Remove the file</button></form>` : ''}`;
  const tips = `<details class="sop-tips" ${sop?.content ? '' : 'open'}><summary>Tips for writing it</summary>
    <ul class="small">
    <li>Write it for someone who has never worked with this client: every step, in order, with where to click.</li>
    <li>Add the start and end times of the day, with the time zone.</li>
    <li>Rename, move or remove any section, and add your own (for example "Emergency protocol" or "Handling tough situations").</li>
    <li>Passwords are hidden on screen; press Show to see one. Only admins, this project's VAs, and a backup VA covering it can open this SOP.</li>
    <li>Save as often as you like (Ctrl+S works too). Press "Save and mark complete" when it is finished.</li></ul></details>`;
  const buttons = readOnly ? '' : `<div class="sop-save">
      ${done ? `<button name="complete" value="1" data-quick="1">${icon('check')} Save changes</button>`
        : `<button name="complete" value="0" class="plain" data-quick="1">Save</button><button name="complete" value="1">${icon('check')} Save and mark complete</button>`}
      <span class="sop-note small" role="status" aria-live="polite"></span>
    </div>`;
  const editor = readOnly && !sop?.content
    ? empty('Not filled in in the app.')
    : `<form method="post" action="${here}/save" id="sop-form">
          <input type="hidden" name="content">
          <div id="sop-editor" class="sop"><p class="small">Loading…</p></div>
          ${buttons}
        </form>`;
  const who = vaOnly ? '' : vas.length ? `VA: ${esc(vas.join(', '))} · ` : '';
  return layout({
    title: `Coverage SOP · ${project.client}`, user, active: vaOnly ? '/va/sops' : '/admin/sops', message,
    body: `<p class="lead"><a href="${vaOnly ? '/va/sops' : '/admin/sops'}">← All Coverage SOPs</a></p>
    <p class="lead sop-status">${chip(status.label, status.tone)} <span>${who}${esc(savedOn(sop?.updated_at) || 'not saved yet')}</span></p>
    ${readOnly ? `<p class="lead">You are the backup VA for this client. This SOP was written by ${esc(vas.join(', ') || 'their VA')}; only they or an admin can change it.</p>`
      : '<p class="lead">Upload your own file <b>or</b> fill in the template below. Either one counts.</p>'}
    ${readOnly && !sop?.file_key ? '' : `<div id="upload">${section({ title: readOnly ? 'Uploaded file' : 'Upload your own SOP', open: Boolean(sop?.file_key) || readOnly, body: `<div style="padding:0 8px 8px">${upload}</div>` })}</div>`}
    ${section({
      title: readOnly ? 'SOP' : 'Fill in the template', tone: 'sop-section', open: !sop?.file_key || Boolean(sop?.content),
      body: `<div style="padding:0 8px 8px">${readOnly ? '' : tips}${editor}</div>`,
    })}
    <script type="application/json" id="sop-data">${data}</script>
    <style>${SOP_CSS}</style>
    <script>${SOP_SCRIPT}</script>`,
  });
}

const SOP_CSS = `
/* Lets the Save buttons stay in view while scrolling. */
.section.sop-section{overflow:visible}
.sop-status{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:-8px}
.sop-tips{margin:0 0 12px}.sop-tips>summary{cursor:pointer;font-weight:700;font-size:14px;color:var(--brand);padding:2px 0}
.sop-tips ul{margin:6px 0 0;padding-left:20px;line-height:1.7}
.sop-sec{border:1.5px solid var(--line);border-radius:14px;padding:12px;margin:0 0 14px;background:var(--surface)}
.sop-top{display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap}.sop-top .sop-title{flex:1 1 220px;min-width:0;font-weight:800;font-size:15px}
.sop-top button{margin:0;flex:none}
.sop-sec h3{margin:0 0 8px;font-size:16px}
.sop-kind{font-size:12px;color:var(--muted);margin:4px 2px 8px}
.sop-head,.sop-row{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr)) 34px;gap:6px;align-items:start}
.sop.ro .sop-head,.sop.ro .sop-row{grid-template-columns:repeat(var(--cols),minmax(0,1fr))}
.sop-head{font-size:13px;font-weight:800;color:var(--muted);padding:0 2px 4px}
.sop-row{padding:4px 0;position:relative}.sop-row+.sop-row{border-top:1px dashed var(--line)}
.sop textarea{min-height:42px;resize:none;overflow:hidden;padding:8px 10px;font-size:14px}
.sop .sop-cell label{display:none;margin:0 0 2px;font-size:12px;color:var(--muted)}
.sop .pw{display:flex;gap:4px;align-items:center}.sop .pw input{padding:8px 10px;font-size:14px}.sop .pw button{margin:0;padding:6px 10px;flex:none}
.sop .rotext{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;padding:6px 2px}
.sop .x{margin:4px 0 0;padding:6px;width:34px;height:34px;justify-content:center;background:transparent;color:var(--muted)}
.sop .x:hover{color:var(--bad)}.sop .add-row{margin-top:8px}
.sop-add{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 4px}.sop-add select{width:auto}.sop-add button{margin:0}
.sop-save{position:sticky;bottom:12px;z-index:3;display:flex;align-items:center;gap:8px;margin-top:14px;background:var(--surface);padding:8px;
  border:1.5px solid var(--line);border-radius:99px;box-shadow:0 4px 18px rgba(0,0,0,.18);width:max-content;max-width:100%}
.sop-save button{margin:0;white-space:nowrap}.sop-note{padding:0 8px 0 4px}.sop-note.bad{background:none;color:var(--bad);font-weight:700}
@media (max-width:860px){.sop-head{display:none}.sop-row,.sop.ro .sop-row{grid-template-columns:1fr;gap:4px;padding:8px 0}.sop .sop-cell label{display:block}
  .sop .x{position:absolute;top:0;right:-6px;margin:0;width:44px;height:44px;min-height:44px}
  .sop-top{justify-content:flex-end}.sop-top .sop-title{flex-basis:100%}.sop-top button{min-width:44px;justify-content:center}
  .sop-save{bottom:76px;width:100%;border-radius:16px;flex-wrap:wrap}.sop-save button{flex:1;justify-content:center;padding:10px 8px}
  .sop-note:empty{display:none}.sop-note{flex-basis:100%;text-align:center;padding:0}}
`;

// Builds the editor from the JSON in #sop-data. "Save" sends the SOP in the background and says
// "Saved"; "Save and mark complete" reloads the page to show the new status.
// Text is set with .value and .textContent, never as HTML.
const SOP_SCRIPT = `
(function () {
  // "Upload my own" links here: open the upload section.
  if (location.hash === '#upload') { var up = document.querySelector('#upload details'); if (up) up.open = true; }
  var root = document.getElementById('sop-editor');
  if (!root) return;
  var data = JSON.parse(document.getElementById('sop-data').textContent);
  var kinds = data.kinds, ro = data.readOnly;
  var form = document.getElementById('sop-form'), note = document.querySelector('.sop-note'), dirty = false;
  var HIDDEN = '\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022';
  if (ro) root.classList.add('ro');
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    for (var k in props || {}) {
      if (k === 'text') e.textContent = props[k];
      else if (k === 'className' || k === 'value' || k === 'type') e[k] = props[k];
      else e.setAttribute(k, props[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function changed() { dirty = true; if (note) { note.textContent = ''; note.className = 'sop-note small'; } }
  function grow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 3) + 'px'; }
  function button(text, title, onclick, cls) {
    var b = el('button', { type: 'button', className: 'sm plain ' + (cls || ''), text: text, title: title, 'aria-label': title });
    b.addEventListener('click', function () { onclick(); changed(); });
    return b;
  }
  function showButton(onToggle) {
    var b = el('button', { type: 'button', className: 'sm plain', text: 'Show' });
    b.addEventListener('click', function () { var on = b.textContent === 'Show'; onToggle(on); b.textContent = on ? 'Hide' : 'Show'; });
    return b;
  }
  function textBox(value, label, max, cls) {
    var t = el('textarea', { value: value, rows: '1', 'aria-label': label, maxlength: String(max), className: cls || '' });
    t.addEventListener('input', function () { grow(t); });
    return t;
  }
  function field(value, column) {
    if (column === 'Password') {
      if (ro) {
        if (!value) return el('div', { className: 'rotext', text: '-' });
        var shown = el('span', { className: 'rotext', text: HIDDEN });
        return el('div', { className: 'pw' }, [shown, showButton(function (on) { shown.textContent = on ? value : HIDDEN; })]);
      }
      var input = el('input', { type: 'password', value: value, autocomplete: 'off', 'data-lpignore': 'true', 'aria-label': column, maxlength: '5000' });
      return el('div', { className: 'pw' }, [input, showButton(function (on) { input.type = on ? 'text' : 'password'; })]);
    }
    return ro ? el('div', { className: 'rotext', text: value || '-' }) : textBox(value, column, 5000);
  }
  function addRow(sec, cells, body) {
    var cols = kinds[sec.dataset.kind].columns;
    var row = el('div', { className: 'sop-row' }, cols.map(function (c, i) {
      return el('div', { className: 'sop-cell' }, [el('label', { text: c }), field(cells[i] || '', c)]);
    }));
    if (!ro) row.appendChild(button('\\u00d7', 'Remove this row', function () {
      var typed = Array.prototype.some.call(row.querySelectorAll('textarea,input'), function (f) { return f.value.trim(); });
      if (!typed || confirm('Remove this row?')) row.remove();
    }, 'x'));
    body.appendChild(row);
    row.querySelectorAll('textarea').forEach(grow);
    return row;
  }
  function sectionEl(s) {
    var kind = kinds[s.kind];
    var sec = el('div', { className: 'sop-sec' });
    sec.dataset.kind = s.kind;
    root.appendChild(sec);
    if (ro) sec.appendChild(el('h3', { text: s.title || kind.label }));
    else {
      var title = textBox(s.title || '', 'Section name', 200, 'sop-title');
      title.placeholder = 'Section name';
      sec.appendChild(el('div', { className: 'sop-top' }, [title,
        button('\\u2191', 'Move this section up', function () { if (sec.previousElementSibling) { root.insertBefore(sec, sec.previousElementSibling); sec.scrollIntoView({ block: 'nearest' }); } }),
        button('\\u2193', 'Move this section down', function () { var n = sec.nextElementSibling; if (n) { root.insertBefore(n, sec); sec.scrollIntoView({ block: 'nearest' }); } }),
        button('Remove', 'Remove this section', function () {
          if (confirm('Remove the section "' + (title.value || kind.label) + '" and everything in it?')) sec.remove();
        }, 'danger')]));
      sec.appendChild(el('div', { className: 'sop-kind', text: kind.label }));
    }
    if (s.kind === 'text') {
      if (ro) sec.appendChild(el('div', { className: 'rotext', text: s.text || '-' }));
      else { var t = textBox(s.text || '', s.title || 'Text', 20000, 'sop-text'); t.style.minHeight = '120px'; sec.appendChild(t); grow(t); }
      return sec;
    }
    sec.style.setProperty('--cols', kind.columns.length);
    sec.appendChild(el('div', { className: 'sop-head' }, kind.columns.map(function (c) { return el('div', { text: c }); })));
    var body = el('div', { className: 'sop-rows' });
    sec.appendChild(body);
    (s.rows || []).forEach(function (r) { addRow(sec, r, body); });
    if (ro && !(s.rows || []).length) body.appendChild(el('p', { className: 'small', text: 'Nothing here.' }));
    if (!ro) sec.appendChild(button('+ Add a row', 'Add a row', function () {
      var f = addRow(sec, [], body).querySelector('textarea,input'); if (f) f.focus();
    }, 'add-row'));
    return sec;
  }
  root.textContent = '';
  data.content.sections.forEach(function (s) { if (kinds[s.kind]) sectionEl(s); });
  // Boxes in closed sections have no size yet; size them when the section opens.
  var holder = root.closest('details');
  function regrow() { root.querySelectorAll('textarea').forEach(grow); }
  if (holder) holder.addEventListener('toggle', regrow);
  // Also after the font loads, and when the window changes size, since both change how text wraps.
  if (document.fonts) document.fonts.ready.then(regrow);
  var resizing; window.addEventListener('resize', function () { clearTimeout(resizing); resizing = setTimeout(regrow, 150); });
  if (ro) return;

  // Adding a section of the chosen kind at the end.
  var pick = el('select', { 'aria-label': 'Kind of section' }, Object.keys(kinds).map(function (k) { return el('option', { value: k, text: kinds[k].label }); }));
  root.after(el('div', { className: 'sop-add' }, [el('span', { className: 'small', text: 'Add a section:' }), pick,
    button('+ Add section', 'Add a section', function () {
      var k = pick.value, s = { kind: k, title: '', text: '', rows: k === 'text' ? [] : [kinds[k].columns.map(function () { return ''; })] };
      var sec = sectionEl(s); sec.scrollIntoView({ block: 'center' }); sec.querySelector('.sop-title').focus();
    })]));
  root.addEventListener('input', changed);
  // Enter in a section name or a password should not save the form or start a new line.
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || e.target.classList.contains('sop-title'))) e.preventDefault();
  });
  // Ctrl+S (Cmd+S on a Mac) saves.
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); form.querySelector('[data-quick]').click(); }
  });

  // Reads the page back into { sections: [...] }.
  function collect() {
    return JSON.stringify({ sections: Array.prototype.map.call(root.querySelectorAll('.sop-sec'), function (sec) {
      var kind = sec.dataset.kind, title = sec.querySelector('.sop-title').value;
      if (kind === 'text') return { kind: kind, title: title, text: sec.querySelector('.sop-text').value };
      return { kind: kind, title: title, rows: Array.prototype.map.call(sec.querySelectorAll('.sop-row'), function (row) {
        return Array.prototype.map.call(row.querySelectorAll('.sop-cell textarea, .sop-cell input'), function (f) { return f.value; });
      }) };
    }) });
  }
  function say(text, bad) { note.textContent = text; note.className = 'sop-note small' + (bad ? ' bad' : ''); }
  function done(button) { delete form.dataset.busy; button.classList.remove('busy'); }
  form.addEventListener('submit', function (e) {
    form.elements.content.value = collect();
    var button = e.submitter;
    if (!button || !button.dataset.quick || !window.fetch) { dirty = false; return; }
    // Quick save: stay on the page.
    e.preventDefault();
    var body = new URLSearchParams(new FormData(form));
    body.set('complete', button.value);
    var sent = form.elements.content.value;
    fetch(form.action, { method: 'POST', body: body, credentials: 'same-origin' }).then(function (r) {
      var msg = new URL(r.url).searchParams.get('msg');
      done(button);
      if (r.ok && (msg === 'sop-draft' || msg === 'saved')) {
        if (collect() === sent) dirty = false;
        say('Saved at ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      } else if (r.url.indexOf('/login') !== -1) {
        say('Not saved: your login ended. Log in again in a new tab, then press Save here again.', true);
      } else if (msg === 'sop-empty') {
        say('Saved. Fill in your steps before marking it complete.', true); dirty = false;
      } else say('Not saved. Please try again.', true);
    }).catch(function () { done(button); say('Not saved: no connection. Please try again.', true); });
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
})();
`;

// Admins: every active project with a VA, and whether its Coverage SOP is done.
export function adminSopsPage({ user, sops, message }) {
  const todo = sops.filter((s) => !s.status.done);
  const done = sops.filter((s) => s.status.done);
  const count = (key) => sops.filter((s) => s.status.key === key).length;
  const row = (s) => item({
    name: s.client,
    title: esc(s.client),
    sub: `${esc(s.va_names || 'No VA')}${s.updated_at ? ` · last saved ${esc(formatDate(s.updated_at.slice(0, 10)))}${s.updated_by_name ? ` by ${esc(s.updated_by_name)}` : ''}` : ''}`,
    side: chip(s.status.label, s.status.tone),
    tone: 'stack',
    body: `<p class="meta">${esc(s.name)}${s.file_name ? ` · File: ${esc(s.file_name)}` : ''}</p>
      <div class="actions">
        <a class="btn sm" href="${sopHref(s.id)}">${icon('doc')} Open</a>
        ${s.file_key ? `<a class="btn sm plain" href="${sopHref(s.id)}/file" target="_blank" rel="noopener">${icon('external')} Open the file</a>` : ''}
        <form method="post" action="/admin/sops/${esc(encodeURIComponent(s.id))}/needed">
          <input type="hidden" name="not_needed" value="${s.not_needed ? '0' : '1'}">
          <button class="sm plain">${s.not_needed ? 'It needs an SOP after all' : 'Mark as not needed'}</button>
        </form>
      </div>`,
  });
  return layout({
    title: 'Coverage SOPs', user, active: '/admin/sops', message,
    body: `<p class="lead">One SOP per project. A filled-in template or an uploaded file both count as done.</p>
    <div class="summary-chips">${chip(`${done.length - count('not_needed')} done`, 'good')}${chip(`${count('draft')} started`, 'warn')}${chip(`${count('missing')} not started`, 'bad')}${count('not_needed') ? chip(`${count('not_needed')} not needed`, 'muted') : ''}</div>
    <label class="search" for="find-sop">${icon('projects')}<input id="find-sop" type="search" placeholder="Search clients or VAs" autocomplete="off" data-filter="#sop-list .item" data-empty="#sop-none"></label>
    <div id="sop-list">
    ${section({ title: 'Not done yet', count: todo.length, tone: todo.length ? 'attention' : '', body: todo.length ? todo.map(row).join('') : empty('Every project has its SOP.') })}
    ${section({ title: 'Done', count: done.length, open: !todo.length, body: done.length ? done.map(row).join('') : empty('None yet.') })}
    </div><div class="empty no-results" id="sop-none">No projects match.</div>`,
  });
}

// ---- Shared by the record pages ----

export const zohoTime = (iso) => `${new Date(iso).toLocaleString('en-US', {
  timeZone: REPORT_ZONE, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
})} ET`;

export const mailLink = (email) => `<a href="mailto:${esc(email)}">${esc(email)}</a>`;
export const phoneLink = (phone) => `<a href="tel:${esc(String(phone).replace(/[^\d+]/g, ''))}">${esc(phone)}</a>`;
