-- A read-only copy of clients (Zoho CRM Accounts) and VA applicants (Zoho CRM Applicants), for admins.
CREATE TABLE IF NOT EXISTS crm_records (
  module TEXT NOT NULL,      -- clients or applicants
  id TEXT NOT NULL,          -- the record's id in Zoho CRM
  name TEXT NOT NULL,
  status TEXT,               -- clients: Current, Paused or Offboarded; applicants: Zoho "Applicant Status"
  search TEXT,               -- lowercase name, email, phone and location, for searching
  created_at TEXT,           -- Zoho "Created Time"
  data TEXT NOT NULL,        -- every field from Zoho, as JSON
  PRIMARY KEY (module, id)
);
CREATE INDEX IF NOT EXISTS crm_records_status ON crm_records (module, status, created_at);
