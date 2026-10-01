-- Coverage projects in Zoho are named "[CLIENT NAME] - [VA NAME] - Coverage", where the VA is the backup
-- covering that client. They need no Coverage SOP, and count for check-ins only on days that VA covers the client.
ALTER TABLE projects ADD COLUMN is_coverage INTEGER NOT NULL DEFAULT 0;
UPDATE projects SET is_coverage = 1 WHERE lower(trim(name)) LIKE '% - coverage';
