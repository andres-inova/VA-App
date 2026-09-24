-- Time-off/coverage requests now come from the Google Form "IL Coverage/Time-Off Request".
-- Run once with: npx wrangler d1 execute inova-checkin --remote --file=migrations/2026-09-24-form-requests.sql

ALTER TABLE time_off_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'app';  -- app, form or admin
ALTER TABLE time_off_requests ADD COLUMN details TEXT;                        -- the form's answers (clients, shift times, template)
ALTER TABLE time_off_requests ADD COLUMN form_response_id TEXT;               -- the Google Form response, so it is stored once
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
