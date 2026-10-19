-- Time logging T6 (copying the Zoho Projects history), step 1. Safe to run more than once.

-- What Zoho Projects had on a copied log besides the fields every log has. Shown read-only on the log.
-- source_row = the log's row number in the Zoho export it was copied from, so a copy can be re-run without doubling.
CREATE TABLE IF NOT EXISTS time_log_zoho (
  log_id INTEGER PRIMARY KEY REFERENCES time_logs(id),
  source_row INTEGER NOT NULL UNIQUE,
  task_name TEXT,        -- the task name exactly as Zoho showed it
  task_list TEXT,        -- Zoho "Task List/Module" (for example Administrative Tasks)
  task_id TEXT,          -- Zoho task id (for example T-2-T5)
  project_key TEXT,      -- Zoho project key (for example IN-7)
  billing_type TEXT,     -- Billable or Non Billable
  time_range TEXT,       -- the clock time range Zoho had, for example (09:00 AM - 09:30 AM)
  added_by TEXT          -- who added the log in Zoho
);

-- 55 task names used by current VAs' Zoho logs (hidden = not offered for new logs).
INSERT OR IGNORE INTO task_types (name, position, hidden)
  SELECT column1, (SELECT COALESCE(MAX(position), 0) FROM task_types) + column2, 1 FROM (VALUES
    ('Administrative Tasks', 1),
    ('General Administrative Tasks', 2),
    ('Client Communication', 3),
    ('Internal Collxab Tasks', 4),
    ('Scheduling & Meeting Coordination', 5),
    ('Gifting/Event Emails', 6),
    ('Team mgmt', 7),
    ('Answer customer calls', 8),
    ('Sales and marketing', 9),
    ('Talent Projects', 10),
    ('Social', 11),
    ('Creator Outreach', 12),
    ('Calls/Texts/Emails with Customers', 13),
    ('Communication with Techs', 14),
    ('Invoicing/Payments', 15),
    ('Calls/Texts/Emails with Robert', 16),
    ('In-House', 17),
    ('Hiring tasks', 18),
    ('Internal InoVA Communications', 19),
    ('Obviously Account Check In', 20),
    ('Manage email', 21),
    ('Scheduling/Customer service', 22),
    ('Special Project', 23),
    ('Content Check In', 24),
    ('Owner Communication', 25),
    ('Tech Communication', 26),
    ('Payroll', 27),
    ('Special Project - Whiskey', 28),
    ('NODE', 29),
    ('Coverage Communications', 30),
    ('Special Project - WIKI Notion', 31),
    ('Talent Project - Christi Fritz Lipz', 32),
    ('Special Project - Commend Center', 33),
    ('Opp Forms/ Talent Applications', 34),
    ('Technical Support', 35),
    ('Training with Kayla', 36),
    ('Huddle with summer', 37),
    ('In-House Minimum', 38),
    ('On boarding', 39),
    ('Monthly Check-In Survey', 40),
    ('Continued training for coverage Plus huddle call', 41),
    ('Huddle with Kayla', 42),
    ('Call training', 43),
    ('Admin task', 44),
    ('Booking testing', 45),
    ('Roster Stats', 46),
    ('Talent Pitching', 47),
    ('Internal Communication', 48),
    ('Various', 49),
    ('Huddle w/ Kelli Joy', 50),
    ('Interviews', 51),
    ('Call training, script study', 52),
    ('Admin for client', 53),
    ('QAs for reps', 54),
    ('QA Rep Evaluations', 55)
  );
