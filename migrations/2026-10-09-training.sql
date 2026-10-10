-- VA training program (moved here from the separate training tracker app).
-- A training pairs a trainee with a trainer (a current VA) and works through a day-by-day checklist.

-- The checklist: days, and the items of each day. Only admins change these.
CREATE TABLE IF NOT EXISTS training_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_number INTEGER NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES training_days(id),
  position INTEGER NOT NULL,
  location TEXT NOT NULL DEFAULT '',     -- the system or channel, for example "CRM"
  name TEXT NOT NULL,
  trainer_text TEXT NOT NULL DEFAULT '', -- what the trainer does
  trainee_text TEXT NOT NULL DEFAULT ''  -- what the trainee does
);
CREATE INDEX IF NOT EXISTS training_items_day ON training_items (day_id, position);

-- One row per training. kind: Onboarding Training (a new hire), Back-Up or After-Hours (current VAs).
-- status: active, paused, completed or cancelled.
CREATE TABLE IF NOT EXISTS trainings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  trainee_id INTEGER NOT NULL REFERENCES users(id),
  trainer_id INTEGER NOT NULL REFERENCES users(id),
  start_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS trainings_trainee ON trainings (trainee_id, status);
CREATE INDEX IF NOT EXISTS trainings_trainer ON trainings (trainer_id, status);

-- Each checklist item of a training. status: not_started, covered or carried_over (moves on to a later day).
CREATE TABLE IF NOT EXISTS training_progress (
  training_id INTEGER NOT NULL REFERENCES trainings(id),
  item_id INTEGER NOT NULL REFERENCES training_items(id),
  status TEXT NOT NULL DEFAULT 'not_started',
  trainer_notes TEXT,
  trainee_notes TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT,
  PRIMARY KEY (training_id, item_id)
);

-- Day sign-offs: the trainer and the trainee each sign; an admin can sign off a day for both.
CREATE TABLE IF NOT EXISTS training_signoffs (
  training_id INTEGER NOT NULL REFERENCES trainings(id),
  day_id INTEGER NOT NULL REFERENCES training_days(id),
  trainer_at TEXT,
  trainee_at TEXT,
  admin_at TEXT,
  admin_by INTEGER REFERENCES users(id),
  PRIMARY KEY (training_id, day_id)
);

-- The starting training checklist, copied from the training tracker app (2026-10-09). Admins change it on Training > Checklist.
INSERT OR IGNORE INTO training_days (id, day_number, title) VALUES
  (1, 1, 'Orientation & Software/Role Overview'),
  (2, 2, 'Daily Task Flow'),
  (3, 3, 'Customer Quote Calls'),
  (4, 4, 'New Leads & Reschedules'),
  (5, 5, 'End-of-Day Close-Out & Wrap-Up');

INSERT OR IGNORE INTO training_items (id, day_id, position, location, name, trainer_text, trainee_text) VALUES
  (1, 1, 1, 'All systems', 'Software & role overview',
   'Walk the trainee through every software you use for this client (CRM, marketing software, phone system, Zoho) and give a short overview of what your day-to-day role covers.',
   'Get an overview of each software the trainer uses and what their day-to-day role covers. Ask about anything unclear.'),
  (2, 1, 2, 'Training Syllabus', 'Orientation to this week''s syllabus',
   'Introduce the full training checklist you''ll work through this week and explain how daily sign-off works.',
   'Get familiar with the training checklist for the week and how your progress is tracked and signed off each day.'),
  (3, 1, 3, 'Inova Slack / Client messaging', 'Start-of-day check-in routine',
   'Show the start-of-day check-in routine and explain what a good check-in message looks like.',
   'Learn how the start-of-day check-in message is written and sent, and note the format so you could write one yourself.'),
  (4, 2, 1, 'Marketing Software', 'Task review & prioritization',
   'Show how you review and prioritize your assigned tasks for the day.',
   'Learn how tasks are reviewed and prioritized, and how the trainer decides what to do first.'),
  (5, 2, 2, 'CRM', 'Client lookup',
   'Show how to look up a client''s info and communication history in the CRM before acting on a task.',
   'Learn what information gets checked in the CRM before acting on a task, and why it matters.'),
  (6, 2, 3, 'Phone System', 'Outbound call logging',
   'Show how an outbound call gets logged and what "complete" looks like on a task.',
   'Learn how a call gets logged and what marks a task as complete.'),
  (7, 2, 4, 'Marketing Software / CRM', 'Note-mirroring',
   'Show how notes are kept consistent between the CRM and marketing software, and why duplicate or contradictory notes cause problems.',
   'Learn how the same note gets entered or reflected in both the CRM and marketing software.'),
  (8, 2, 5, 'Freshbooks / Zoho', 'Billing/time entry detail',
   'Show the level of detail expected in a time or billing entry using one of your own recent entries.',
   'Learn the level of detail expected in a billing entry so you know what''s expected later.'),
  (9, 3, 1, 'Phone System', 'Greeting & intake script',
   'Show the standard phone greeting and intake questions used to start a quote.',
   'Learn the standard greeting and the questions asked to start a quote.'),
  (10, 3, 2, 'CRM', 'Quote build requirements',
   'Show what''s required to generate a quote: house size, pricing model, add-ons.',
   'Learn what information is required to build a quote.'),
  (11, 3, 3, 'CRM', 'Booking path',
   'Show the booking flow: payment info, scheduling preferences, access/parking/pet notes, and next-step communication.',
   'Learn the full booking flow, including how payment info and scheduling preferences are handled.'),
  (12, 3, 4, 'CRM / Marketing Software', 'Non-booking path',
   'Show objection handling, sending a written quote, and the correct follow-up cadence when a caller doesn''t book.',
   'Learn how objections are handled and what follow-up looks like when someone doesn''t book right away.'),
  (13, 3, 5, 'Judgment / Escalation', 'Escalation triggers for pricing/policy',
   'Explain when a pricing or policy question should be escalated to the client/manager versus answered independently.',
   'Learn which pricing or policy questions get escalated versus handled directly.'),
  (14, 4, 1, 'Marketing Software', 'New-lead triage',
   'Show how a "new lead" notification is reviewed and prioritized.',
   'Learn how a new lead gets triaged and prioritized.'),
  (15, 4, 2, 'CRM', 'Follow-up call flow',
   'Show the follow-up call flow for a lead that didn''t complete a quote, including how the outcome gets logged (even a voicemail).',
   'Learn how a follow-up call is logged, including when it''s just a voicemail.'),
  (16, 4, 3, 'Phone System / Slack', 'Reschedule handling',
   'Show how reschedule details are gathered (reason, new date, tech preference) and which parts are handled directly versus routed to the scheduling owner.',
   'Learn how reschedule details are gathered and what gets routed elsewhere.'),
  (17, 4, 4, 'Judgment / Escalation', 'The escalation ladder (general)',
   'Explain, in general terms, what a VA handles solo versus what always goes to a manager or client.',
   'Learn the general rule for what you''d handle solo versus escalate.'),
  (18, 5, 1, 'Email / CRM / Marketing Software', 'End-of-day review routine',
   'Show the end-of-day review pass: outstanding emails, next-day schedule check, and any unresolved tasks.',
   'Learn the full end-of-day review pass.'),
  (19, 5, 2, 'Phone System', 'Phone system log-out',
   'Show how you log out of the phone system at the end of shift.',
   'Learn the log-out step as part of closing a shift.'),
  (20, 5, 3, 'Inova Slack / Client messaging', 'End-of-day check-out message',
   'Show the end-of-day check-out message to the internal team and the client.',
   'Learn the format of the end-of-day check-out message.'),
  (21, 5, 4, 'General Practices', 'Credential handoff & access control',
   'Explain where the client-specific login/credential list lives and who controls access once a backup VA is formally assigned.',
   'Learn where credentials live and who to go to when you''re formally assigned to an account.'),
  (22, 5, 5, 'General Practices', 'Tone & communication expectations',
   'Walk through tone and communication style expectations, both with clients and with customers, using real examples.',
   'Learn the tone and communication style expectations with both clients and customers.'),
  (23, 5, 6, 'General Practices', 'Reference materials',
   'Show where to find sales scripts and other reference material.',
   'Learn where reference materials and sales scripts live for later.'),
  (24, 5, 7, 'Training Syllabus', 'Full syllabus review & sign-off',
   'Review the full checklist together, confirm every item was covered (including anything carried over from earlier days), and sign off.',
   'Review the full checklist together, flag anything that wasn''t clearly covered, and sign off.');
