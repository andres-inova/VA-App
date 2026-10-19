-- The in-house project: one project every VA can log time on (no assignment needed), with a fixed task type list
-- nobody edits. It is the existing "InoVA Local - Internal" project (its Zoho history stays on it).
-- The daily 1-hour check skips it. Safe to run more than once.

-- Which project it is.
INSERT OR REPLACE INTO settings (key, value)
  SELECT 'inhouse_project_id', id FROM projects WHERE name = 'InoVA Local - Internal' LIMIT 1;

-- The default task types (Meetings, Training and the Zoho ones already exist; the missing ones are added hidden,
-- so they only show on this project).
INSERT OR IGNORE INTO task_types (name, position, hidden)
  SELECT column1, (SELECT COALESCE(MAX(position), 0) FROM task_types) + column2, 1 FROM (VALUES
    ('In-House', 1), ('Internal InoVA Communications', 2), ('Coverage Communications', 3), ('Training', 4),
    ('Meetings', 5), ('Monthly Check-In Survey', 6), ('Interviews', 7));

-- The fixed list of the in-house project.
DELETE FROM project_task_types WHERE project_id = (SELECT value FROM settings WHERE key = 'inhouse_project_id');
INSERT OR IGNORE INTO project_task_types (project_id, task_type_id)
  SELECT (SELECT value FROM settings WHERE key = 'inhouse_project_id'), id FROM task_types
  WHERE name IN ('In-House', 'Internal InoVA Communications', 'Coverage Communications', 'Training', 'Meetings', 'Monthly Check-In Survey', 'Interviews')
    AND (SELECT value FROM settings WHERE key = 'inhouse_project_id') IS NOT NULL;
