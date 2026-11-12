-- Projects billed together (client portal, step C4). A pair is shown and billed as ONE line on the client's
-- "Projected bill" page: their hours are added up and the higher hourly rate of the two is used (the same rule as the
-- Billing Dashboard). Time pages, packages and logs stay per project. Safe to run twice.
CREATE TABLE IF NOT EXISTS billing_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id_a TEXT NOT NULL REFERENCES projects(id),
  project_id_b TEXT NOT NULL REFERENCES projects(id),
  UNIQUE (project_id_a, project_id_b)
);

-- The pairs the Billing Dashboard had (only where both projects are in this app and belong to the same client).
INSERT OR IGNORE INTO billing_pairs (project_id_a, project_id_b)
  SELECT a.id, b.id FROM projects a JOIN projects b ON b.client_record_id = a.client_record_id AND a.client_record_id IS NOT NULL
  WHERE (a.id, b.id) IN (
    ('2508636000002926190', '2508636000001947075'),
    ('2508636000002926272', '2508636000000247003'),
    ('2508636000002777021', '2508636000003588006'),
    ('2508636000003646005', '2508636000000282041'),
    ('2508636000002926082', '2508636000003395048')
  );
