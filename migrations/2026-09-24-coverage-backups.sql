-- Request types become "time off" and "emergency"; coverage is a yes/no on the request,
-- with a backup VA chosen by an admin and a ClickUp checklist created on approval.
-- Run once with: npx wrangler d1 execute inova-checkin --remote --file=migrations/2026-09-24-coverage-backups.sql

ALTER TABLE time_off_requests ADD COLUMN backup_zoho_id TEXT;    -- the VA who covers (Zoho record id)
ALTER TABLE time_off_requests ADD COLUMN backup_name TEXT;
ALTER TABLE time_off_requests ADD COLUMN clickup_list_url TEXT;  -- the checklist created in ClickUp
ALTER TABLE time_off_requests ADD COLUMN clickup_error TEXT;     -- why creating the checklist failed, if it did

-- The old "coverage" type meant another VA covers: that is now "time off" with coverage needed.
UPDATE time_off_requests SET kind = 'time_off', needs_coverage = 1 WHERE kind = 'coverage';
UPDATE attendance SET status = 'time_off' WHERE status = 'coverage';

-- VAs who can cover: Zoho VA Status "Active" or "On Deck". Refreshed at every Zoho sync.
CREATE TABLE IF NOT EXISTS backup_candidates (
  zoho_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  email TEXT
);
