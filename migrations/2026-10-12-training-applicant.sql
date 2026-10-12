-- Hiring linked to Training: a training started from an applicant's page remembers that applicant
-- (a records row with module 'applicants'). Empty for trainings started on the Training page.
ALTER TABLE trainings ADD COLUMN applicant_id INTEGER;
CREATE INDEX IF NOT EXISTS trainings_applicant ON trainings (applicant_id);
