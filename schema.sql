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
  notify_time_off INTEGER NOT NULL DEFAULT 1,  -- admins only: email me about new time-off requests
  zoho_id TEXT,
  time_zone TEXT,        -- PST, MST, CST or EST (from Zoho)
  availability TEXT,     -- for example "9am - 5pm" (from Zoho)
  start_override TEXT,   -- "HH:MM" set by an admin; used instead of the Zoho start time
  slack_channel_id TEXT, -- VA's management channel (Zoho "Slack Management ID")
  slack_user_id TEXT,    -- VA's own Slack user ID (Zoho "Slack ID"), used to tag them
  affiliation TEXT,      -- Zoho "VA Company Affiliation"; only "InoVA Local" VAs are checked
  exempt INTEGER NOT NULL DEFAULT 0,  -- 1 = an admin exempted this VA from check-ins
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
  assignment_locked INTEGER NOT NULL DEFAULT 0  -- 1 once assigned (automatically or by an admin), so syncs stop auto-assigning it
);

-- Which VA works on which project, and when. One check-in per day covers all of a VA's projects that day,
-- due at the earliest start time.
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_time TEXT,                  -- "HH:MM" in the VA's time zone; empty means no fixed start (no late alerts)
  days TEXT NOT NULL DEFAULT '1,2,3,4,5',  -- work days: 0 = Sunday, 1 = Monday ... 6 = Saturday
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  needs_coverage INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, denied, cancelled
  kind TEXT NOT NULL DEFAULT 'time_off',   -- time_off or emergency
  added_by_admin INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'app',      -- app, form (Google Form) or admin
  details TEXT,                            -- the form's answers: clients, shift times, template
  form_response_id TEXT,                   -- the Google Form response id
  project_ids TEXT,                        -- empty = whole day; otherwise only these projects (comma-separated ids)
  backup_zoho_id TEXT,                     -- the VA who covers (Zoho record id)
  backup_name TEXT,
  clickup_list_url TEXT,                   -- the ClickUp checklist created when a coverage request is approved
  clickup_error TEXT,                      -- why creating the checklist failed, if it did
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS time_off_form_response ON time_off_requests (form_response_id);

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

-- Small app-wide settings, for example the grace period.
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
