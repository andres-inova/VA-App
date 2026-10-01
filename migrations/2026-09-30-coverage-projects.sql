-- Coverage is now chosen per project (client): each project can have its own backup VA and gets
-- its own ClickUp checklist. Requests without coverage get no checklist.
CREATE TABLE IF NOT EXISTS coverage_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES time_off_requests(id),
  project_id TEXT NOT NULL DEFAULT '',   -- Zoho project id; '' = all of the VA's work
  client TEXT NOT NULL,
  backup_zoho_id TEXT,                   -- empty = coverage needed, backup not chosen yet
  backup_name TEXT,
  clickup_list_url TEXT,
  clickup_error TEXT,
  UNIQUE (request_id, project_id)
);

-- Approved coverage from before this change becomes one "All projects" entry, keeping its checklist.
INSERT OR IGNORE INTO coverage_projects (request_id, project_id, client, backup_zoho_id, backup_name, clickup_list_url, clickup_error)
  SELECT id, '', 'All projects', backup_zoho_id, backup_name, clickup_list_url, clickup_error
  FROM time_off_requests WHERE status = 'approved' AND kind != 'emergency' AND needs_coverage = 1
    AND id NOT IN (SELECT request_id FROM coverage_projects);

-- Form requests were all saved as "coverage needed". Ones not approved are reset; admins choose coverage per project.
UPDATE time_off_requests SET needs_coverage = 0 WHERE status != 'approved';
