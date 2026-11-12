-- FreshBooks invoices (client portal, step C5). Safe to run twice.
-- One connection for the whole company (an admin clicks Connect FreshBooks). The keys are kept encrypted with the
-- EMAIL_TOKEN_KEY secret and are never shown.
CREATE TABLE IF NOT EXISTS freshbooks_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  account_id TEXT NOT NULL,            -- FreshBooks "account id" used in every accounting request
  business_name TEXT,
  token TEXT,                          -- encrypted refresh token (FreshBooks gives a new one every time it is used)
  access TEXT,                         -- encrypted short-lived access token and when it ends
  connected_by INTEGER REFERENCES users(id),
  connected_at TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  last_error_at TEXT
);

-- Which FreshBooks client belongs to which client record of this app (chosen by an admin).
CREATE TABLE IF NOT EXISTS freshbooks_links (
  client_record_id INTEGER PRIMARY KEY REFERENCES records(id),
  fb_client_id TEXT NOT NULL,
  fb_name TEXT,
  linked_by INTEGER REFERENCES users(id),
  linked_at TEXT,
  synced_at TEXT                       -- last time this client's invoices were copied
);

-- A copy of each (non-draft) invoice of the linked clients, refreshed about once an hour.
CREATE TABLE IF NOT EXISTS freshbooks_invoices (
  fb_invoice_id TEXT PRIMARY KEY,
  fb_client_id TEXT NOT NULL,
  invoice_number TEXT,
  create_date TEXT,
  due_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  outstanding REAL NOT NULL DEFAULT 0,
  currency TEXT,
  status TEXT,                         -- FreshBooks' own status word (sent, viewed, paid, partial ...)
  link TEXT,                           -- a link the client can open, when FreshBooks gives one
  updated TEXT,
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS freshbooks_invoices_client ON freshbooks_invoices (fb_client_id, create_date);
