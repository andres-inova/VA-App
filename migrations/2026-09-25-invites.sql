-- Remembers when a login invite was last sent to each person.
-- Run once with: npx wrangler d1 execute inova-checkin --remote --file=migrations/2026-09-25-invites.sql

ALTER TABLE users ADD COLUMN invited_at TEXT;
