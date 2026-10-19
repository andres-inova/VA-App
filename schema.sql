-- Database tables for the InoVA Local VA app.

-- Everyone who can log in. A person can be an admin, a VA, or both.
-- A VA's login is linked to their VA record (record_id); name, email, time zone, availability, Slack IDs and
-- affiliation are copied from it whenever it changes (see applyVaRecords in src/zoho.js).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_va INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  invited_at TEXT,       -- when a login invite was last sent
  notify_time_off INTEGER NOT NULL DEFAULT 1,  -- admins only: email me about new time-off requests
  zoho_id TEXT,          -- the VA's key: their old Zoho CRM id, or "app-<record id>" for VAs added in the app
  time_zone TEXT,        -- PST, MST, CST or EST (from the VA record)
  availability TEXT,     -- for example "9am - 5pm" (from the VA record)
  start_override TEXT,   -- UNUSED (an old per-VA start time; start times are now per project assignment)
  slack_channel_id TEXT, -- VA's management channel ("Slack Management ID" on the VA record)
  slack_user_id TEXT,    -- VA's own Slack user ID ("Slack ID" on the VA record), used to tag them
  affiliation TEXT,      -- "VA Company Affiliation" on the VA record; only "InoVA Local" VAs are checked
  exempt INTEGER NOT NULL DEFAULT 0,  -- 1 = an admin exempted this VA from check-ins
  zoho_projects_user_id TEXT,  -- the VA's user ID in Zoho Projects (for time logs)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  record_id INTEGER REFERENCES records(id),  -- the VA record this login belongs to (empty for admins and trainees)
  last_login_at TEXT     -- when the person last logged in with their password
);
CREATE UNIQUE INDEX IF NOT EXISTS users_record ON users (record_id);

-- Login sessions. Only a scrambled (hashed) copy of each session key is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

-- One row per VA per work day.
-- status: pending, on_time, late, missed, called_out, time_off, emergency, exempt, checked_in
-- ("checked_in" is used when the VA has no fixed start time.)
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,       -- YYYY-MM-DD in the VA's own time zone
  scheduled_start TEXT,          -- when the shift should start (UTC)
  checked_in_at TEXT,            -- when the VA checked in (UTC)
  status TEXT NOT NULL DEFAULT 'pending',
  callout_reason TEXT,
  alert_10_sent INTEGER NOT NULL DEFAULT 0,
  alert_15_sent INTEGER NOT NULL DEFAULT 0,
  projects TEXT,                 -- the projects this check-in covered, for example "Pool Partners, Rise & Shine"
  UNIQUE (user_id, work_date)
);
CREATE INDEX IF NOT EXISTS attendance_date ON attendance (work_date);

-- Active projects, copied from Zoho Projects every hour.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,              -- the project's id in Zoho Projects
  name TEXT NOT NULL,               -- full name, for example "Pool Partners - Tracy Saeman"
  client TEXT NOT NULL,             -- the part before the last " - ", for example "Pool Partners"
  va_name TEXT,                     -- the part after the last " - ", for example "Tracy Saeman"
  active INTEGER NOT NULL DEFAULT 1,
  assignment_locked INTEGER NOT NULL DEFAULT 0,  -- 1 once assigned (automatically or by an admin), so syncs stop auto-assigning it
  is_coverage INTEGER NOT NULL DEFAULT 0,  -- 1 for "[client] - [backup VA] - Coverage": no SOP; check-ins only on days that VA covers the client
  client_record_id INTEGER REFERENCES records(id),  -- the client record; filled in by name while empty, or chosen by an admin
  client_set INTEGER NOT NULL DEFAULT 0  -- 1 = an admin chose the client (or "No client") on the Projects page; syncs leave it alone
);
CREATE INDEX IF NOT EXISTS projects_client ON projects (client_record_id);

-- Which VA works on which project, and when. One check-in per day covers all of a VA's projects that day,
-- due at the earliest start time.
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_time TEXT,                  -- "HH:MM"; empty means no fixed start (no late alerts)
  time_zone TEXT,                   -- PST, MST, CST or EST for start_time; empty = the VA's own time zone
  days TEXT NOT NULL DEFAULT '1,2,3,4,5',  -- work days: 0 = Sunday, 1 = Monday ... 6 = Saturday
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  needs_coverage INTEGER NOT NULL DEFAULT 0,  -- 1 when the request has rows in coverage_projects
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, denied, cancelled
  kind TEXT NOT NULL DEFAULT 'time_off',   -- time_off or emergency
  added_by_admin INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'app',      -- app, form (Google Form) or admin
  details TEXT,                            -- the form's answers: clients, shift times, template
  form_response_id TEXT,                   -- the Google Form response id
  project_ids TEXT,                        -- empty = whole day; otherwise only these projects (comma-separated ids)
  backup_zoho_id TEXT,                     -- UNUSED since 2026-09-30 (old single-backup requests); now in coverage_projects
  backup_name TEXT,                        -- UNUSED (see coverage_projects)
  clickup_list_url TEXT,                   -- UNUSED (see coverage_projects)
  clickup_error TEXT,                      -- UNUSED (see coverage_projects)
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS time_off_form_response ON time_off_requests (form_response_id);

-- Which projects (clients) of a time-off request need coverage, who covers each, and each one's ClickUp checklist.
-- The checklist is created when the request is approved. No rows = no coverage, no checklist.
CREATE TABLE IF NOT EXISTS coverage_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES time_off_requests(id),
  project_id TEXT NOT NULL DEFAULT '',   -- Zoho project id; '' = all of the VA's work
  client TEXT NOT NULL,
  backup_zoho_id TEXT,                   -- empty = coverage needed, backup not chosen yet
  backup_name TEXT,
  clickup_list_url TEXT,
  clickup_error TEXT,
  UNIQUE (request_id, project_id)
);

-- Form responses whose name did not match an active VA, until an admin picks the VA.
CREATE TABLE IF NOT EXISTS form_unmatched (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_response_id TEXT UNIQUE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  details TEXT,
  note TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- VAs who can cover for someone: VA Status "Active" or "On Deck" on their VA record. Refreshed whenever a VA record
-- changes and at every hourly sync. zoho_id is the VA's key (old Zoho CRM id, or "app-<record id>").
CREATE TABLE IF NOT EXISTS backup_candidates (
  zoho_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  email TEXT,
  time_zone TEXT,
  availability TEXT
);

-- Company holidays: no check-in is expected on these dates.
CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Small app-wide settings, for example the grace period, and backup_hidden: a JSON list of the keys (zoho_id)
-- of VAs left out of the "who covers" lists.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Records which scheduled reports were already sent, so none is sent twice.
CREATE TABLE IF NOT EXISTS sent_log (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Coverage SOPs: one per project. A VA fills in the template in the app, or uploads their own file.
CREATE TABLE IF NOT EXISTS sops (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  content TEXT,                  -- the template filled in the app: JSON { "sections": [...] }
  completed_at TEXT,             -- when the in-app SOP was marked complete
  file_key TEXT,                 -- uploaded file, in the SOP_FILES storage
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  uploaded_at TEXT,
  not_needed INTEGER NOT NULL DEFAULT 0,  -- 1 = an admin decided this project needs no SOP
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);

-- UNUSED since 2026-10-14: the old one-timer-per-VA table, replaced by work_timers (see below).
CREATE TABLE IF NOT EXISTS timers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  project_id TEXT NOT NULL,
  task_id TEXT,            -- empty for a general log
  task_name TEXT,
  started_at TEXT NOT NULL,
  stopped_at TEXT,         -- set when stopped; the timer then waits to be saved as a time log
  auto_stopped INTEGER NOT NULL DEFAULT 0
);

-- Clients, client contacts, VAs and applicants (Hiring) kept in the app (they replaced Zoho CRM in 2026), with notes,
-- files and change history.

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,          -- clients, contacts, vas or applicants
  name TEXT NOT NULL,
  status TEXT,                   -- clients: Current, Paused, Offboarded; VAs: Active, On Deck, Offboarded, n/a; contacts: Current, Offboarded; applicants: the hiring step
  parent_id INTEGER,             -- contacts: the client they belong to
  email TEXT,                    -- lowercase main email
  search TEXT,                   -- lowercase name, emails, phone and place, for searching
  data TEXT NOT NULL DEFAULT '{}',  -- the field values (see src/fields.js), as JSON
  zoho_id TEXT UNIQUE,           -- the record's id in Zoho CRM, when it was copied from there in 2026 (history only)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT,
  updated_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS records_module ON records (module, status, name);
CREATE INDEX IF NOT EXISTS records_parent ON records (parent_id);

CREATE TABLE IF NOT EXISTS record_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id),
  user_id INTEGER REFERENCES users(id),  -- empty for notes copied from Zoho
  author TEXT,                           -- the writer's name (kept for notes copied from Zoho)
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  zoho_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS record_notes_record ON record_notes (record_id);

-- Files kept in the SOP_FILES storage under records/. `field` is the kind of file (Resume, Contract), or '' for other attachments.
CREATE TABLE IF NOT EXISTS record_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id),
  field TEXT NOT NULL DEFAULT '',
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  uploader TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  zoho_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS record_files_record ON record_files (record_id);

-- Who changed what on a record, and when. changes: JSON [{ "f": field key, "from": ..., "to": ... }].
CREATE TABLE IF NOT EXISTS record_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id),
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (datetime('now')),
  summary TEXT NOT NULL,
  changes TEXT
);
CREATE INDEX IF NOT EXISTS record_history_record ON record_history (record_id, at);

-- Settings > Fields: admins' changes to the record fields (laid over src/fields.js) and a log of them.
CREATE TABLE IF NOT EXISTS field_layouts (
  module TEXT PRIMARY KEY,       -- clients, contacts, vas or applicants
  data TEXT NOT NULL,            -- JSON: sections and their field order, labels, help text, choices, custom and hidden fields
  updated_at TEXT,
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS field_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  summary TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS field_log_module ON field_log (module, at);

-- Tags with folders on VAs, applicants and clients (Settings > Tags). Changes are logged in field_log (module 'tags').
CREATE TABLE IF NOT EXISTS tag_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tag_folders_name ON tag_folders (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  folder_id INTEGER REFERENCES tag_folders(id),   -- empty: "No folder"
  colour TEXT NOT NULL DEFAULT 'grey',            -- one of the colours in src/tags-views.js
  on_vas INTEGER NOT NULL DEFAULT 1,              -- which kinds of records can have it
  on_applicants INTEGER NOT NULL DEFAULT 1,
  on_clients INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);
-- Tag names are unique inside their folder, compared without capitals.
CREATE UNIQUE INDEX IF NOT EXISTS tags_name ON tags (IFNULL(folder_id, 0), name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS record_tags (
  record_id INTEGER NOT NULL REFERENCES records(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  added_by INTEGER REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (record_id, tag_id)
);
CREATE INDEX IF NOT EXISTS record_tags_tag ON record_tags (tag_id);

-- Shared client/VA email (replaces Zoho CRM's email): each admin connects their Gmail once. The app keeps
-- only emails to or from the addresses of clients, client contacts and VAs (see src/email.js).

-- One row per admin who connected Gmail. `token` is the Google refresh token, encrypted with the
-- EMAIL_TOKEN_KEY secret (never shown or logged). token NULL = not connected now (saved emails kept).
CREATE TABLE IF NOT EXISTS email_inboxes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  email TEXT NOT NULL,                 -- the Google account (lowercase)
  token TEXT,                          -- encrypted refresh token
  access TEXT,                         -- encrypted short-lived access token and when it ends
  shared INTEGER NOT NULL DEFAULT 0,   -- 1 = all admins see the saved emails; 0 = only this person
  history_id TEXT,                     -- Gmail's mark where the next check for new mail starts
  queue TEXT NOT NULL DEFAULT '[]',    -- steps still to do (looking through older mail), as JSON
  connected_at TEXT,
  checked_at TEXT,                     -- last check for new mail
  last_sync_at TEXT,                   -- last run that finished without a problem
  last_error TEXT,
  last_error_at TEXT
);

-- Saved emails. Only the plain text is kept (cut to 20 KB), never the HTML; attachments are only listed
-- (name, size) and opened live from Gmail.
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),  -- whose inbox it came from
  gmail_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  msg_id TEXT,                         -- the Message-ID header (the same email in two inboxes shows once)
  sent_at TEXT NOT NULL,
  from_addr TEXT,
  to_addr TEXT,
  cc_addr TEXT,
  subject TEXT,
  snippet TEXT,
  body TEXT,
  attachments TEXT,                    -- JSON [{ "p": part id, "n": name, "s": size, "t": type }]
  outgoing INTEGER NOT NULL DEFAULT 0, -- 1 = sent from this inbox
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, gmail_id)
);
CREATE INDEX IF NOT EXISTS emails_thread ON emails (user_id, thread_id);

-- Which records each email belongs to (an email can belong to several).
CREATE TABLE IF NOT EXISTS email_links (
  email_id INTEGER NOT NULL REFERENCES emails(id),
  record_id INTEGER NOT NULL REFERENCES records(id),
  PRIMARY KEY (email_id, record_id)
);
CREATE INDEX IF NOT EXISTS email_links_record ON email_links (record_id);

-- VA training program (moved here from the separate training tracker app).
-- A training pairs a trainee with a trainer (a current VA) and works through a day-by-day checklist.

-- The checklist: days, and the items of each day. Only admins change these.
CREATE TABLE IF NOT EXISTS training_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_number INTEGER NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES training_days(id),
  position INTEGER NOT NULL,
  location TEXT NOT NULL DEFAULT '',     -- the system or channel, for example "CRM"
  name TEXT NOT NULL,
  trainer_text TEXT NOT NULL DEFAULT '', -- what the trainer does
  trainee_text TEXT NOT NULL DEFAULT ''  -- what the trainee does
);
CREATE INDEX IF NOT EXISTS training_items_day ON training_items (day_id, position);

-- One row per training. kind: Onboarding Training (a new hire), Back-Up or After-Hours (current VAs).
-- status: active, paused, completed or cancelled.
CREATE TABLE IF NOT EXISTS trainings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  trainee_id INTEGER NOT NULL REFERENCES users(id),
  trainer_id INTEGER NOT NULL REFERENCES users(id),
  start_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  applicant_id INTEGER -- the applicant (records row, module 'applicants') it was started from, if any
);
CREATE INDEX IF NOT EXISTS trainings_trainee ON trainings (trainee_id, status);
CREATE INDEX IF NOT EXISTS trainings_applicant ON trainings (applicant_id);
CREATE INDEX IF NOT EXISTS trainings_trainer ON trainings (trainer_id, status);

-- Each checklist item of a training. status: not_started, covered or carried_over (moves on to a later day).
CREATE TABLE IF NOT EXISTS training_progress (
  training_id INTEGER NOT NULL REFERENCES trainings(id),
  item_id INTEGER NOT NULL REFERENCES training_items(id),
  status TEXT NOT NULL DEFAULT 'not_started',
  trainer_notes TEXT,
  trainee_notes TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT,
  PRIMARY KEY (training_id, item_id)
);

-- Day sign-offs: the trainer and the trainee each sign; an admin can sign off a day for both.
CREATE TABLE IF NOT EXISTS training_signoffs (
  training_id INTEGER NOT NULL REFERENCES trainings(id),
  day_id INTEGER NOT NULL REFERENCES training_days(id),
  trainer_at TEXT,
  trainee_at TEXT,
  admin_at TEXT,
  admin_by INTEGER REFERENCES users(id),
  PRIMARY KEY (training_id, day_id)
);

-- Self-paced training modules (iSpring), done before Day 1 of an Onboarding Training (2026-10-12).
-- Admins change the list on Training > Edit the checklist. The links cannot report back, so the
-- trainee (or an admin) marks each module finished in the app.
CREATE TABLE IF NOT EXISTS training_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,                      -- http(s) link to the module
  description TEXT NOT NULL DEFAULT ''    -- one short line shown under the name
);

-- One row per finished module per training. Deleted again when marked "not finished".
CREATE TABLE IF NOT EXISTS training_module_progress (
  training_id INTEGER NOT NULL REFERENCES trainings(id),
  module_id INTEGER NOT NULL REFERENCES training_modules(id),
  finished_at TEXT NOT NULL,
  finished_by INTEGER REFERENCES users(id),
  PRIMARY KEY (training_id, module_id)
);

INSERT OR IGNORE INTO training_modules (id, position, name, url, description) VALUES
  (1, 1, 'InoVA Local & the Cleaning Industry', 'https://acc-55985.ispring.com/app/preview/a74e6740-16b3-11f1-b789-e6fa6675af2b',
   'Who InoVA Local is, and how the cleaning businesses we support work.'),
  (2, 2, 'InoVA Local Onboarding & Tools', 'https://acc-55985.ispring.com/app/preview/c6e1554a-16b8-11f1-b691-e6fa6675af2b',
   'How onboarding works, and the tools you will use as a VA.');

-- The starting training checklist, copied from the training tracker app (2026-10-09). Admins change it on Training > Checklist.
INSERT OR IGNORE INTO training_days (id, day_number, title) VALUES
  (1, 1, 'Orientation & Software/Role Overview'),
  (2, 2, 'Daily Task Flow'),
  (3, 3, 'Customer Quote Calls'),
  (4, 4, 'New Leads & Reschedules'),
  (5, 5, 'End-of-Day Close-Out & Wrap-Up');

INSERT OR IGNORE INTO training_items (id, day_id, position, location, name, trainer_text, trainee_text) VALUES
  (1, 1, 1, 'All systems', 'Software & role overview',
   'Walk the trainee through every software you use for this client (CRM, marketing software, phone system, Zoho) and give a short overview of what your day-to-day role covers.',
   'Get an overview of each software the trainer uses and what their day-to-day role covers. Ask about anything unclear.'),
  (2, 1, 2, 'Training Syllabus', 'Orientation to this week''s syllabus',
   'Introduce the full training checklist you''ll work through this week and explain how daily sign-off works.',
   'Get familiar with the training checklist for the week and how your progress is tracked and signed off each day.'),
  (3, 1, 3, 'Inova Slack / Client messaging', 'Start-of-day check-in routine',
   'Show the start-of-day check-in routine and explain what a good check-in message looks like.',
   'Learn how the start-of-day check-in message is written and sent, and note the format so you could write one yourself.'),
  (4, 2, 1, 'Marketing Software', 'Task review & prioritization',
   'Show how you review and prioritize your assigned tasks for the day.',
   'Learn how tasks are reviewed and prioritized, and how the trainer decides what to do first.'),
  (5, 2, 2, 'CRM', 'Client lookup',
   'Show how to look up a client''s info and communication history in the CRM before acting on a task.',
   'Learn what information gets checked in the CRM before acting on a task, and why it matters.'),
  (6, 2, 3, 'Phone System', 'Outbound call logging',
   'Show how an outbound call gets logged and what "complete" looks like on a task.',
   'Learn how a call gets logged and what marks a task as complete.'),
  (7, 2, 4, 'Marketing Software / CRM', 'Note-mirroring',
   'Show how notes are kept consistent between the CRM and marketing software, and why duplicate or contradictory notes cause problems.',
   'Learn how the same note gets entered or reflected in both the CRM and marketing software.'),
  (8, 2, 5, 'Freshbooks / Zoho', 'Billing/time entry detail',
   'Show the level of detail expected in a time or billing entry using one of your own recent entries.',
   'Learn the level of detail expected in a billing entry so you know what''s expected later.'),
  (9, 3, 1, 'Phone System', 'Greeting & intake script',
   'Show the standard phone greeting and intake questions used to start a quote.',
   'Learn the standard greeting and the questions asked to start a quote.'),
  (10, 3, 2, 'CRM', 'Quote build requirements',
   'Show what''s required to generate a quote: house size, pricing model, add-ons.',
   'Learn what information is required to build a quote.'),
  (11, 3, 3, 'CRM', 'Booking path',
   'Show the booking flow: payment info, scheduling preferences, access/parking/pet notes, and next-step communication.',
   'Learn the full booking flow, including how payment info and scheduling preferences are handled.'),
  (12, 3, 4, 'CRM / Marketing Software', 'Non-booking path',
   'Show objection handling, sending a written quote, and the correct follow-up cadence when a caller doesn''t book.',
   'Learn how objections are handled and what follow-up looks like when someone doesn''t book right away.'),
  (13, 3, 5, 'Judgment / Escalation', 'Escalation triggers for pricing/policy',
   'Explain when a pricing or policy question should be escalated to the client/manager versus answered independently.',
   'Learn which pricing or policy questions get escalated versus handled directly.'),
  (14, 4, 1, 'Marketing Software', 'New-lead triage',
   'Show how a "new lead" notification is reviewed and prioritized.',
   'Learn how a new lead gets triaged and prioritized.'),
  (15, 4, 2, 'CRM', 'Follow-up call flow',
   'Show the follow-up call flow for a lead that didn''t complete a quote, including how the outcome gets logged (even a voicemail).',
   'Learn how a follow-up call is logged, including when it''s just a voicemail.'),
  (16, 4, 3, 'Phone System / Slack', 'Reschedule handling',
   'Show how reschedule details are gathered (reason, new date, tech preference) and which parts are handled directly versus routed to the scheduling owner.',
   'Learn how reschedule details are gathered and what gets routed elsewhere.'),
  (17, 4, 4, 'Judgment / Escalation', 'The escalation ladder (general)',
   'Explain, in general terms, what a VA handles solo versus what always goes to a manager or client.',
   'Learn the general rule for what you''d handle solo versus escalate.'),
  (18, 5, 1, 'Email / CRM / Marketing Software', 'End-of-day review routine',
   'Show the end-of-day review pass: outstanding emails, next-day schedule check, and any unresolved tasks.',
   'Learn the full end-of-day review pass.'),
  (19, 5, 2, 'Phone System', 'Phone system log-out',
   'Show how you log out of the phone system at the end of shift.',
   'Learn the log-out step as part of closing a shift.'),
  (20, 5, 3, 'Inova Slack / Client messaging', 'End-of-day check-out message',
   'Show the end-of-day check-out message to the internal team and the client.',
   'Learn the format of the end-of-day check-out message.'),
  (21, 5, 4, 'General Practices', 'Credential handoff & access control',
   'Explain where the client-specific login/credential list lives and who controls access once a backup VA is formally assigned.',
   'Learn where credentials live and who to go to when you''re formally assigned to an account.'),
  (22, 5, 5, 'General Practices', 'Tone & communication expectations',
   'Walk through tone and communication style expectations, both with clients and with customers, using real examples.',
   'Learn the tone and communication style expectations with both clients and customers.'),
  (23, 5, 6, 'General Practices', 'Reference materials',
   'Show where to find sales scripts and other reference material.',
   'Learn where reference materials and sales scripts live for later.'),
  (24, 5, 7, 'Training Syllabus', 'Full syllabus review & sign-off',
   'Review the full checklist together, confirm every item was covered (including anything carried over from earlier days), and sign off.',
   'Review the full checklist together, flag anything that wasn''t clearly covered, and sign off.');

-- Time logging in the app (replacing Zoho Projects). Projects made in the app have ids "p-1", "p-2" ...;
-- Zoho Projects ids are long numbers. The task types and pay periods lists are filled only when empty.

-- Settings of a project. No row (or an empty value) = the default (time zone: the client record's, else the VA's;
-- billing day: the first "Invoice date" of the client record, else the 1st).
CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  time_zone TEXT,                 -- PST, MST, CST or EST: the project's own day (logs count on this day)
  billing_day INTEGER,            -- 1-28: a billing cycle runs from this day to the day before it next month
  created_by INTEGER REFERENCES users(id),  -- projects made in the app: who made it, and when
  created_at TEXT
);

-- Package size (hours per billing cycle), with the date each size starts counting. The newest row whose
-- effective_from is on or before a day is the package of that day.
CREATE TABLE IF NOT EXISTS project_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  hours REAL NOT NULL,
  effective_from TEXT NOT NULL,   -- YYYY-MM-DD
  set_by INTEGER REFERENCES users(id),
  set_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, effective_from)
);

-- Who changed what on a project (settings, package, VAs), and when.
CREATE TABLE IF NOT EXISTS project_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (datetime('now')),
  summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_history_project ON project_history (project_id, at);

-- One company-wide list of task types (Settings > Task types). A type with time logs can only be hidden.
CREATE TABLE IF NOT EXISTS task_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,   -- 1 = not offered for new logs (old logs keep it)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS task_types_name ON task_types (name COLLATE NOCASE);
INSERT INTO task_types (name, position)
  SELECT column1, column2 FROM (VALUES ('Phones and inbound calls', 1), ('Scheduling', 2), ('Email and inbox', 3),
    ('Follow-ups', 4), ('Sales and leads', 5), ('Billing and invoicing', 6), ('Admin', 7), ('Meetings', 8),
    ('Training', 9), ('Other', 10))
  WHERE NOT EXISTS (SELECT 1 FROM task_types);

-- Pay periods (Settings > Pay periods), copied from the "2026 Pay Periods" sheet.
CREATE TABLE IF NOT EXISTS pay_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,       -- YYYY-MM-DD, first day
  end_date TEXT NOT NULL,         -- YYYY-MM-DD, last day
  pay_day TEXT NOT NULL,          -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_periods_start ON pay_periods (start_date);
INSERT INTO pay_periods (start_date, end_date, pay_day)
  SELECT column1, column2, column3 FROM (VALUES
    ('2025-12-12', '2025-12-25', '2026-01-02'), ('2025-12-26', '2026-01-08', '2026-01-16'),
    ('2026-01-09', '2026-01-22', '2026-01-30'), ('2026-01-23', '2026-02-05', '2026-02-13'),
    ('2026-02-06', '2026-02-19', '2026-02-27'), ('2026-02-20', '2026-03-05', '2026-03-13'),
    ('2026-03-06', '2026-03-19', '2026-03-27'), ('2026-03-20', '2026-04-02', '2026-04-10'),
    ('2026-04-03', '2026-04-16', '2026-04-24'), ('2026-04-17', '2026-04-30', '2026-05-08'),
    ('2026-05-01', '2026-05-14', '2026-05-22'), ('2026-05-15', '2026-05-28', '2026-06-05'),
    ('2026-05-29', '2026-06-11', '2026-06-19'), ('2026-06-12', '2026-06-25', '2026-07-03'),
    ('2026-06-26', '2026-07-09', '2026-07-17'), ('2026-07-10', '2026-07-23', '2026-07-31'),
    ('2026-07-24', '2026-08-06', '2026-08-14'), ('2026-08-07', '2026-08-20', '2026-08-28'),
    ('2026-08-21', '2026-09-03', '2026-09-11'), ('2026-09-04', '2026-09-17', '2026-09-25'),
    ('2026-09-18', '2026-10-01', '2026-10-09'), ('2026-10-02', '2026-10-15', '2026-10-23'),
    ('2026-10-16', '2026-10-29', '2026-11-06'), ('2026-10-30', '2026-11-12', '2026-11-20'),
    ('2026-11-13', '2026-11-26', '2026-12-04'), ('2026-11-27', '2026-12-03', '2026-12-18'),
    ('2026-12-04', '2026-12-17', '2027-01-01'), ('2026-12-18', '2026-12-31', '2027-01-15'))
  WHERE NOT EXISTS (SELECT 1 FROM pay_periods);

-- Time logs kept in the app (used from piece T2). entered_at and entered_by are set by the server and never change.
CREATE TABLE IF NOT EXISTS time_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),     -- whose time it is
  task_type_id INTEGER REFERENCES task_types(id),
  description TEXT NOT NULL DEFAULT '',
  minutes INTEGER NOT NULL,
  work_date TEXT NOT NULL,          -- YYYY-MM-DD in the project's time zone
  started_at TEXT,                  -- UTC; empty for time typed in by hand
  ended_at TEXT,                    -- UTC; empty for time typed in by hand
  entered_at TEXT NOT NULL,         -- UTC, set by the server
  entered_by INTEGER NOT NULL REFERENCES users(id),  -- set by the server
  source TEXT NOT NULL DEFAULT 'manual',  -- timer, manual or zoho (copied from Zoho Projects)
  zoho_log_id TEXT,                 -- the log's id in Zoho Projects (copied logs only)
  edited_at TEXT,
  edited_by INTEGER REFERENCES users(id),
  deleted_at TEXT,                  -- set = deleted (kept for history)
  deleted_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS time_logs_project ON time_logs (project_id, work_date);
CREATE INDEX IF NOT EXISTS time_logs_user ON time_logs (user_id, work_date);
CREATE INDEX IF NOT EXISTS time_logs_type ON time_logs (task_type_id);
CREATE INDEX IF NOT EXISTS time_logs_date ON time_logs (work_date);  -- admin Time page: all VAs in a date range
CREATE UNIQUE INDEX IF NOT EXISTS time_logs_zoho ON time_logs (zoho_log_id);

-- Files attached to a time log, kept in the SOP_FILES storage under time-logs/.
CREATE TABLE IF NOT EXISTS time_log_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL REFERENCES time_logs(id),
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS time_log_files_log ON time_log_files (log_id);

-- Changes to a time log. changes: JSON [{ "f": field, "from": ..., "to": ... }].
CREATE TABLE IF NOT EXISTS time_log_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL REFERENCES time_logs(id),
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (datetime('now')),
  summary TEXT NOT NULL,
  changes TEXT
);
CREATE INDEX IF NOT EXISTS time_log_history_log ON time_log_history (log_id);

-- Days an admin allowed a VA to log time for (other than today) in one project.
CREATE TABLE IF NOT EXISTS log_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  reason TEXT,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS log_exceptions_user ON log_exceptions (user_id, project_id);

-- Days a VA logged less than the daily minimum in a project (filled by the daily time check, src/timecheck.js).
CREATE TABLE IF NOT EXISTS missed_time (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  minutes_logged INTEGER NOT NULL DEFAULT 0,
  minimum INTEGER NOT NULL,
  notified_at TEXT,
  UNIQUE (work_date, project_id, user_id)
);

-- The Slack message and the excuse of each missed_time row (one row each).
CREATE TABLE IF NOT EXISTS missed_time_state (
  missed_id INTEGER PRIMARY KEY REFERENCES missed_time(id),
  dm TEXT NOT NULL DEFAULT 'none',   -- none (Log only), due, sending, sent, failed, no_slack
  dm_at TEXT,
  dm_error TEXT,
  excused_at TEXT,                   -- set = an admin excused the day; it no longer counts
  excused_by INTEGER REFERENCES users(id),
  excuse_note TEXT
);

-- When the app first saw each VA on each project (filled by the every-minute job). The daily time check skips the
-- days before a VA joined a project (and the day they joined).
CREATE TABLE IF NOT EXISTS assignment_starts (
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  first_seen TEXT NOT NULL,          -- UTC
  PRIMARY KEY (project_id, user_id)
);

-- Timers: a VA can run several at once (different projects or tasks). They run on the server, so they keep going
-- when the app is closed. Replaces the old one-timer-per-VA "timers" table (left in place, UNUSED).
-- task_id and task_name are only for the old Zoho "Tasks & time" page (until piece T2 replaces it).
CREATE TABLE IF NOT EXISTS work_timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_type_id INTEGER REFERENCES task_types(id),
  description TEXT,
  task_id TEXT,
  task_name TEXT,
  started_at TEXT NOT NULL,
  stopped_at TEXT,                  -- set when stopped (by the VA, or after 8 hours)
  auto_stopped INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS work_timers_user ON work_timers (user_id);
-- Copies any timer from the old table (once: a timer already copied is not copied again).
INSERT INTO work_timers (user_id, project_id, task_id, task_name, started_at, stopped_at, auto_stopped)
  SELECT t.user_id, t.project_id, t.task_id, t.task_name, t.started_at, t.stopped_at, t.auto_stopped FROM timers t
  WHERE NOT EXISTS (SELECT 1 FROM work_timers w WHERE w.user_id = t.user_id AND w.started_at = t.started_at);

-- The starting admins. They set their passwords on first use (see README). At the end of the file, because
-- users.record_id refers to the records table, which must exist first.
INSERT OR IGNORE INTO users (email, name, is_admin) VALUES
  ('andres@inovalocal.com', 'Andres', 1),
  ('pratap@inovalocal.com', 'Pratap', 1),
  ('kelli@inovalocal.com', 'Kelli', 1),
  ('stephany@inovalocal.com', 'Stephany Baldwin', 1);
