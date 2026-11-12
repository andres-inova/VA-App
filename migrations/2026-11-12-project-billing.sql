-- Billing details per project (client portal, steps C3/C4): the hourly rate, and training / credit hours that are not
-- billed this cycle. Training and credit hours apply only to the billing cycle that adjust_set_on falls in, so they
-- stop showing by themselves when the cycle rolls over. Safe to run twice.
CREATE TABLE IF NOT EXISTS project_billing (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  hourly_rate REAL,
  training_hours REAL NOT NULL DEFAULT 0,
  credit_hours REAL NOT NULL DEFAULT 0,
  credit_note TEXT,
  adjust_set_on TEXT,     -- YYYY-MM-DD: the day the training/credit hours were set
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
