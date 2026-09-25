-- Shows time zone and availability for On Deck VAs on the People page.
-- Run once with: npx wrangler d1 execute inova-checkin --remote --file=migrations/2026-09-24-on-deck-details.sql

ALTER TABLE backup_candidates ADD COLUMN time_zone TEXT;
ALTER TABLE backup_candidates ADD COLUMN availability TEXT;
