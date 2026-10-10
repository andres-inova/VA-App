-- Hiring: applicants are now kept in the app (records with module 'applicants'), so the read-only copy
-- of Zoho CRM applicants and its settings are no longer used.
DROP TABLE IF EXISTS crm_records;
DELETE FROM settings WHERE key IN ('crm_sync', 'crm_layout_applicants', 'crm_layout_clients');
