-- Shared client/VA email (replaces Zoho CRM's email): each admin connects their Gmail once. The app keeps
-- only emails to or from the addresses of clients, client contacts and VAs (see src/email.js).

-- One row per admin who connected Gmail. `token` is the Google refresh token, encrypted with the
-- EMAIL_TOKEN_KEY secret (never shown or logged). token NULL = not connected now (saved emails kept).
CREATE TABLE IF NOT EXISTS email_inboxes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  email TEXT NOT NULL,                 -- the Google account (lowercase)
  token TEXT,                          -- encrypted refresh token
  access TEXT,                         -- encrypted short-lived access token and when it ends
  shared INTEGER NOT NULL DEFAULT 0,   -- 1 = all admins see the saved emails; 0 = only this person
  history_id TEXT,                     -- Gmail's mark where the next check for new mail starts
  queue TEXT NOT NULL DEFAULT '[]',    -- steps still to do (looking through older mail), as JSON
  connected_at TEXT,
  checked_at TEXT,                     -- last check for new mail
  last_sync_at TEXT,                   -- last run that finished without a problem
  last_error TEXT,
  last_error_at TEXT
);

-- Saved emails. Only the plain text is kept (cut to 20 KB), never the HTML; attachments are only listed
-- (name, size) and opened live from Gmail.
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),  -- whose inbox it came from
  gmail_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  msg_id TEXT,                         -- the Message-ID header (the same email in two inboxes shows once)
  sent_at TEXT NOT NULL,
  from_addr TEXT,
  to_addr TEXT,
  cc_addr TEXT,
  subject TEXT,
  snippet TEXT,
  body TEXT,
  attachments TEXT,                    -- JSON [{ "p": part id, "n": name, "s": size, "t": type }]
  outgoing INTEGER NOT NULL DEFAULT 0, -- 1 = sent from this inbox
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, gmail_id)
);
CREATE INDEX IF NOT EXISTS emails_thread ON emails (user_id, thread_id);

-- Which records each email belongs to (an email can belong to several).
CREATE TABLE IF NOT EXISTS email_links (
  email_id INTEGER NOT NULL REFERENCES emails(id),
  record_id INTEGER NOT NULL REFERENCES records(id),
  PRIMARY KEY (email_id, record_id)
);
CREATE INDEX IF NOT EXISTS email_links_record ON email_links (record_id);
