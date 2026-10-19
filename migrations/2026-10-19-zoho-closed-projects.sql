-- Time logging T6 step 2: the closed projects the current VAs' Zoho history needs (they are not in the app).
-- Safe to run more than once (a project is added only when no project has that name).

INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
  SELECT 'p-' || (SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 FROM projects WHERE id LIKE 'p-%'), 'Town Mountain Maids - Beatrix Burger', 'Town Mountain Maids', 'Beatrix Burger', 0, 1, 0, 26, 1
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Town Mountain Maids - Beatrix Burger');
INSERT INTO project_history (project_id, user_id, at, summary)
  SELECT p.id, 1, '2026-10-19T12:00:00.000Z', 'Added as a closed project to hold the Zoho Projects time log history' FROM projects p
  WHERE p.name = 'Town Mountain Maids - Beatrix Burger' AND NOT EXISTS (SELECT 1 FROM project_history h WHERE h.project_id = p.id);

INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
  SELECT 'p-' || (SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 FROM projects WHERE id LIKE 'p-%'), 'Rise & Shine - Tracy Saeman', 'Rise & Shine', 'Tracy Saeman', 0, 1, 0, 23, 1
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Rise & Shine - Tracy Saeman');
INSERT INTO project_history (project_id, user_id, at, summary)
  SELECT p.id, 1, '2026-10-19T12:00:00.000Z', 'Added as a closed project to hold the Zoho Projects time log history' FROM projects p
  WHERE p.name = 'Rise & Shine - Tracy Saeman' AND NOT EXISTS (SELECT 1 FROM project_history h WHERE h.project_id = p.id);

INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
  SELECT 'p-' || (SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 FROM projects WHERE id LIKE 'p-%'), 'TrueCoat Painters - Kayla Cousins', 'TrueCoat Painters', 'Kayla Cousins', 0, 1, 0, 37, 1
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'TrueCoat Painters - Kayla Cousins');
INSERT INTO project_history (project_id, user_id, at, summary)
  SELECT p.id, 1, '2026-10-19T12:00:00.000Z', 'Added as a closed project to hold the Zoho Projects time log history' FROM projects p
  WHERE p.name = 'TrueCoat Painters - Kayla Cousins' AND NOT EXISTS (SELECT 1 FROM project_history h WHERE h.project_id = p.id);

INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
  SELECT 'p-' || (SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 FROM projects WHERE id LIKE 'p-%'), 'Art of Clean - Kayla Cousins', 'Art of Clean', 'Kayla Cousins', 0, 1, 0, 34, 1
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Art of Clean - Kayla Cousins');
INSERT INTO project_history (project_id, user_id, at, summary)
  SELECT p.id, 1, '2026-10-19T12:00:00.000Z', 'Added as a closed project to hold the Zoho Projects time log history' FROM projects p
  WHERE p.name = 'Art of Clean - Kayla Cousins' AND NOT EXISTS (SELECT 1 FROM project_history h WHERE h.project_id = p.id);

INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
  SELECT 'p-' || (SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 FROM projects WHERE id LIKE 'p-%'), 'EcoVita - Beatrix Burger', 'EcoVita', 'Beatrix Burger', 0, 1, 0, 39, 1
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'EcoVita - Beatrix Burger');
INSERT INTO project_history (project_id, user_id, at, summary)
  SELECT p.id, 1, '2026-10-19T12:00:00.000Z', 'Added as a closed project to hold the Zoho Projects time log history' FROM projects p
  WHERE p.name = 'EcoVita - Beatrix Burger' AND NOT EXISTS (SELECT 1 FROM project_history h WHERE h.project_id = p.id);

INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
  SELECT 'p-' || (SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 FROM projects WHERE id LIKE 'p-%'), 'Colorado Complete Clean - Estefani Resendiz', 'Colorado Complete Clean', 'Estefani Resendiz', 0, 1, 0, 17, 1
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Colorado Complete Clean - Estefani Resendiz');
INSERT INTO project_history (project_id, user_id, at, summary)
  SELECT p.id, 1, '2026-10-19T12:00:00.000Z', 'Added as a closed project to hold the Zoho Projects time log history' FROM projects p
  WHERE p.name = 'Colorado Complete Clean - Estefani Resendiz' AND NOT EXISTS (SELECT 1 FROM project_history h WHERE h.project_id = p.id);

INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
  SELECT 'p-' || (SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 FROM projects WHERE id LIKE 'p-%'), 'Art of Clean - Stephany Baldwin', 'Art of Clean', 'Stephany Baldwin', 0, 1, 0, 34, 1
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Art of Clean - Stephany Baldwin');
INSERT INTO project_history (project_id, user_id, at, summary)
  SELECT p.id, 1, '2026-10-19T12:00:00.000Z', 'Added as a closed project to hold the Zoho Projects time log history' FROM projects p
  WHERE p.name = 'Art of Clean - Stephany Baldwin' AND NOT EXISTS (SELECT 1 FROM project_history h WHERE h.project_id = p.id);

INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
  SELECT 'p-' || (SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 FROM projects WHERE id LIKE 'p-%'), 'Maid This Minneapolis - Kayla Cousins', 'Maid This Minneapolis', 'Kayla Cousins', 0, 1, 0, 35, 1
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Maid This Minneapolis - Kayla Cousins');
INSERT INTO project_history (project_id, user_id, at, summary)
  SELECT p.id, 1, '2026-10-19T12:00:00.000Z', 'Added as a closed project to hold the Zoho Projects time log history' FROM projects p
  WHERE p.name = 'Maid This Minneapolis - Kayla Cousins' AND NOT EXISTS (SELECT 1 FROM project_history h WHERE h.project_id = p.id);

INSERT INTO projects (id, name, client, va_name, active, assignment_locked, is_coverage, client_record_id, client_set)
  SELECT 'p-' || (SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 FROM projects WHERE id LIKE 'p-%'), 'Colorado Complete Clean - Stephany Baldwin', 'Colorado Complete Clean', 'Stephany Baldwin', 0, 1, 0, 17, 1
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Colorado Complete Clean - Stephany Baldwin');
INSERT INTO project_history (project_id, user_id, at, summary)
  SELECT p.id, 1, '2026-10-19T12:00:00.000Z', 'Added as a closed project to hold the Zoho Projects time log history' FROM projects p
  WHERE p.name = 'Colorado Complete Clean - Stephany Baldwin' AND NOT EXISTS (SELECT 1 FROM project_history h WHERE h.project_id = p.id);
