-- Adds projects and assignments to a database created before they existed.
-- Run once with: npx wrangler d1 execute inova-checkin --remote --file=migrations/2026-09-24-projects.sql

ALTER TABLE attendance ADD COLUMN projects TEXT;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  va_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  assignment_locked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_time TEXT,
  days TEXT NOT NULL DEFAULT '1,2,3,4,5',
  UNIQUE (project_id, user_id)
);
