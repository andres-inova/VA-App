-- Lets a time-off request cover only some of a VA's projects.
-- Run once with: npx wrangler d1 execute inova-checkin --remote --file=migrations/2026-09-24-request-projects.sql

ALTER TABLE time_off_requests ADD COLUMN project_ids TEXT;  -- empty = whole day; otherwise comma-separated Zoho project ids
