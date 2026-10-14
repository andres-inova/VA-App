-- Tags with folders on VAs, applicants and clients (CRM clean-up step 4). Admins make folders and tags on
-- Settings > Tags and pick tags on a record page or for many records at once on the list pages.
-- Also copies the values of the old free-text "Tags" field of VAs and clients into real tags (folder "Imported")
-- and hides that old field (its values are kept). Contacts keep their old Tags field. Safe to run twice.

CREATE TABLE IF NOT EXISTS tag_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tag_folders_name ON tag_folders (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  folder_id INTEGER REFERENCES tag_folders(id),   -- empty: "No folder"
  colour TEXT NOT NULL DEFAULT 'grey',            -- one of the colours in src/tags-views.js
  on_vas INTEGER NOT NULL DEFAULT 1,              -- which kinds of records can have it
  on_applicants INTEGER NOT NULL DEFAULT 1,
  on_clients INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);
-- Tag names are unique inside their folder, compared without capitals.
CREATE UNIQUE INDEX IF NOT EXISTS tags_name ON tags (IFNULL(folder_id, 0), name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS record_tags (
  record_id INTEGER NOT NULL REFERENCES records(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  added_by INTEGER REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (record_id, tag_id)
);
CREATE INDEX IF NOT EXISTS record_tags_tag ON record_tags (tag_id);

-- ---- One-time copy of the old Tags field (VAs and clients) ----
-- The old values, one row per record and tag (split on commas and semicolons, trimmed).
CREATE TABLE IF NOT EXISTS tag_import (record_id INTEGER, module TEXT, name TEXT);
DELETE FROM tag_import;
INSERT INTO tag_import (record_id, module, name)
WITH RECURSIVE src(record_id, module, rest) AS (
  SELECT r.id, r.module, replace(j.value, ';', ',') || ',' FROM records r, json_each(r.data, '$.Tag') j
   WHERE r.module IN ('vas', 'clients') AND json_type(r.data, '$.Tag') = 'array' AND j.type = 'text'
  UNION ALL
  SELECT r.id, r.module, replace(json_extract(r.data, '$.Tag'), ';', ',') || ',' FROM records r
   WHERE r.module IN ('vas', 'clients') AND json_type(r.data, '$.Tag') = 'text'
),
parts(record_id, module, piece, rest) AS (
  SELECT record_id, module, '', rest FROM src
  UNION ALL
  SELECT record_id, module, trim(substr(rest, 1, instr(rest, ',') - 1)), substr(rest, instr(rest, ',') + 1) FROM parts WHERE rest != ''
)
SELECT DISTINCT record_id, module, substr(piece, 1, 60) FROM parts WHERE piece != '';

INSERT INTO tag_folders (name, position)
SELECT 'Imported', (SELECT IFNULL(MAX(position), 0) + 1 FROM tag_folders)
WHERE EXISTS (SELECT 1 FROM tag_import) AND NOT EXISTS (SELECT 1 FROM tag_folders WHERE name = 'Imported' COLLATE NOCASE);

INSERT INTO tags (name, folder_id, colour, on_vas, on_applicants, on_clients)
SELECT MIN(i.name), f.id, 'grey', MAX(i.module = 'vas'), 0, MAX(i.module = 'clients')
FROM tag_import i JOIN tag_folders f ON f.name = 'Imported' COLLATE NOCASE
WHERE NOT EXISTS (SELECT 1 FROM tags t WHERE IFNULL(t.folder_id, 0) = f.id AND t.name = i.name COLLATE NOCASE)
GROUP BY lower(i.name), f.id;

UPDATE tags SET on_vas = 1 WHERE id IN (SELECT t.id FROM tag_import i JOIN tag_folders f ON f.name = 'Imported' COLLATE NOCASE
  JOIN tags t ON t.folder_id = f.id AND t.name = i.name COLLATE NOCASE WHERE i.module = 'vas');
UPDATE tags SET on_clients = 1 WHERE id IN (SELECT t.id FROM tag_import i JOIN tag_folders f ON f.name = 'Imported' COLLATE NOCASE
  JOIN tags t ON t.folder_id = f.id AND t.name = i.name COLLATE NOCASE WHERE i.module = 'clients');

INSERT INTO record_history (record_id, summary, at)
SELECT DISTINCT i.record_id, 'Tag added: ' || t.name || ' (from the old Tags field)', datetime('now')
FROM tag_import i JOIN tag_folders f ON f.name = 'Imported' COLLATE NOCASE JOIN tags t ON t.folder_id = f.id AND t.name = i.name COLLATE NOCASE
WHERE NOT EXISTS (SELECT 1 FROM record_tags rt WHERE rt.record_id = i.record_id AND rt.tag_id = t.id);

INSERT OR IGNORE INTO record_tags (record_id, tag_id, added_at)
SELECT i.record_id, t.id, datetime('now')
FROM tag_import i JOIN tag_folders f ON f.name = 'Imported' COLLATE NOCASE JOIN tags t ON t.folder_id = f.id AND t.name = i.name COLLATE NOCASE;

DROP TABLE IF EXISTS tag_import;

-- ---- Hide the old Tags field of VAs and clients (Settings > Fields can show it again; values are kept) ----
INSERT OR IGNORE INTO field_layouts (module, data, updated_at) VALUES ('vas', '{}', datetime('now'));
INSERT OR IGNORE INTO field_layouts (module, data, updated_at) VALUES ('clients', '{}', datetime('now'));
INSERT INTO field_log (module, summary, at)
SELECT module, 'Hid "Tags" (replaced by real tags: Settings > Tags)', datetime('now') FROM field_layouts
WHERE module IN ('vas', 'clients') AND NOT EXISTS (SELECT 1 FROM json_each(field_layouts.data, '$.hidden') WHERE value = 'Tag');
UPDATE field_layouts
SET data = json_set(data, '$.hidden', json_insert(IFNULL(json_extract(data, '$.hidden'), '[]'), '$[#]', 'Tag')), updated_at = datetime('now')
WHERE module IN ('vas', 'clients') AND NOT EXISTS (SELECT 1 FROM json_each(field_layouts.data, '$.hidden') WHERE value = 'Tag');
