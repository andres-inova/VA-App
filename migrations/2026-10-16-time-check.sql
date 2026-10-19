-- Time logging T5 (the daily time check): two new tables. Safe to run more than once.

-- When the app first saw each VA on each project. The daily time check skips the days before a VA joined a
-- project (and the day they joined). Assignments that exist now count as "always".
CREATE TABLE IF NOT EXISTS assignment_starts (
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  first_seen TEXT NOT NULL,          -- UTC
  PRIMARY KEY (project_id, user_id)
);
INSERT OR IGNORE INTO assignment_starts (project_id, user_id, first_seen)
  SELECT project_id, user_id, '2000-01-01T00:00:00.000Z' FROM assignments;

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
