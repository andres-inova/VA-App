-- Each project assignment can have its own time zone for its start time (PST, MST, CST or EST).
-- Empty means the VA's own time zone from Zoho.
ALTER TABLE assignments ADD COLUMN time_zone TEXT;
