-- Tasks and time logs in Zoho Projects, done from the app.
-- Each VA's Zoho Projects user ID, so their time logs are saved under their own name.
ALTER TABLE users ADD COLUMN zoho_projects_user_id TEXT;

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
