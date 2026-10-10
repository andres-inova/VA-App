-- Database tables for the InoVA Local check-in tracker.

-- Everyone who can log in. A person can be an admin, a VA, or both.
-- VA details (time zone, availability, Slack channel) are copied from Zoho CRM.
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
  zoho_id TEXT,
  time_zone TEXT,        -- PST, MST, CST or EST (from Zoho)
  availability TEXT,     -- for example "9am - 5pm" (from Zoho)
  start_override TEXT,   -- "HH:MM" set by an admin; used instead of the Zoho start time
  slack_channel_id TEXT, -- VA's management channel (Zoho "Slack Management ID")
  slack_user_id TEXT,    -- VA's own Slack user ID (Zoho "Slack ID"), used to tag them
  affiliation TEXT,      -- Zoho "VA Company Affiliation"; only "InoVA Local" VAs are checked
  exempt INTEGER NOT NULL DEFAULT 0,  -- 1 = an admin exempted this VA from check-ins
  zoho_projects_user_id TEXT,  -- the VA's user ID in Zoho Projects (for time logs)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  is_coverage INTEGER NOT NULL DEFAULT 0  -- 1 for "[client] - [backup VA] - Coverage": no SOP; check-ins only on days that VA covers the client
);

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
  backup_zoho_id TEXT,                     -- old, single-backup requests only; now in coverage_projects
  backup_name TEXT,
  clickup_list_url TEXT,
  clickup_error TEXT,
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

-- VAs who can cover for someone: Zoho VA Status "Active" or "On Deck". Refreshed at every Zoho sync.
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

-- Small app-wide settings, for example the grace period, and backup_hidden: a JSON list of the Zoho ids
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

-- The starting admins. They set their passwords on first use (see README).
INSERT OR IGNORE INTO users (email, name, is_admin) VALUES
  ('andres@inovalocal.com', 'Andres', 1),
  ('pratap@inovalocal.com', 'Pratap', 1),
  ('kelli@inovalocal.com', 'Kelli', 1),
  ('stephany@inovalocal.com', 'Stephany Baldwin', 1);

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

-- One timer per VA. When stopped (by the VA, or after 8 hours), it waits for the VA to add notes and save it to Zoho.
CREATE TABLE IF NOT EXISTS timers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  project_id TEXT NOT NULL,
  task_id TEXT,            -- empty for a general log
  task_name TEXT,
  started_at TEXT NOT NULL,
  stopped_at TEXT,         -- set when stopped; the timer then waits to be saved as a time log
  auto_stopped INTEGER NOT NULL DEFAULT 0
);

-- Clients, client contacts, VAs and applicants (Hiring) kept in the app (replacing Zoho CRM), with notes, files
-- and change history.

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,          -- clients, contacts, vas or applicants
  name TEXT NOT NULL,
  status TEXT,                   -- clients: Current, Paused, Offboarded; VAs: Active, On Deck, Offboarded, n/a; contacts: Current, Offboarded; applicants: the hiring step
  parent_id INTEGER,             -- contacts: the client they belong to
  email TEXT,                    -- lowercase main email
  search TEXT,                   -- lowercase name, emails, phone and place, for searching
  data TEXT NOT NULL DEFAULT '{}',  -- the field values (see src/fields.js), as JSON
  zoho_id TEXT UNIQUE,           -- the record's id in Zoho CRM, when it was copied from there
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
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS trainings_trainee ON trainings (trainee_id, status);
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
