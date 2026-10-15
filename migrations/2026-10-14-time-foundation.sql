-- Time logging in the app, piece T1 (replacing Zoho Projects): the tables for projects made in the app, project
-- settings (time zone, billing day, package hours with dates), task types, pay periods, time logs and the new timers.
-- Projects made in the app have ids "p-1", "p-2" ... (Zoho Projects ids are long numbers), so both kinds live in the
-- same projects table. Safe to run twice: every table is created only when missing, and the lists of task types and
-- pay periods are filled only when they are empty.

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

-- Days a VA logged less than the daily minimum in a project (filled from piece T5).
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
