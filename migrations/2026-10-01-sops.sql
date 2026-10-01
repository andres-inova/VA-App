-- Coverage SOPs: one per project. A VA fills in the template in the app, or uploads their own file.
CREATE TABLE IF NOT EXISTS sops (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  content TEXT,                  -- the template filled in the app: JSON { "sections": [...] }
  completed_at TEXT,             -- when the in-app SOP was marked complete
  file_key TEXT,                 -- uploaded file, in the SOP_FILES storage
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  uploaded_at TEXT,
  not_needed INTEGER NOT NULL DEFAULT 0,  -- 1 = an admin decided this project needs no SOP
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);
