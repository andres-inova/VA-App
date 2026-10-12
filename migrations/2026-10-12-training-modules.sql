-- Self-paced training modules (iSpring), done before Day 1 of an Onboarding Training.
-- Admins change the list on Training > Edit the checklist. The links cannot report back, so the
-- trainee (or an admin) marks each module finished in the app.
CREATE TABLE IF NOT EXISTS training_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,                      -- http(s) link to the module
  description TEXT NOT NULL DEFAULT ''    -- one short line shown under the name
);

-- One row per finished module per training. Deleted again when marked "not finished".
CREATE TABLE IF NOT EXISTS training_module_progress (
  training_id INTEGER NOT NULL REFERENCES trainings(id),
  module_id INTEGER NOT NULL REFERENCES training_modules(id),
  finished_at TEXT NOT NULL,
  finished_by INTEGER REFERENCES users(id),
  PRIMARY KEY (training_id, module_id)
);

INSERT OR IGNORE INTO training_modules (id, position, name, url, description) VALUES
  (1, 1, 'InoVA Local & the Cleaning Industry', 'https://acc-55985.ispring.com/app/preview/a74e6740-16b3-11f1-b789-e6fa6675af2b',
   'Who InoVA Local is, and how the cleaning businesses we support work.'),
  (2, 2, 'InoVA Local Onboarding & Tools', 'https://acc-55985.ispring.com/app/preview/c6e1554a-16b8-11f1-b691-e6fa6675af2b',
   'How onboarding works, and the tools you will use as a VA.');
