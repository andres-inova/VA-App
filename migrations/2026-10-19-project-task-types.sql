-- Task types per project. A project with rows here offers exactly these task types (VAs pick from them);
-- a project with no rows offers the company-wide list (Settings > Task types, the ones not hidden).
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS project_task_types (
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_type_id INTEGER NOT NULL REFERENCES task_types(id),
  PRIMARY KEY (project_id, task_type_id)
);
