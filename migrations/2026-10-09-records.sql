-- Clients, client contacts and VAs kept in the app (replacing Zoho CRM), with notes, files and change history.

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,          -- clients, contacts or vas
  name TEXT NOT NULL,
  status TEXT,                   -- clients: Current, Paused, Offboarded; VAs: Active, On Deck, Offboarded, n/a; contacts: Current, Offboarded
  parent_id INTEGER,             -- contacts: the client they belong to
  email TEXT,                    -- lowercase main email
  search TEXT,                   -- lowercase name, emails, phone and place, for searching
  data TEXT NOT NULL DEFAULT '{}',  -- the field values (see src/fields.js), as JSON
  zoho_id TEXT UNIQUE,           -- the record's id in Zoho CRM, when it was copied from there
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT,
  updated_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS records_module ON records (module, status, name);
CREATE INDEX IF NOT EXISTS records_parent ON records (parent_id);

CREATE TABLE IF NOT EXISTS record_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id),
  user_id INTEGER REFERENCES users(id),  -- empty for notes copied from Zoho
  author TEXT,                           -- the writer's name (kept for notes copied from Zoho)
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  zoho_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS record_notes_record ON record_notes (record_id);

-- Files kept in the SOP_FILES storage under records/. `field` is the kind of file (Resume, Contract), or '' for other attachments.
CREATE TABLE IF NOT EXISTS record_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id),
  field TEXT NOT NULL DEFAULT '',
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  uploader TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  zoho_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS record_files_record ON record_files (record_id);

-- Who changed what on a record, and when. changes: JSON [{ "f": field key, "from": ..., "to": ... }].
CREATE TABLE IF NOT EXISTS record_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id),
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (datetime('now')),
  summary TEXT NOT NULL,
  changes TEXT
);
CREATE INDEX IF NOT EXISTS record_history_record ON record_history (record_id, at);

-- Clients now live in the app; the read-only copy of Zoho clients is no longer used.
DELETE FROM crm_records WHERE module = 'clients';
DELETE FROM settings WHERE key = 'crm_layout_clients';
