-- Settings > Fields (CRM clean-up step 3b): admins' changes to the fields of clients, contacts, VAs and
-- applicants, laid over the built-in fields in src/fields.js, and a log of those changes. Safe to run twice.
CREATE TABLE IF NOT EXISTS field_layouts (
  module TEXT PRIMARY KEY,       -- clients, contacts, vas or applicants
  data TEXT NOT NULL,            -- JSON: sections and their field order, labels, help text, choices, custom and hidden fields
  updated_at TEXT,
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS field_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  summary TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS field_log_module ON field_log (module, at);
