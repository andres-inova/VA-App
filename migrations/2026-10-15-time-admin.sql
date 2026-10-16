-- Time logging T4 (admin Time page): an index so totals across all VAs and projects for a date range read only the
-- logs in that range. Safe to run more than once.
CREATE INDEX IF NOT EXISTS time_logs_date ON time_logs (work_date);
