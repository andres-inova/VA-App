-- CRM clean-up step 2 (2026-10-13): link things by id instead of by matching text.
--
-- 1. Each VA login (users row) remembers its VA record (users.record_id). Changing a VA's email on their
--    record then changes the email of the same login, so their history (projects, check-ins, time off,
--    timers, trainings) stays with them.
-- 2. Each project remembers its client record (projects.client_record_id). The hourly sync fills it in by
--    name only while it is empty; an admin can choose it on the Projects page (client_set = 1), and the
--    sync never changes that choice.
-- 3. users.last_login_at: when the person last logged in with their password (shown on the VA record).
--
-- Running this file a second time stops at the first line ("duplicate column name") and changes nothing.

ALTER TABLE users ADD COLUMN record_id INTEGER REFERENCES records(id);
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE projects ADD COLUMN client_record_id INTEGER REFERENCES records(id);
ALTER TABLE projects ADD COLUMN client_set INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS users_record ON users (record_id);
CREATE INDEX IF NOT EXISTS projects_client ON projects (client_record_id);

-- Link today's logins to their VA records the way the app matched them until now: first by the VA's key
-- (users.zoho_id = the record's Zoho id, or "app-<record id>"), then by email (any case). Only when exactly
-- one login and one record fit, so nothing is guessed. Logins and records left over are reported separately.
UPDATE users SET record_id = (
  SELECT r.id FROM records r WHERE r.module = 'vas' AND COALESCE(r.zoho_id, 'app-' || r.id) = users.zoho_id)
WHERE record_id IS NULL AND zoho_id IS NOT NULL
  AND (SELECT COUNT(*) FROM records r WHERE r.module = 'vas' AND COALESCE(r.zoho_id, 'app-' || r.id) = users.zoho_id) = 1
  AND (SELECT COUNT(*) FROM users o WHERE o.zoho_id = users.zoho_id) = 1
  AND NOT EXISTS (SELECT 1 FROM users o JOIN records r ON r.id = o.record_id
                  WHERE r.module = 'vas' AND COALESCE(r.zoho_id, 'app-' || r.id) = users.zoho_id);

UPDATE users SET record_id = (
  SELECT r.id FROM records r WHERE r.module = 'vas' AND lower(trim(r.email)) = lower(trim(users.email)))
WHERE record_id IS NULL AND is_admin = 0
  AND (SELECT COUNT(*) FROM records r WHERE r.module = 'vas' AND lower(trim(r.email)) = lower(trim(users.email))) = 1
  AND NOT EXISTS (SELECT 1 FROM users o JOIN records r ON r.id = o.record_id
                  WHERE r.module = 'vas' AND lower(trim(r.email)) = lower(trim(users.email)));

-- Link projects to the client record with the same name as the part before " - " (any case), when exactly
-- one client has that name.
UPDATE projects SET client_record_id = (
  SELECT r.id FROM records r WHERE r.module = 'clients' AND lower(trim(r.name)) = lower(trim(projects.client)))
WHERE client_record_id IS NULL AND client_set = 0
  AND (SELECT COUNT(*) FROM records r WHERE r.module = 'clients' AND lower(trim(r.name)) = lower(trim(projects.client))) = 1;
