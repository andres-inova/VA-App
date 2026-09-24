-- Adds VA exemptions and admin-added time-off/coverage periods.
-- Run once with: npx wrangler d1 execute inova-checkin --remote --file=migrations/2026-09-24-exemptions.sql

ALTER TABLE users ADD COLUMN affiliation TEXT;                          -- Zoho "VA Company Affiliation"
ALTER TABLE users ADD COLUMN exempt INTEGER NOT NULL DEFAULT 0;         -- 1 = an admin exempted this VA
ALTER TABLE time_off_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'time_off';          -- time_off or coverage
ALTER TABLE time_off_requests ADD COLUMN added_by_admin INTEGER NOT NULL DEFAULT 0;      -- 1 = added by an admin

-- Current affiliations from Zoho (2026-09-24), so no VA is treated as exempt before the next sync.
UPDATE users SET affiliation = 'InoVA Local' WHERE zoho_id IN (
  '6851072000003967311', '6851072000003672068', '6851072000000872020', '6851072000000585128',
  '6851072000000585126', '6851072000000585125', '6851072000000585124', '6851072000000585123',
  '6851072000000585120', '6851072000000585118'
);
UPDATE users SET affiliation = 'Closers' WHERE zoho_id IN (
  '6851072000005858137', '6851072000003627001', '6851072000000585121'
);
